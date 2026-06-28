import { describe, expect, it } from 'vitest';
import { lbmMetricColor, lbmObstacleColor, metricRange, fluidFieldMetricRange, resolveTunnelMetricRange, rainbowColor } from '@/visualization/jetColormap';
import { LbmSolver } from '@/physics/lbmSolver';

describe('lbm colormaps', () => {
  it('uses rainbow for all display modes', () => {
    expect(lbmMetricColor('velocity', 0)).toEqual(rainbowColor(0));
    expect(lbmMetricColor('pressure', 0)).toEqual(rainbowColor(0));
    expect(lbmMetricColor('pressure', 1)).toEqual(rainbowColor(1));
    expect(lbmMetricColor('velocity', 0.5)).toEqual(rainbowColor(0.5));
  });

  it('rainbow spans blue at low t to red at high t', () => {
    const [rLow, , bLow] = rainbowColor(0);
    const [rHigh, , bHigh] = rainbowColor(1);
    expect(bLow).toBeGreaterThan(rLow);
    expect(rHigh).toBeGreaterThan(bHigh);
  });

  it('uses grey obstacles on rainbow fields', () => {
    expect(lbmObstacleColor('velocity', false, 'lbm')).toEqual([191, 191, 191]);
    expect(lbmObstacleColor('velocity', false, 'euler')).toEqual([191, 191, 191]);
    expect(lbmObstacleColor('mach', false, 'euler')).toEqual([191, 191, 191]);
    expect(lbmObstacleColor('pressure', false, 'lbm')).toEqual([191, 191, 191]);
    expect(lbmObstacleColor('pressure', false, 'euler')).toEqual([191, 191, 191]);
  });
});

describe('metricRange', () => {
  it('scales pressure legend with fluid density', () => {
    const light = metricRange('pressure', 0.1, 0.6);
    const heavy = metricRange('pressure', 0.1, 1.6);
    expect(heavy.vmin).toBeGreaterThan(light.vmin);
    expect(heavy.vmax).toBeGreaterThan(light.vmax);
  });

  it('keeps velocity legend independent of fluid density', () => {
    const a = metricRange('velocity', 0.12, 0.6);
    const b = metricRange('velocity', 0.12, 1.6);
    expect(a).toEqual(b);
  });
});

describe('fluidFieldMetricRange', () => {
  it('uses min/max of fluid cells for adaptive Euler scaling', () => {
    const metric = new Float32Array([1, 5, 2, 9]);
    const obstacle = new Uint8Array([0, 1, 0, 0]);
    const range = fluidFieldMetricRange(metric, obstacle);
    expect(range).not.toBeNull();
    expect(range!.vmin).toBeLessThan(1);
    expect(range!.vmax).toBeGreaterThan(9);
  });

  it('prefers adaptive Euler range over fixed freestream span', () => {
    const metric = new Float32Array([1.9, 2.0, 2.1, 0.4]);
    const obstacle = new Uint8Array(4);
    const adaptive = resolveTunnelMetricRange(
      'euler',
      'mach',
      0,
      1,
      2,
      0,
      metric,
      obstacle,
    );
    const fixed = resolveTunnelMetricRange('euler', 'mach', 0, 1, 2, 0);
    expect(adaptive.vmax - adaptive.vmin).toBeLessThan(fixed.vmax - fixed.vmin);
  });
});

describe('LbmSolver fluid density', () => {
  it('uses rho0 at the inlet boundary', () => {
    const obstacle = new Uint8Array(40 * 20);
    const solver = new LbmSolver({ nx: 40, ny: 20, windSpeed: 0.1, rho0: 1.4 }, obstacle);
    solver.step();
    const { rho } = solver.getMacroscopic();
    expect(rho[0]).toBeCloseTo(1.4, 5);
  });

  it('updates rho0 in place while preserving velocity', () => {
    const obstacle = new Uint8Array(40 * 20);
    const solver = new LbmSolver({ nx: 40, ny: 20, windSpeed: 0.1, rho0: 1 }, obstacle);
    for (let i = 0; i < 20; i++) solver.step();
    const before = solver.getMacroscopic();
    const sampleIdx = 40 * 10 + 10;
    const speedBefore = Math.hypot(before.ux[sampleIdx], before.uy[sampleIdx]);

    solver.updateFluidDensity(1.5);
    const after = solver.getMacroscopic();
    expect(after.rho[sampleIdx]).toBeCloseTo(before.rho[sampleIdx] * 1.5, 4);
    expect(Math.hypot(after.ux[sampleIdx], after.uy[sampleIdx])).toBeCloseTo(speedBefore, 4);
  });
});
