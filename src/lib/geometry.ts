import { mm, type Settings } from "./settings";

/*
 * Pure sheet geometry, free of any PDF library so the UI can use it without
 * pulling those into the first page load.
 */

/** PDF transformation matrix [a b c d e f]: x' = ax + cy + e, y' = bx + dy + f. */
export type Matrix = [number, number, number, number, number, number];

/** p -> outer(inner(p)) */
export function compose(o: Matrix, i: Matrix): Matrix {
  return [
    o[0] * i[0] + o[2] * i[1],
    o[1] * i[0] + o[3] * i[1],
    o[0] * i[2] + o[2] * i[3],
    o[1] * i[2] + o[3] * i[3],
    o[0] * i[4] + o[2] * i[5] + o[4],
    o[1] * i[4] + o[3] * i[5] + o[5],
  ];
}

/** Output page size for a logical (landscape) sheet. */
export function outputPageSize(s: Settings, paperW: number, paperH: number): [number, number] {
  return s.orientation === "portrait" ? [paperH, paperW] : [paperW, paperH];
}

/**
 * Transform from logical sheet coordinates to output page coordinates.
 * Back sides are first shifted to compensate the measured duplex offset,
 * then turned by 180° when the printer flips on the long edge, and finally
 * everything is rotated by 90° for portrait output.
 */
export function sideMatrix(s: Settings, paperW: number, paperH: number, back: boolean): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  if (back) {
    m = [1, 0, 0, 1, -mm(s.offsetX || 0), -mm(s.offsetY || 0)];
    if (s.flip === "long") m = compose([-1, 0, 0, -1, paperW, paperH], m);
  }
  if (s.orientation === "portrait") m = compose([0, 1, -1, 0, paperH, 0], m);
  return m;
}
