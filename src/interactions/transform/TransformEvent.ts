import { MapBrowserEvent } from "ol"
import { type Coordinate } from "ol/coordinate"
import BaseEvent from "ol/events/Event"

import Transform from "./Transform"

export type TransformEventType =
  | "mousedown"
  | "mousemove"
  | "mouseup"
  | "transformstart"
  | "transforming"
  | "transformend"
  | "translatestart"
  | "translating"
  | "translateend"
  | "rotatestart"
  | "rotating"
  | "rotateend"
  | "scalestart"
  | "scaling"
  | "scaleend"

export default class TransformEvent extends BaseEvent {
  target: Transform
  mapBrowserEvent: MapBrowserEvent<MouseEvent>
  startCoordinate: Coordinate
  coordinate: Coordinate

  constructor({
    type,
    target,
    mapBrowserEvent,
    startCoordinate,
    coordinate,
  }: {
    type: TransformEventType
    target: Transform
    mapBrowserEvent: MapBrowserEvent<MouseEvent>
    startCoordinate: Coordinate
    coordinate: Coordinate
  }) {
    super(type)
    this.target = target
    this.mapBrowserEvent = mapBrowserEvent
    this.startCoordinate = startCoordinate
    this.coordinate = coordinate
  }
}
