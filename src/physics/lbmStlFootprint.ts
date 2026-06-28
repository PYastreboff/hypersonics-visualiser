import { STLLoader } from 'three-stdlib';

export interface LbmStencilFootprint {
  stencilX: number[];
  stencilY: number[];
}

/** Parse STL and orthographically project onto the 2D simulation plane (largest two axes). */
export function stlBufferToFootprint(
  buffer: ArrayBuffer,
  targetMaxCells = 48,
): LbmStencilFootprint {
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);
  const positions = geometry.attributes.position.array as Float32Array;
  geometry.dispose();

  if (positions.length < 9) {
    return { stencilX: [0], stencilY: [0] };
  }

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      min[a] = Math.min(min[a], v);
      max[a] = Math.max(max[a], v);
    }
  }

  const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const dropAxis = extents.indexOf(Math.min(...extents));
  const axisA = dropAxis === 0 ? 1 : 0;
  const axisB = dropAxis === 2 ? 1 : 2;

  const centerA = (min[axisA] + max[axisA]) / 2;
  const centerB = (min[axisB] + max[axisB]) / 2;
  const span = Math.max(max[axisA] - min[axisA], max[axisB] - min[axisB], 1e-9);
  const scale = targetMaxCells / span;

  const triangles: Array<[[number, number], [number, number], [number, number]]> = [];

  for (let i = 0; i < positions.length; i += 9) {
    const verts: Array<[number, number]> = [];
    for (let v = 0; v < 3; v++) {
      const base = i + v * 3;
      const a = (positions[base + axisA] - centerA) * scale;
      const b = (positions[base + axisB] - centerB) * scale;
      verts.push([a, b]);
    }
    triangles.push([verts[0], verts[1], verts[2]]);
  }

  const cells = new Set<string>();

  for (const tri of triangles) {
    rasterizeTriangle(tri, cells);
  }

  if (cells.size === 0) {
    return { stencilX: [0], stencilY: [0] };
  }

  const stencilX: number[] = [];
  const stencilY: number[] = [];
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number);
    stencilX.push(x);
    stencilY.push(y);
  }

  return { stencilX, stencilY };
}

function rasterizeTriangle(
  [[x0, y0], [x1, y1], [x2, y2]]: [[number, number], [number, number], [number, number]],
  cells: Set<string>,
): void {
  const minX = Math.floor(Math.min(x0, x1, x2)) - 1;
  const maxX = Math.ceil(Math.max(x0, x1, x2)) + 1;
  const minY = Math.floor(Math.min(y0, y1, y2)) - 1;
  const maxY = Math.ceil(Math.max(y0, y1, y2)) + 1;

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (pointInTriangle(x + 0.5, y + 0.5, x0, y0, x1, y1, x2, y2)) {
        cells.add(`${x},${y}`);
      }
    }
  }
}

function pointInTriangle(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const dX = px - x2;
  const dY = py - y2;
  const dX21 = x2 - x1;
  const dY12 = y1 - y2;
  const D = dY12 * (x0 - x2) + dX21 * (y0 - y2);
  const s = dY12 * dX + dX21 * dY;
  const t = (y2 - y0) * dX + (x0 - x2) * dY;
  if (D < 0) {
    return s <= 0 && t <= 0 && s + t >= D;
  }
  return s >= 0 && t >= 0 && s + t <= D;
}
