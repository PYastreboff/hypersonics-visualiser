import { describe, expect, it } from 'vitest';
import { buildObstacleMask, pointInDoubleWedge } from '@/physics/lbmObstacles';

describe('doubleWedge obstacle', () => {
  it('stamps a symmetric diamond profile', () => {
    const nx = 80;
    const ny = 40;
    const mask = buildObstacleMask(nx, ny, [
      {
        type: 'doubleWedge',
        cx: 40,
        cy: 20,
        aoa: 0,
        width: 40,
        height: 20,
      },
    ]);

    expect(mask[40 * ny + 20]).toBe(1);
    expect(mask[20 * ny + 20]).toBe(1);
    expect(mask[60 * ny + 20]).toBe(1);
    expect(mask[40 * ny + 30]).toBe(1);
    expect(mask[40 * ny + 10]).toBe(1);
    expect(mask[10 * ny + 20]).toBe(0);
    expect(mask[40 * ny + 35]).toBe(0);
  });

  it('pointInDoubleWedge matches a vertically squashed 45° square', () => {
    expect(pointInDoubleWedge(0, 5, 40, 20)).toBe(true);
    expect(pointInDoubleWedge(10, 5, 40, 20)).toBe(true);
    expect(pointInDoubleWedge(10, 5.1, 40, 20)).toBe(false);
    expect(pointInDoubleWedge(20, 0, 40, 20)).toBe(true);
    expect(pointInDoubleWedge(21, 0, 40, 20)).toBe(false);
  });
});
