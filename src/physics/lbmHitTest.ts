import type { LbmShapeInput } from '@/types';
import {
  buildObstacleMask,
  lbmInputToSpec,
  scaleShapeSpecs,
  type LbmShapeSpec,
} from './lbmObstacles';

function pointInSpec(gx: number, gy: number, spec: LbmShapeSpec): boolean {
  const cx = spec.cx;
  const cy = spec.cy;
  const aoa = spec.aoa ?? 0;
  const rad = (-aoa * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const xLocal = gx - cx;
  const yLocal = gy - cy;
  const xRot = xLocal * cosA - yLocal * sinA;
  const yRot = xLocal * sinA + yLocal * cosA;

  if (spec.type === 'square') {
    const wHalf = (spec.width ?? 20) / 2;
    const hHalf = (spec.height ?? 20) / 2;
    return xRot >= -wHalf && xRot <= wHalf && yRot >= -hHalf && yRot <= hHalf;
  }

  if (spec.type === 'circle') {
    const r = Math.max(1, spec.radius ?? 12);
    return xRot * xRot + yRot * yRot <= r * r;
  }

  return false;
}

/** Topmost shape at grid cell (scaled coordinates). */
export function findShapeAtGrid(
  gx: number,
  gy: number,
  nx: number,
  ny: number,
  shapes: LbmShapeInput[],
  resolutionScale: number,
): LbmShapeInput | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    const [spec] = scaleShapeSpecs([lbmInputToSpec(shape)], resolutionScale);

    if (spec.type === 'airfoil') {
      const mask = buildObstacleMask(nx, ny, [spec]);
      if (mask[gx * ny + gy]) return shape;
      continue;
    }

    if (pointInSpec(gx, gy, spec)) return shape;
  }
  return null;
}

export function screenToGrid(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  nx: number,
  ny: number,
  fitDrawRect: (
    w: number,
    h: number,
    aspect: number,
  ) => { x: number; y: number; w: number; h: number },
): { gx: number; gy: number } | null {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  const px = (clientX - bounds.left) * scaleX;
  const py = (clientY - bounds.top) * scaleY;

  const draw = fitDrawRect(canvas.width, canvas.height, nx / ny);
  if (
    px < draw.x ||
    px > draw.x + draw.w ||
    py < draw.y ||
    py > draw.y + draw.h
  ) {
    return null;
  }

  const u = (px - draw.x) / draw.w;
  const v = (py - draw.y) / draw.h;
  const gx = Math.min(nx - 1, Math.max(0, Math.floor(u * nx)));
  const gy = Math.min(ny - 1, Math.max(0, Math.floor((1 - v) * ny)));

  return { gx, gy };
}
