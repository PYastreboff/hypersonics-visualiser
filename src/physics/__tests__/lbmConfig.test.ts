import { describe, expect, it } from 'vitest';
import {
  formatEulerElapsedMs,
  formatLiveSimTime,
  formatPhysicalSimTime,
  isLiveSimRealTime,
  liveSimTimeMsFromFrames,
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

  it('formats physical simulation time for hypersonic scales', () => {
    expect(formatPhysicalSimTime(0)).toBe('0 µs');
    expect(formatPhysicalSimTime(8.4e-7)).toBe('0.8 µs');
    expect(formatPhysicalSimTime(1.2e-3)).toBe('1.20 ms');
    expect(formatPhysicalSimTime(0.842e-3)).toBe('842 µs');
    expect(formatPhysicalSimTime(1.5)).toBe('1.50 s');
  });

  it('formats live Euler elapsed time', () => {
    expect(formatEulerElapsedMs(0)).toBe('0 ms');
    expect(formatEulerElapsedMs(842)).toBe('842 ms');
    expect(formatEulerElapsedMs(999)).toBe('999 ms');
    expect(formatEulerElapsedMs(1000)).toBe('1.0 s');
    expect(formatEulerElapsedMs(2340)).toBe('2.3 s');
  });

  it('maps live frames to simulation time', () => {
    expect(liveSimTimeMsFromFrames(0)).toBe(0);
    expect(liveSimTimeMsFromFrames(1)).toBe(30);
    expect(liveSimTimeMsFromFrames(33)).toBe(990);
  });

  it('detects real-time live simulation pace', () => {
    expect(isLiveSimRealTime(0, 100)).toBe(false);
    expect(isLiveSimRealTime(30, 30)).toBe(true);
    expect(isLiveSimRealTime(300, 320)).toBe(true);
    expect(isLiveSimRealTime(300, 500)).toBe(false);
  });

  it('formats live sim time with real-time label', () => {
    expect(formatLiveSimTime(500, false)).toBe('500 ms');
    expect(formatLiveSimTime(500, true)).toBe('500 ms · real time');
    expect(formatLiveSimTime(1500, true)).toBe('1.5 s · real time');
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
