import { describe, expect, it } from 'vitest';
import {
  addBrushToStencilSet,
  brushStencilOffsets,
  removeBrushFromStencilSet,
  stencilArraysFromKeys,
  strokeLogicalPoints,
} from '@/physics/lbmDrawBrush';

describe('lbmDrawBrush', () => {
  it('returns centre offset for radius 0', () => {
    expect(brushStencilOffsets(10, 20, 12, 22, 0)).toEqual([[2, 2]]);
  });

  it('accumulates unique stencil cells in a set', () => {
    const keys = new Set<string>();
    addBrushToStencilSet(keys, 0, 0, 0, 0, 1);
    addBrushToStencilSet(keys, 0, 0, 1, 0, 1);

    const { stencilX, stencilY } = stencilArraysFromKeys(keys);
    expect(stencilX.length).toBeGreaterThan(1);
    expect(stencilX.length).toBe(stencilY.length);
  });

  it('removes cells covered by the erase brush', () => {
    const keys = new Set(['0,0', '2,0', '0,2']);
    removeBrushFromStencilSet(keys, 0, 0, 0, 0, 1);
    expect(keys.has('0,0')).toBe(false);
    expect(keys.has('2,0')).toBe(true);
  });

  it('interpolates points along a stroke', () => {
    const points = strokeLogicalPoints({ lx: 0, ly: 0 }, { lx: 4, ly: 0 });
    expect(points.length).toBeGreaterThan(1);
    expect(points[0]).toEqual({ lx: 0, ly: 0 });
    expect(points[points.length - 1]).toEqual({ lx: 4, ly: 0 });
  });
});
