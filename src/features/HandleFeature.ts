import Feature, { type FeatureLike } from "ol/Feature"
import { Geometry } from "ol/geom"

import { type TransformMode } from "../interactions/transform/Transform"

export default class HandleFeature<GeomType extends Geometry = Geometry> extends Feature<GeomType> {
  readonly body: Feature
  readonly mode: TransformMode
  readonly index: number

  constructor({ geometry, body, mode, index = -1 }: { geometry: GeomType; body: Feature; mode: TransformMode; index?: number }) {
    super(geometry)
    this.body = body
    this.mode = mode
    this.index = index
  }

  static isHandleFeature(feat: FeatureLike): feat is HandleFeature {
    return feat instanceof HandleFeature
  }
}
