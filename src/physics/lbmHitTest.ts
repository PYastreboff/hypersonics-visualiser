import type { LbmShapeInput } from '@/types';
import {
  buildObstacleMask,
  lbmInputToSpec,
  pointInDoubleWedge,
  pointInFlatPlate,
  scaleShapeSpecs,
  type LbmShapeSpec,
} from './lbmObstacles';

function pointInSpec(gx: number, gy: number, spec: LbmShapeSpec): boolean {
  const cx = spec.cx;
  const cy = spec.cy;
  const aoa = spec.aoa ?? 0;
  const invertAoa = spec.type === 'square' || spec.type === 'flatPlate';
  const rad = ((invertAoa ? aoa : -aoa) * Math.PI) / 180;
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

  if (spec.type === 'doubleWedge') {
    return pointInDoubleWedge(
      xRot,
      yRot,
      spec.width ?? 60,
      spec.height ?? 24,
    );
  }

  if (spec.type === 'flatPlate') {
    return pointInFlatPlate(
      xRot,
      yRot,
      spec.width ?? 80,
      spec.height ?? 1,
    );
  }

  if (spec.type === 'custom') {
    const stencilX = spec.stencilX;
    const stencilY = spec.stencilY;
    if (!stencilX?.length || !stencilY?.length) return false;
    const ix = Math.round(xRot);
    const iy = Math.round(yRot);
    for (let i = 0; i < stencilX.length; i++) {
      if (stencilX[i] === ix && stencilY[i] === iy) return true;
    }
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

    if (spec.type === 'airfoil' || spec.type === 'custom') {
      const mask = buildObstacleMask(nx, ny, [spec]);
      if (mask[gx * ny + gy]) return shape;
      continue;
    }

    if (pointInSpec(gx, gy, spec)) return shape;
  }
  return null;
}

type DrawRect = { x: number; y: number; w: number; h: number };

export function screenToTunnelLocal(
  clientX: number,
  clientY: number,
  surface: HTMLElement,
  nx: number,
  ny: number,
  fitDrawRect: (w: number, h: number, aspect: number) => DrawRect,
): { px: number; py: number; draw: DrawRect } | null {
  const bounds = surface.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const px = clientX - bounds.left;
  const py = clientY - bounds.top;
  const draw = fitDrawRect(bounds.width, bounds.height, nx / ny);

  return { px, py, draw };
}

export function screenToGrid(
  clientX: number,
  clientY: number,
  surface: HTMLElement,
  nx: number,
  ny: number,
  fitDrawRect: (w: number, h: number, aspect: number) => DrawRect,
): { gx: number; gy: number } | null {
  const local = screenToTunnelLocal(clientX, clientY, surface, nx, ny, fitDrawRect);
  if (!local) return null;

  const { px, py, draw } = local;
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

export function brushScreenCircle(
  clientX: number,
  clientY: number,
  surface: HTMLElement,
  nx: number,
  ny: number,
  brushRadius: number,
  resolutionScale: number,
  fitDrawRect: (w: number, h: number, aspect: number) => DrawRect,
): { cx: number; cy: number; r: number } | null {
  const local = screenToTunnelLocal(clientX, clientY, surface, nx, ny, fitDrawRect);
  if (!local) return null;

  const { px, py, draw } = local;
  if (
    px < draw.x ||
    px > draw.x + draw.w ||
    py < draw.y ||
    py > draw.y + draw.h
  ) {
    return null;
  }

  const cellSize = draw.w / nx;
  const r = Math.max(0, Math.round(brushRadius)) * resolutionScale * cellSize;

  return { cx: px, cy: py, r };
}
