import { describe, expect, it } from 'vitest';
import {
  lbmFrameToTime,
  lbmGridSize,
  lbmResolutionLabel,
  lbmTotalFrames,
  snapLbmResolutionScale,
} from '@/physics/lbmConfig';

describe('lbm timing (gem.py)', () => {
  it('computes total frames like int(PLAYBACK * 1000/30)', () => {
    expect(lbmTotalFrames(6)).toBe(200);
    expect(lbmTotalFrames(1)).toBe(33);
  });

  it('maps frame index to time like round(frame*30/1000, 1)', () => {
    expect(lbmFrameToTime(0)).toBe(0);
    expect(lbmFrameToTime(1)).toBe(0);
    expect(lbmFrameToTime(33)).toBe(1);
    expect(lbmFrameToTime(199)).toBe(6);
  });
});

describe('lbm resolution scales', () => {
  it('snaps to nearest allowed scale', () => {
    expect(snapLbmResolutionScale(2.4)).toBe(2);
    expect(snapLbmResolutionScale(5.5)).toBe(6);
  });

  it('computes larger grids for high scales', () => {
    expect(lbmGridSize(300, 100, 4)).toEqual({ nx: 1200, ny: 400, renderStep: 80 });
    expect(lbmGridSize(300, 100, 6)).toEqual({ nx: 1800, ny: 600, renderStep: 120 });
  });

  it('scales custom tunnel dimensions', () => {
    expect(lbmGridSize(600, 200, 1)).toEqual({ nx: 600, ny: 200, renderStep: 20 });
  });

  it('labels include grid dimensions', () => {
    expect(lbmResolutionLabel(3)).toContain('900 × 300');
  });
});
