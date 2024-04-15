import { Collection, Map as OlMap, MapBrowserEvent } from "ol"
import Feature from "ol/Feature"
import { Color } from "ol/color"
import { type ColorLike } from "ol/colorlike"
import { type Coordinate } from "ol/coordinate"
import { boundingExtent, getCenter } from "ol/extent"
import { Geometry, Point } from "ol/geom"
import { fromExtent } from "ol/geom/Polygon"
import PointerInteraction from "ol/interaction/Pointer"
import { Layer, Vector as VectorLayer } from "ol/layer"
import { type Options } from "ol/layer/BaseVector"
import { Source, Vector as VectorSource } from "ol/source"
import { Fill, RegularShape, Stroke, Style } from "ol/style"

import TransformEvent, { type TransformEventType } from "./TransformEvent"
import { HandleFeature } from "../../features/HandleFeature"
import { calcDistance, rearrangeCoords } from "../../util"
import type { OmitFrom } from "../../util-types"

export type TransformMode = "" | "translate" | "scale" | "rotate"

export type TransformOptions = {
  layers?: Layer<Source>[]
  handleEvent?: (evt: MapBrowserEvent<MouseEvent>, features?: Collection<Feature<Geometry>>) => boolean
  addCondition?: (evt: MapBrowserEvent<MouseEvent>) => boolean
  strokeColor?: string
  strokeWidth?: number
  shouldGetFeature?: (evt: MapBrowserEvent<MouseEvent>, feat: Feature, layer: Layer) => boolean
  layerOptions?: OmitFrom<Options<VectorSource>, "source">
}

export default class Transform extends PointerInteraction {
  private static readonly scaleHandlesLength = 8
  private readonly _selections = new Collection<Feature>()
  private readonly _prevSelections = new Collection<Feature>()
  private readonly _handleLayer: VectorLayer<VectorSource>
  private _mode: TransformMode = ""
  private _layers: Layer[]
  private _addCondition: (evt: MapBrowserEvent<MouseEvent>) => boolean
  private _shouldGetFeature: (evt: MapBrowserEvent<MouseEvent>, feat: Feature, layer: Layer) => boolean
  private _isTransformed = false
  private _strokeColor?: string
  private _strokeWidth: number
  private _startCoord: Coordinate = [0, 0]
  private _prevCoord: Coordinate = [0, 0]
  private _rotationSelection = { angle: 0, center: [0, 0] }
  private _scalingSelection = {
    angle: 0,
    w: 0,
    h: 0,
    handleIdx: -1,
    oppositeIdx: -1,
    oppositeCoord: [0, 0],
    startCoord: [0, 0],
  }
  private _headInverted = false

  constructor(options: TransformOptions = {}) {
    super()
    this._addCondition = options.addCondition ?? ((evt) => evt.originalEvent.shiftKey)
    this._strokeColor = options.strokeColor
    this._strokeWidth = options.strokeWidth ?? 1.7
    this._layers = options.layers ?? []
    this._shouldGetFeature = options.shouldGetFeature ?? (() => true)
    this._handleLayer = new VectorLayer({
      source: new VectorSource({
        features: new Collection<Feature<Geometry>>(),
        useSpatialIndex: false,
        wrapX: false,
      }),
      ...options.layerOptions,
    })

    this._selections.on(["add", "remove"], () => this.drawHandles())
  }

  setMap(map: OlMap | null): void {
    const oldMap = this.getMap()
    oldMap?.removeLayer(this._handleLayer)

    super.setMap(map)
    map?.addLayer(this._handleLayer)
  }

  get mode(): TransformMode {
    return this._mode
  }

  get prevFeatures(): Collection<Feature<Geometry>> {
    return this._prevSelections
  }

  get features(): Collection<Feature<Geometry>> {
    return this._selections
  }

  get visible(): boolean {
    return this._handleLayer.getVisible()
  }

  setVisible(visible: boolean): this {
    this._handleLayer.setVisible(visible)
    return this
  }

  protected handleDownEvent(evt: MapBrowserEvent<MouseEvent>) {
    const handleOrBody = this.selectFeature(evt)
    if (!handleOrBody) {
      this._selections.clear()
    }
    this._prevSelections.clear()
    this._prevSelections.extend(this._selections.getArray().map((feat) => feat.clone()))

    this.dispatchTransformEvent("mousedown", evt)

    if (!handleOrBody) {
      return false
    }

    // initial setting
    this._startCoord = evt.coordinate

    if (!HandleFeature.isHandleFeature(handleOrBody)) {
      // is body
      this._mode = "translate"
      this._prevCoord = evt.coordinate
    } else {
      this._mode = handleOrBody.mode
      const feat = handleOrBody.body
      const geom = feat.getGeometry()!

      switch (this._mode) {
        case "translate":
          this._prevCoord = evt.coordinate
          break
        case "rotate":
          const center = getCenter(geom.getExtent())
          this._rotationSelection = {
            angle: Math.atan2(this._startCoord[1] - center[1], this._startCoord[0] - center[0]),
            center,
          }
          break
        case "scale":
          const angle = feat.get("angle") ?? 0
          const normalGeo = geom.clone()
          const normalCenter = getCenter(normalGeo.getExtent())
          normalGeo.rotate(-angle, normalCenter)
          const normalExt = normalGeo.getExtent()
          const polygon = fromExtent(normalExt)
          polygon.setCoordinates([rearrangeCoords(polygon.getCoordinates()[0])])
          polygon.rotate(angle, normalCenter)
          const coords = polygon.getCoordinates()[0]

          const { index } = handleOrBody
          const oppositeIdx = (index + Math.round(Transform.scaleHandlesLength * 0.5)) % Transform.scaleHandlesLength
          const oppositeCoord = this.calcScaleHandleCoord(coords, oppositeIdx)
          const startCoord = this.rotatePoint(this.calcScaleHandleCoord(coords, index), oppositeCoord, -angle)
          this._scalingSelection = {
            angle,
            w: calcDistance(coords[1], coords[2]),
            h: calcDistance(coords[0], coords[1]),
            handleIdx: index,
            oppositeIdx,
            oppositeCoord,
            startCoord,
          }
          break
      }
    }

    switch (this._mode) {
      case "translate":
        this.dispatchTransformEvent("translatestart", evt)
        break
      case "rotate":
        this.dispatchTransformEvent("rotatestart", evt)
        break
      case "scale":
        this.dispatchTransformEvent("scalestart", evt)
        break
    }
    this.dispatchTransformEvent("transformstart", evt)

    return true
  }

  protected handleDragEvent(evt: MapBrowserEvent<MouseEvent>) {
    this._handleLayer.getSource()!.clear()
    this._isTransformed = true

    if (this._mode === "translate") {
      const [x, y] = evt.coordinate
      const [px, py] = this._prevCoord
      this._prevCoord = [x, y]
      const dx = x - px
      const dy = y - py

      this._selections.forEach((sel) => sel.getGeometry()!.translate(dx, dy))
    } else if (this._mode === "rotate") {
      const [x, y] = evt.coordinate
      const { angle, center } = this._rotationSelection
      const da = Math.atan2(y - center[1], x - center[0]) - angle

      this._prevSelections.forEach((sel, i) => {
        const geom = sel.getGeometry()!.clone()
        const center = getCenter(geom.getExtent())
        geom.rotate(da, center)
        const angle: number | undefined = sel.get("angle")
        if (angle !== undefined) {
          sel.set("angle", (angle + da) % (2 * Math.PI))
        }
        this._selections.item(i).setGeometry(geom)
      })
    } else if (this._mode === "scale") {
      const { angle, handleIdx, oppositeIdx, oppositeCoord, startCoord, w, h } = this._scalingSelection
      const [sx, sy] = startCoord
      const [x, y] = this.rotatePoint(evt.coordinate, oppositeCoord, -angle)

      let dx = 0
      let dy = 0
      switch (handleIdx) {
        case 0:
          dx = sx - x
          dy = y - sy
          break
        case 1:
          dx = sx - x
          break
        case 2:
          dx = sx - x
          dy = sy - y
          break
        case 3:
          dy = sy - y
          break
        case 4:
          dx = x - sx
          dy = sy - y
          break
        case 5:
          dx = x - sx
          break
        case 6:
          dx = x - sx
          dy = y - sy
          break
        case 7:
          dy = y - sy
          break
      }

      const scaleX = dx / w + 1
      const scaleY = dy / h + 1
      this._headInverted = scaleY < 0

      this._prevSelections.forEach((sel, i) => {
        const angle = sel.get("angle") ?? 0
        const geom = sel.getGeometry()!.clone()
        const normalGeo = geom.clone()
        const normalCenter = getCenter(normalGeo.getExtent())
        normalGeo.rotate(-angle, normalCenter)
        const normalExt = normalGeo.getExtent()
        const polygon = fromExtent(normalExt)
        polygon.setCoordinates([rearrangeCoords(polygon.getCoordinates()[0])])
        polygon.rotate(angle, normalCenter)
        const coords = polygon.getCoordinates()[0]

        const oppositeCoord = this.calcScaleHandleCoord(coords, oppositeIdx)

        geom.rotate(-angle, oppositeCoord)
        geom.scale(scaleX, scaleY, oppositeCoord)
        geom.rotate(angle, oppositeCoord)

        this._selections.item(i).setGeometry(geom)
      })
    }

    switch (this._mode) {
      case "translate":
        this.dispatchTransformEvent("translating", evt)
        break
      case "rotate":
        this.dispatchTransformEvent("rotating", evt)
        break
      case "scale":
        this.dispatchTransformEvent("scaling", evt)
        break
    }
    this.dispatchTransformEvent("transforming", evt)
  }

  protected handleUpEvent(evt: MapBrowserEvent<MouseEvent>): boolean {
    if (this._mode === "scale" && this._headInverted) {
      this._selections.forEach((sel) => {
        const geom = sel.getGeometry()!
        const angle: number | undefined = sel.get("angle")
        if (angle !== undefined) {
          geom.rotate(Math.PI, getCenter(geom.getExtent()))
          sel.set("angle", (angle + Math.PI) % (2 * Math.PI))
        }
      })
    }

    this.dispatchTransformEvent("mouseup", evt)

    if (this._isTransformed) {
      switch (this._mode) {
        case "translate":
          this.dispatchTransformEvent("translateend", evt)
          break
        case "rotate":
          this.dispatchTransformEvent("rotateend", evt)
          break
        case "scale":
          this.dispatchTransformEvent("scaleend", evt)
          break
      }
      this.dispatchTransformEvent("transformend", evt)
    }

    this.drawHandles()
    this._mode = ""
    this._isTransformed = false

    return false
  }

  protected handleMoveEvent(evt: MapBrowserEvent<MouseEvent>) {
    super.handleMoveEvent(evt)
    this.dispatchTransformEvent("mousemove", evt)
  }

  private dispatchTransformEvent(type: TransformEventType, evt: MapBrowserEvent<MouseEvent>): void {
    this.dispatchEvent(
      new TransformEvent({
        type,
        target: this,
        mapBrowserEvent: evt,
        startCoordinate: this._startCoord,
        coordinate: evt.coordinate,
      }),
    )
  }

  private selectFeature(evt: MapBrowserEvent<MouseEvent>): HandleFeature | Feature | undefined {
    return this.getMap()?.forEachFeatureAtPixel(
      evt.pixel,
      (feat, layer) => {
        if (!(feat instanceof Feature) || !feat.getGeometry() || !this._shouldGetFeature(evt, feat, layer)) {
          return
        }
        if (HandleFeature.isHandleFeature(feat)) {
          return feat
        }

        const i = this._selections.getArray().indexOf(feat)
        if (this._addCondition(evt)) {
          if (i === -1) {
            this._selections.push(feat)
          } else {
            this._selections.removeAt(i)
          }
        } else {
          if (i === -1) {
            this._selections.clear()
            this._selections.push(feat)
          }
        }

        return feat
      },
      {
        layerFilter: (layer): boolean => {
          const index = [this._handleLayer, ...this._layers].indexOf(layer) ?? -1
          return index >= 0
        },
      },
    )
  }

  private drawHandles(): void {
    this._handleLayer.getSource()!.clear()
    this._selections.getArray().forEach((sel, i) => {
      if (i === 0) {
        const handles = this.genHandles(sel)
        this._handleLayer.getSource()!.addFeatures(handles)
      }
      const handle = this.genTranslateHandle(sel)
      this._handleLayer.getSource()!.addFeature(handle)
    })
  }

  private genTranslateHandle(feat: Feature): Feature {
    const geom = feat.getGeometry()!
    const strokeColor = this._strokeColor ?? this.extractStrokeColor(feat) ?? "rgba(151, 151, 151, 1)"
    const strokeWidth = this._strokeWidth

    if (geom instanceof Point) {
      const coord = geom.getCoordinates()
      const pointHandle = new HandleFeature({ geometry: new Point(coord), body: feat, mode: "translate" })
      pointHandle.setStyle(
        new Style({
          image: new RegularShape({
            stroke: new Stroke({ color: strokeColor, width: strokeWidth }),
            fill: new Fill({ color: "white" }),
            radius: 6,
            points: 15,
          }),
        }),
      )

      return pointHandle
    }

    const polygon = fromExtent(geom.getExtent())
    const borderHandle = new HandleFeature({ geometry: polygon, body: feat, mode: "translate" })
    borderHandle.setStyle(
      new Style({
        stroke: new Stroke({
          color: strokeColor,
          width: strokeWidth,
          lineDash: [8],
        }),
      }),
    )
    return borderHandle
  }

  private genHandles(feat: Feature): Feature[] {
    const handles: Feature<Geometry>[] = []
    const strokeColor = this._strokeColor ?? this.extractStrokeColor(feat) ?? "rgba(151, 151, 151, 1)"
    const stroke = new Stroke({ color: strokeColor, width: this._strokeWidth })
    const fill = new Fill({ color: "white" })
    const geom = feat.getGeometry()!

    if (geom instanceof Point) {
      return handles
    }

    const angle = feat.get("angle") ?? 0
    const normalGeo = geom.clone()
    const normalCenter = getCenter(normalGeo.getExtent())
    normalGeo.rotate(-angle, normalCenter)
    const normalExt = normalGeo.getExtent()
    const polygon = fromExtent(normalExt)
    polygon.setCoordinates([rearrangeCoords(polygon.getCoordinates()[0])])
    polygon.rotate(angle, normalCenter)
    const coords = polygon.getCoordinates()[0]

    // Generate rotate handle
    const headCoord = this.calcScaleHandleCoord(coords, 7)
    const rotateHandle = new HandleFeature({ geometry: new Point(headCoord), body: feat, mode: "rotate" })
    const style = [
      new Style({
        image: new RegularShape({
          stroke,
          fill,
          radius: 16,
          points: 2,
          displacement: [0, 16],
          rotation: -angle,
          rotateWithView: true,
        }),
      }),
      new Style({
        image: new RegularShape({
          stroke,
          fill,
          radius: 6,
          points: 15,
          displacement: [0, 32],
          rotation: -angle,
          rotateWithView: true,
        }),
      }),
    ]
    rotateHandle.setStyle(style)
    handles.push(rotateHandle)

    // Generate scale handles
    for (let i = 0; i < Transform.scaleHandlesLength; i++) {
      const coord = this.calcScaleHandleCoord(coords, i)
      const scaleHandle = new HandleFeature({ geometry: new Point(coord), body: feat, mode: "scale", index: i })
      const style = new Style({
        image: new RegularShape({
          stroke,
          fill,
          points: 4,
          radius: 8,
          angle: Math.PI / 4,
          rotation: -angle,
          rotateWithView: true,
        }),
      })
      scaleHandle.setStyle(style)
      handles.push(scaleHandle)
    }

    return handles
  }

  private extractStrokeColor = (feat: Feature): Color | ColorLike | undefined => {
    let color
    const styleLike = feat.getStyle()
    if (Array.isArray(styleLike)) {
      color = styleLike
        .find((s) => !!s.getStroke())
        ?.getStroke()
        ?.getColor()
    } else if (styleLike instanceof Style) {
      color = styleLike.getStroke()?.getColor()
    } else if (typeof styleLike === "function" && this.getMap()?.getView().getResolution() !== undefined) {
      const style = styleLike(feat, this.getMap()!.getView().getResolution()!)
      if (Array.isArray(style)) {
        color = style
          .find((s) => !!s.getStroke())
          ?.getStroke()
          ?.getColor()
      } else if (style instanceof Style) {
        color = style.getStroke()?.getColor()
      }
    }
    return color
  }

  /**
   * @param coords
   * @param handleIdx in 0 ~ 7
   * handle index location
   * 0 7 6
   * 1   5
   * 2 3 4
   */
  private calcScaleHandleCoord(coords: Coordinate[], handleIdx: number): Coordinate {
    const [tl, bl, br, tr] = coords

    switch (handleIdx) {
      case 0:
        return tl
      case 1:
        return getCenter(boundingExtent([tl, bl]))
      case 2:
        return bl
      case 3:
        return getCenter(boundingExtent([bl, br]))
      case 4:
        return br
      case 5:
        return getCenter(boundingExtent([br, tr]))
      case 6:
        return tr
      case 7:
        return getCenter(boundingExtent([tr, tl]))
      default:
        return [0, 0]
    }
  }

  private rotatePoint([x, y]: Coordinate, anchor: Coordinate, angle: number): Coordinate {
    const [ax, ay] = anchor
    return [(x - ax) * Math.cos(angle) - (y - ay) * Math.sin(angle) + ax, (x - ax) * Math.sin(angle) + (y - ay) * Math.cos(angle) + ay]
  }
}
