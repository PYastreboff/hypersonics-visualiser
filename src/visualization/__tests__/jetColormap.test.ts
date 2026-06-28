import { describe, expect, it } from 'vitest';
import { coolwarmColor, jetColor, lbmMetricColor, metricRange } from '@/visualization/jetColormap';
import { LbmSolver } from '@/physics/lbmSolver';

describe('lbm colormaps', () => {
  it('uses jet for velocity and coolwarm for pressure', () => {
    expect(lbmMetricColor('velocity', 0)).toEqual(jetColor(0));
    expect(lbmMetricColor('pressure', 0)).toEqual(coolwarmColor(0));
    expect(lbmMetricColor('pressure', 1)).toEqual(coolwarmColor(1));
  });

  it('pressure endpoints are blue and red', () => {
    const [rLow, , bLow] = coolwarmColor(0);
    const [rHigh, , bHigh] = coolwarmColor(1);
    expect(bLow).toBeGreaterThan(rLow);
    expect(rHigh).toBeGreaterThan(bHigh);
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
