import type { LbmShapeInput, LbmShapeType } from '@/types';

export interface LbmShapeSpec {
  type: 'square' | 'circle' | 'airfoil' | 'doubleWedge' | 'flatPlate' | 'custom';
  cx: number;
  cy: number;
  aoa: number;
  width?: number;
  height?: number;
  radius?: number;
  chord?: number;
  naca?: string;
  customScale?: number;
  stencilX?: number[];
  stencilY?: number[];
}

export function defaultLbmShapeGeometry(
  type: LbmShapeType,
): Partial<Pick<LbmShapeInput, 'width' | 'height' | 'radius' | 'chord' | 'naca'>> {
  switch (type) {
    case 'airfoil':
      return { chord: 80, naca: '0012' };
    case 'flatPlate':
      return { width: 80, height: 1 };
    case 'square':
      return { width: 20, height: 20 };
    case 'doubleWedge':
      return { width: 60, height: 24 };
    case 'circle':
      return { radius: 12 };
    default:
      return {};
  }
}

/** Replace geometry when switching shape type (avoids reusing block size on flat plate). */
export function shapeInputForType(shape: LbmShapeInput, type: LbmShapeType): LbmShapeInput {
  if (type === 'custom') return shape;

  const base = {
    id: shape.id,
    cx: shape.cx,
    cy: shape.cy,
    aoa: type === 'flatPlate' ? 0 : shape.aoa,
    type,
  };
  const geom = defaultLbmShapeGeometry(type);

  switch (type) {
    case 'airfoil':
      return { ...base, chord: geom.chord ?? 80, naca: geom.naca ?? '0012' };
    case 'flatPlate':
    case 'square':
    case 'doubleWedge':
      return { ...base, width: geom.width!, height: geom.height! };
    case 'circle':
      return { ...base, radius: geom.radius ?? 12 };
    default:
      return { ...base, ...geom };
  }
}

export function lbmInputToSpec(shape: LbmShapeInput): LbmShapeSpec {
  return {
    type: shape.type,
    cx: shape.cx,
    cy: shape.cy,
    aoa: shape.aoa,
    chord: shape.chord,
    naca: shape.naca,
    width: shape.width,
    height: shape.height,
    radius: shape.radius,
    customScale: shape.customScale,
    stencilX: shape.stencilX,
    stencilY: shape.stencilY,
  };
}

/** Scale shape geometry to match gem.py RESOLUTION_SCALE handling. */
export function scaleShapeSpecs(
  shapes: LbmShapeSpec[],
  resolutionScale: number,
): LbmShapeSpec[] {
  return shapes.map((shape) => {
    const sizeScale = resolutionScale * (shape.customScale ?? 1);
    return {
      ...shape,
      cx: shape.cx * resolutionScale,
      cy: shape.cy * resolutionScale,
      width: shape.width !== undefined ? shape.width * resolutionScale : undefined,
      height:
        shape.height === undefined
          ? undefined
          : shape.type === 'flatPlate'
            ? Math.max(1, Math.round(shape.height))
            : shape.height * resolutionScale,
      radius: shape.radius !== undefined ? shape.radius * resolutionScale : undefined,
      chord: shape.chord !== undefined ? shape.chord * resolutionScale : undefined,
      stencilX:
        shape.stencilX?.map((v) => Math.round(v * sizeScale)) ?? shape.stencilX,
      stencilY:
        shape.stencilY?.map((v) => Math.round(v * sizeScale)) ?? shape.stencilY,
    };
  });
}

/** Thin body aligned with local x (streamwise at aoa = 0°). */
export function pointInFlatPlate(
  xRot: number,
  yRot: number,
  length: number,
  thickness: number,
): boolean {
  const halfLen = Math.max(1, length) / 2;
  const halfThick = Math.max(1, thickness) / 2;
  return Math.abs(xRot) <= halfLen && Math.abs(yRot) < halfThick;
}

/** Diamond profile: square rotated 45° with independent horizontal/vertical scale. */
export function pointInDoubleWedge(
  xRot: number,
  yRot: number,
  length: number,
  thickness: number,
): boolean {
  const halfLen = Math.max(1, length) / 2;
  const halfThick = Math.max(1, thickness) / 2;
  return Math.abs(xRot) / halfLen + Math.abs(yRot) / halfThick <= 1;
}

/** Build obstacle mask — direct port of gem.py multi-obstacle generation. */
export function buildObstacleMask(
  nx: number,
  ny: number,
  shapes: LbmShapeSpec[],
): Uint8Array {
  const obstacle = new Uint8Array(nx * ny);

  for (const shape of shapes) {
    const cx = shape.cx;
    const cy = shape.cy;
    const aoa = shape.aoa ?? 0;
    const invertAoa = shape.type === 'square' || shape.type === 'flatPlate';
    const rad = ((invertAoa ? aoa : -aoa) * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    if (shape.type === 'airfoil') {
      stampAirfoil(obstacle, nx, ny, shape, cx, cy, cosA, sinA);
      continue;
    }

    if (shape.type === 'custom') {
      stampCustom(obstacle, nx, ny, shape, cx, cy, cosA, sinA);
      continue;
    }

    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        const xLocal = x - cx;
        const yLocal = y - cy;
        const xRot = xLocal * cosA - yLocal * sinA;
        const yRot = xLocal * sinA + yLocal * cosA;

        if (shape.type === 'square') {
          const wHalf = (shape.width ?? 20) / 2;
          const hHalf = (shape.height ?? 20) / 2;
          if (xRot >= -wHalf && xRot <= wHalf && yRot >= -hHalf && yRot <= hHalf) {
            obstacle[x * ny + y] = 1;
          }
        } else if (shape.type === 'circle') {
          const r = Math.max(1, shape.radius ?? 12);
          if (xRot * xRot + yRot * yRot <= r * r) {
            obstacle[x * ny + y] = 1;
          }
        } else if (shape.type === 'doubleWedge') {
          if (
            pointInDoubleWedge(
              xRot,
              yRot,
              shape.width ?? 60,
              shape.height ?? 24,
            )
          ) {
            obstacle[x * ny + y] = 1;
          }
        } else if (shape.type === 'flatPlate') {
          if (
            pointInFlatPlate(
              xRot,
              yRot,
              shape.width ?? 80,
              shape.height ?? 1,
            )
          ) {
            obstacle[x * ny + y] = 1;
          }
        }
      }
    }
  }

  return obstacle;
}

function stampCustom(
  obstacle: Uint8Array,
  nx: number,
  ny: number,
  shape: LbmShapeSpec,
  cx: number,
  cy: number,
  cosA: number,
  sinA: number,
): void {
  const stencilX = shape.stencilX;
  const stencilY = shape.stencilY;
  if (!stencilX?.length || !stencilY?.length) return;

  for (let i = 0; i < stencilX.length; i++) {
    const xRot = stencilX[i] * cosA - stencilY[i] * sinA;
    const yRot = stencilX[i] * sinA + stencilY[i] * cosA;
    const gridX = Math.round(cx + xRot);
    const gridY = Math.round(cy + yRot);
    if (gridX >= 0 && gridX < nx && gridY >= 0 && gridY < ny) {
      obstacle[gridX * ny + gridY] = 1;
    }
  }
}

function stampAirfoil(
  obstacle: Uint8Array,
  nx: number,
  ny: number,
  shape: LbmShapeSpec,
  cx: number,
  cy: number,
  cosA: number,
  sinA: number,
): void {
  const chord = Math.max(1, Math.round(shape.chord ?? 80));
  const nacaCode = shape.naca ?? '0012';
  const m = parseInt(nacaCode[0], 10) / 100;
  const p = parseInt(nacaCode[1], 10) / 10;
  const t = parseInt(nacaCode.slice(2), 10) / 100;

  for (let xIdx = 0; xIdx < chord; xIdx++) {
    const xc = xIdx / chord;
    const yt =
      5 *
      t *
      chord *
      (0.2969 * Math.sqrt(xc) -
        0.126 * xc -
        0.3516 * xc ** 2 +
        0.2843 * xc ** 3 -
        0.1015 * xc ** 4);

    let yc: number;
    let dycDxc: number;
    if (p === 0) {
      yc = 0;
      dycDxc = 0;
    } else if (xc <= p) {
      yc = (m * chord / (p * p)) * (2 * p * xc - xc * xc);
      dycDxc = (2 * m / (p * p)) * (p - xc);
    } else {
      yc = (m * chord / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * xc - xc * xc);
      dycDxc = (2 * m / ((1 - p) ** 2)) * (p - xc);
    }

    const theta = Math.atan(dycDxc);
    const xu = xIdx - yt * Math.sin(theta);
    const yu = yc + yt * Math.cos(theta);
    const xl = xIdx + yt * Math.sin(theta);
    const yl = yc - yt * Math.cos(theta);

    const localXu = xu - Math.floor(chord / 4);
    const localYu = yu;
    const localXl = xl - Math.floor(chord / 4);
    const localYl = yl;

    const yMinBound = Math.min(localYu, localYl);
    const yMaxBound = Math.max(localYu, localYl);
    const avgLocalX = (localXu + localXl) / 2;

    const steps = Math.max(2, Math.floor(Math.abs(yMaxBound - yMinBound)) + 2);
    for (let s = 0; s < steps; s++) {
      const yOffset = yMinBound + (s / (steps - 1)) * (yMaxBound - yMinBound);
      for (const xSpread of [-0.5, 0, 0.5]) {
        const rotX = (avgLocalX + xSpread) * cosA - yOffset * sinA;
        const rotY = (avgLocalX + xSpread) * sinA + yOffset * cosA;
        const gridX = Math.round(cx + rotX);
        const gridY = Math.round(cy + rotY);
        if (gridX >= 0 && gridX < nx && gridY >= 0 && gridY < ny) {
          obstacle[gridX * ny + gridY] = 1;
        }
      }
    }
  }
}

let lbmShapeIdCounter = 100;

export function nextLbmShapeId(): string {
  return `lbm-${++lbmShapeIdCounter}`;
}

export function defaultLbmShapes(): LbmShapeInput[] {
  return [
    {
      id: 'lbm-1',
      type: 'airfoil',
      cx: 100,
      cy: 50,
      chord: 80,
      aoa: 15,
      naca: '2412',
    },
    {
      id: 'lbm-2',
      type: 'square',
      cx: 220,
      cy: 40,
      width: 20,
      height: 20,
      aoa: 30,
    },
  ];
}
