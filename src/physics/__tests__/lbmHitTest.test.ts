import { describe, expect, it } from 'vitest';
import { brushScreenCircle, screenToGrid } from '@/physics/lbmHitTest';

function fitDrawRect(
  containerW: number,
  containerH: number,
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  if (containerW <= 0 || containerH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const containerAspect = containerW / containerH;
  if (containerAspect > aspect) {
    const h = containerH;
    const w = h * aspect;
    return { x: (containerW - w) / 2, y: 0, w, h };
  }
  const w = containerW;
  const h = w / aspect;
  return { x: 0, y: (containerH - h) / 2, w, h };
}

function mockSurface(width: number, height: number, left = 0, top = 0): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }),
  } as HTMLElement;
}

describe('screenToGrid', () => {
  it('maps pointer position into the letterboxed draw area', () => {
    const nx = 300;
    const ny = 100;
    const surface = mockSurface(900, 400);
    const draw = fitDrawRect(900, 400, nx / ny);
    const clientX = draw.x + draw.w * 0.25;
    const clientY = draw.y + draw.h * 0.5;

    const grid = screenToGrid(clientX, clientY, surface, nx, ny, fitDrawRect);
    const brush = brushScreenCircle(clientX, clientY, surface, nx, ny, 2, 1, fitDrawRect);

    expect(grid?.gx).toBe(75);
    expect(brush?.cx).toBeCloseTo(clientX, 5);
    expect(brush?.cy).toBeCloseTo(clientY, 5);
    expect(brush?.r).toBeCloseTo((draw.w / nx) * 2, 5);
  });
});
