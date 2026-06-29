import { describe, expect, it } from 'vitest';
import {
  computeEulerTunnelDrag,
  computeLbmTunnelDrag,
  computeTunnelDragFromPressure,
} from '@/physics/tunnelDrag';

describe('computeTunnelDragFromPressure', () => {
  const nx = 40;
  const ny = 20;
  const p0 = 100_000;
  const q0 = 50_000;
  const lengthM = 3;
  const heightM = 1.5;

  it('returns null when there is no obstacle', () => {
    const obstacle = new Uint8Array(nx * ny);
    const pressure = new Float32Array(nx * ny).fill(p0);
    expect(
      computeTunnelDragFromPressure(pressure, obstacle, nx, ny, p0, q0, lengthM, heightM),
    ).toBeNull();
  });

  it('estimates positive drag from high pressure on the windward face', () => {
    const obstacle = new Uint8Array(nx * ny);
    const pressure = new Float32Array(nx * ny).fill(p0);

    for (let y = 6; y <= 13; y++) {
      for (let x = 18; x <= 22; x++) {
        obstacle[x * ny + y] = 1;
      }
    }
    for (let y = 6; y <= 13; y++) {
      pressure[17 * ny + y] = p0 + 4 * q0;
    }

    const result = computeTunnelDragFromPressure(
      pressure,
      obstacle,
      nx,
      ny,
      p0,
      q0,
      lengthM,
      heightM,
    );
    expect(result).not.toBeNull();
    expect(result!.cd).toBeGreaterThan(0);
  });

  it('returns near-zero Cd when solid cells alone are at freestream pressure', () => {
    const obstacle = new Uint8Array(nx * ny);
    const pressure = new Float32Array(nx * ny).fill(p0);

    for (let y = 8; y <= 11; y++) {
      for (let x = 19; x <= 21; x++) {
        obstacle[x * ny + y] = 1;
        pressure[x * ny + y] = p0;
      }
    }
    pressure[18 * ny + 10] = p0 + 2 * q0;

    const withFluid = computeTunnelDragFromPressure(
      pressure,
      obstacle,
      nx,
      ny,
      p0,
      q0,
      lengthM,
      heightM,
    );
    expect(withFluid!.cd).toBeGreaterThan(0.5);

    pressure[18 * ny + 10] = p0;
    const flat = computeTunnelDragFromPressure(
      pressure,
      obstacle,
      nx,
      ny,
      p0,
      q0,
      lengthM,
      heightM,
    );
    expect(Math.abs(flat!.cd)).toBeLessThan(0.05);
  });

  it('applies modified Newtonian windward pressure at high Mach', () => {
    const obstacle = new Uint8Array(nx * ny);
    const pressure = new Float32Array(nx * ny).fill(p0);

    for (let y = 8; y <= 12; y++) {
      for (let x = 19; x <= 23; x++) {
        obstacle[x * ny + y] = 1;
      }
    }

    const lowMach = computeTunnelDragFromPressure(
      pressure,
      obstacle,
      nx,
      ny,
      p0,
      q0,
      lengthM,
      heightM,
      0.5,
    );
    const highMach = computeTunnelDragFromPressure(
      pressure,
      obstacle,
      nx,
      ny,
      p0,
      q0,
      lengthM,
      heightM,
      9,
    );

    expect(lowMach!.cd).toBeLessThan(0.05);
    expect(highMach!.cd).toBeGreaterThan(1.5);
    expect(highMach!.cd).toBeLessThan(2.5);
  });
});

describe('computeLbmTunnelDrag', () => {
  it('produces positive Cd from lattice pressure field', () => {
    const nx = 40;
    const ny = 20;
    const obstacle = new Uint8Array(nx * ny);
    const pressure = new Float32Array(nx * ny);
    const rho0 = 1;
    const p0 = rho0 / 3;
    const u0 = 0.1;
    const q0 = 0.5 * rho0 * u0 * u0;

    pressure.fill(p0);
    for (let y = 6; y <= 13; y++) {
      for (let x = 18; x <= 22; x++) {
        obstacle[x * ny + y] = 1;
      }
    }
    for (let y = 6; y <= 13; y++) {
      pressure[17 * ny + y] = p0 + 3 * q0;
    }

    const result = computeLbmTunnelDrag(pressure, obstacle, nx, ny, u0, rho0);
    expect(result).not.toBeNull();
    expect(result!.cd).toBeGreaterThan(0);
  });
});

describe('computeEulerTunnelDrag', () => {
  it('delegates to tunnel pressure integration', () => {
    const nx = 20;
    const ny = 10;
    const obstacle = new Uint8Array(nx * ny);
    const pressure = new Float32Array(nx * ny).fill(1e5);
    obstacle[10 * ny + 5] = 1;
    pressure[9 * ny + 5] = 1.2e5;

    const result = computeEulerTunnelDrag(pressure, obstacle, nx, ny, 1e5, 5e4);
    expect(result?.cd).toBeGreaterThan(0);
  });
});
