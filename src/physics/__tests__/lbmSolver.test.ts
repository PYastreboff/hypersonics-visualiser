import { describe, expect, it } from 'vitest';
import { LbmSolver } from '@/physics/lbmSolver';

describe('LbmSolver inlet column', () => {
  it('reports prescribed inlet speed and density on x = 0 after stepping', () => {
    const nx = 40;
    const ny = 20;
    const obstacle = new Uint8Array(nx * ny);
    const solver = new LbmSolver({ nx, ny, windSpeed: 0.12, rho0: 1.1 }, obstacle);

    for (let i = 0; i < 30; i++) {
      solver.step();
    }

    const { ux, uy, rho } = solver.getDisplayMacroscopic();
    for (let y = 0; y < ny; y++) {
      expect(ux[y]).toBeCloseTo(0.12, 5);
      expect(uy[y]).toBeCloseTo(0, 5);
      expect(rho[y]).toBeCloseTo(1.1, 5);
    }
  });

  it('zeros inlet column cells that are obstacles', () => {
    const nx = 40;
    const ny = 20;
    const obstacle = new Uint8Array(nx * ny);
    obstacle[5] = 1;
    const solver = new LbmSolver({ nx, ny, windSpeed: 0.12, rho0: 1 }, obstacle);

    solver.step();
    const { ux, uy } = solver.getDisplayMacroscopic();
    expect(ux[5]).toBe(0);
    expect(uy[5]).toBe(0);
    expect(ux[0]).toBeCloseTo(0.12, 5);
  });

  it('updates wind speed in place on the inlet column', () => {
    const obstacle = new Uint8Array(40 * 20);
    const solver = new LbmSolver({ nx: 40, ny: 20, windSpeed: 0.1, rho0: 1 }, obstacle);
    for (let i = 0; i < 10; i++) solver.step();

    solver.updateWindSpeed(0.14);
    solver.step();
    const { ux } = solver.getDisplayMacroscopic();
    expect(ux[0]).toBeCloseTo(0.14, 5);
  });

  it('supports zero inlet speed', () => {
    const solver = new LbmSolver({ nx: 40, ny: 20, windSpeed: 0, rho0: 1 }, new Uint8Array(40 * 20));
    for (let i = 0; i < 10; i++) solver.step();
    const { ux } = solver.getDisplayMacroscopic();
    expect(ux[0]).toBe(0);
    expect(ux[40]).toBeCloseTo(0, 2);
  });

  it('matches gem.py by using pre-collision display state for metrics', () => {
    const solver = new LbmSolver({ nx: 40, ny: 20, windSpeed: 0.12, rho0: 1 }, new Uint8Array(40 * 20));
    solver.step();
    const metric = solver.getMetric('velocity');
    expect(metric[0]).toBeCloseTo(0.12, 5);
    expect(metric[20]).not.toBeCloseTo(metric[0], 1);
  });
});
