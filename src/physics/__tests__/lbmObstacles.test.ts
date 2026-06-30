import { describe, expect, it } from 'vitest';
import { buildObstacleMask, pointInDoubleWedge, pointInFlatPlate, shapeInputForType } from '@/physics/lbmObstacles';

describe('shapeInputForType', () => {
  it('resets block dimensions when switching to flat plate', () => {
    const block = {
      id: 'a',
      type: 'square' as const,
      cx: 100,
      cy: 50,
      aoa: 0,
      width: 20,
      height: 20,
    };
    const plate = shapeInputForType(block, 'flatPlate');
    expect(plate.width).toBe(80);
    expect(plate.height).toBe(1);

    const maskBlock = buildObstacleMask(120, 40, [
      { type: 'square', cx: 60, cy: 20, aoa: 0, width: 20, height: 20 },
    ]);
    const maskPlate = buildObstacleMask(120, 40, [
      { type: 'flatPlate', cx: 60, cy: 20, aoa: 0, width: 80, height: 1 },
    ]);
    const blockCells = maskBlock.reduce((n, v) => n + v, 0);
    const plateCells = maskPlate.reduce((n, v) => n + v, 0);
    expect(plateCells).toBeLessThan(blockCells / 2);
  });
});

describe('flatPlate obstacle', () => {
  it('is one cell thick at aoa 0 with a point-like leading edge', () => {
    const nx = 120;
    const ny = 40;
    const cy = 20;
    const cx = 60;
    const length = 80;
    const mask = buildObstacleMask(nx, ny, [
      {
        type: 'flatPlate',
        cx,
        cy,
        aoa: 0,
        width: length,
        height: 1,
      },
    ]);

    const leadingX = cx - length / 2;
    let leadingCount = 0;
    for (let y = 0; y < ny; y++) {
      if (mask[leadingX * ny + y]) leadingCount += 1;
    }
    expect(leadingCount).toBe(1);
    expect(mask[leadingX * ny + cy]).toBe(1);
    expect(mask[(cx + length / 2) * ny + cy]).toBe(1);
    expect(mask[cx * ny + cy]).toBe(1);
    expect(mask[cx * ny + cy + 1]).toBe(0);
  });

  it('pointInFlatPlate matches stamp geometry', () => {
    expect(pointInFlatPlate(0, 0, 80, 1)).toBe(true);
    expect(pointInFlatPlate(40, 0, 80, 1)).toBe(true);
    expect(pointInFlatPlate(40.5, 0, 80, 1)).toBe(false);
    expect(pointInFlatPlate(0, 0.5, 80, 1)).toBe(false);
  });

  it('mirrors positive and negative aoa about the shape center', () => {
    const nx = 120;
    const ny = 40;
    const cy = 20;
    const spec = {
      type: 'flatPlate' as const,
      cx: 60,
      cy,
      width: 40,
      height: 1,
    };
    const pos = buildObstacleMask(nx, ny, [{ ...spec, aoa: 12 }]);
    const neg = buildObstacleMask(nx, ny, [{ ...spec, aoa: -12 }]);

    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        const yMir = 2 * cy - y;
        if (yMir < 0 || yMir >= ny) continue;
        expect(pos[x * ny + y]).toBe(neg[x * ny + yMir]);
      }
    }
  });
});

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
