import { type Coordinate } from "ol/coordinate"
import { getCenter } from "ol/extent"
import { Polygon } from "ol/geom"

/**
 * rearrange coordinates to counter-clockwise
 * 0 3
 * 1 2
 */
export const rearrangeCoords = (coords: Coordinate[]): Coordinate[] => {
  const minX = Math.min(coords[0][0], coords[1][0], coords[2][0], coords[3][0])
  const maxX = Math.max(coords[0][0], coords[1][0], coords[2][0], coords[3][0])
  const minY = Math.min(coords[0][1], coords[1][1], coords[2][1], coords[3][1])
  const maxY = Math.max(coords[0][1], coords[1][1], coords[2][1], coords[3][1])

  return [
    [minX, maxY],
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]
}

export const calcDistance = (c1: Coordinate, c2: Coordinate): number => {
  const { width, height } = calcSize(c1, c2)

  return Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2))
}

export const calcSize = (c1: Coordinate, c2: Coordinate) => {
  return {
    width: Math.abs(c1[0] - c2[0]),
    height: Math.abs(c1[1] - c2[1]),
  }
}
