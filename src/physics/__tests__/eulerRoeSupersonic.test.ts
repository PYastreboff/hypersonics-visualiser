import { describe, expect, it } from 'vitest';
import { runEulerTunnel } from '@/physics/eulerTunnelSolver';

describe('roe supersonic obstacle', () => {
  it('stays finite at Ma 2', () => {
    const nx = 120;
    const ny = 60;
    const n = nx * ny;
    const obstacle = new Uint8Array(n);
    for (let x = 40; x < 55; x++) {
      for (let y = 22; y < 38; y++) obstacle[x * ny + y] = 1;
    }
    const result = runEulerTunnel(
      { nx, ny, obstacle, mach: 2, altitude: 0, steps: 500, scheme: 'roe' },
      () => {},
      () => false,
    );
    let nan = 0;
    for (let i = 0; i < n; i++) {
      if (obstacle[i]) continue;
      if (!Number.isFinite(result.velocity[i])) nan += 1;
    }
    expect(nan).toBe(0);
    expect(result.velocity[1 * ny + 30]).toBeGreaterThan(100);
  });
});
