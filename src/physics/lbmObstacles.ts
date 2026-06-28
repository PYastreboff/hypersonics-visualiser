import type { LbmShapeInput } from '@/types';

export interface LbmShapeSpec {
  type: 'square' | 'circle' | 'airfoil';
  cx: number;
  cy: number;
  aoa: number;
  width?: number;
  height?: number;
  radius?: number;
  chord?: number;
  naca?: string;
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
  };
}

/** Scale shape geometry to match gem.py RESOLUTION_SCALE handling. */
export function scaleShapeSpecs(
  shapes: LbmShapeSpec[],
  resolutionScale: number,
): LbmShapeSpec[] {
  return shapes.map((shape) => ({
    ...shape,
    cx: shape.cx * resolutionScale,
    cy: shape.cy * resolutionScale,
    width: shape.width !== undefined ? shape.width * resolutionScale : undefined,
    height: shape.height !== undefined ? shape.height * resolutionScale : undefined,
    radius: shape.radius !== undefined ? shape.radius * resolutionScale : undefined,
    chord: shape.chord !== undefined ? shape.chord * resolutionScale : undefined,
  }));
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
    const rad = (-aoa * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    if (shape.type === 'airfoil') {
      stampAirfoil(obstacle, nx, ny, shape, cx, cy, cosA, sinA);
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
        }
      }
    }
  }

  return obstacle;
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
