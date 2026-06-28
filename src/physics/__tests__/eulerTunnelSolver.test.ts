import { describe, expect, it } from 'vitest';
import {
  fluidVelocityMaxDelta,
  getEulerTunnelMetric,
  runEulerTunnel,
} from '@/physics/eulerTunnelSolver';

describe('fluidVelocityMaxDelta', () => {
  it('returns zero for identical velocity fields', () => {
    const u = new Float64Array([10, 20, 0]);
    const v = new Float64Array([0, 1, 0]);
    const solid = new Uint8Array([0, 0, 1]);
    expect(fluidVelocityMaxDelta(u, v, u, v, solid, 100)).toBe(0);
  });
});

describe('runEulerTunnel', () => {
  it('produces inlet-scale velocity for subsonic Mach on an open grid', () => {
    const nx = 60;
    const ny = 30;
    const obstacle = new Uint8Array(nx * ny);
    const result = runEulerTunnel(
      { nx, ny, obstacle, mach: 0.2, altitude: 0, steps: 120 },
      () => {},
      () => false,
    );

    expect(result.velocity.length).toBe(nx * ny);
    const inlet = result.velocity[1 * ny + 15];
    expect(inlet).toBeGreaterThan(50);
    expect(result.machField[1 * ny + 15]).toBeGreaterThan(0.05);
    expect(getEulerTunnelMetric(result, 'mach')).toBe(result.machField);
  });

  it('zeros velocity inside obstacle cells', () => {
    const nx = 40;
    const ny = 20;
    const obstacle = new Uint8Array(nx * ny);
    obstacle[20 * ny + 10] = 1;
    const result = runEulerTunnel(
      { nx, ny, obstacle, mach: 0.15, altitude: 0, steps: 80 },
      () => {},
      () => false,
    );
    expect(result.velocity[20 * ny + 10]).toBe(0);
  });

  it('stops early once the field settles instead of always using max steps', () => {
    const nx = 60;
    const ny = 30;
    const obstacle = new Uint8Array(nx * ny);
    let progress = 0;
    const early = runEulerTunnel(
      { nx, ny, obstacle, mach: 0.2, altitude: 0 },
      (p) => {
        progress = p;
      },
      () => false,
    );
    const forced = runEulerTunnel(
      { nx, ny, obstacle, mach: 0.2, altitude: 0, steps: 120 },
      () => {},
      () => false,
    );

    expect(progress).toBe(1);
    expect(early.velocity[1 * ny + 15]).toBeCloseTo(forced.velocity[1 * ny + 15], 0);
    expect(early.machField[1 * ny + 15]).toBeGreaterThan(0.05);
  });
});
