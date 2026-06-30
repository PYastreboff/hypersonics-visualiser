import { describe, expect, it } from 'vitest';
import { runEulerTunnel } from '@/physics/eulerTunnelSolver';
import { runEulerTunnelAuto } from '@/physics/eulerTunnelAuto';

const smallConfig = {
  nx: 60,
  ny: 30,
  obstacle: new Uint8Array(60 * 30),
  mach: 0.2,
  altitude: 0,
  steps: 120,
};

describe('runEulerTunnelAuto', () => {
  it('falls back through backends when WASM is unavailable', async () => {
    const cpu = runEulerTunnel(smallConfig, () => {}, () => false);
    const { result, backend } = await runEulerTunnelAuto(smallConfig);

    expect(['gpu', 'wasm', 'cpu']).toContain(backend);
    expect(result.velocity.length).toBe(smallConfig.nx * smallConfig.ny);
    expect(result.velocity[1 * smallConfig.ny + 15]).toBeCloseTo(
      cpu.velocity[1 * smallConfig.ny + 15],
      backend === 'gpu' ? 0 : 1,
    );
    expect(result.machField[1 * smallConfig.ny + 15]).toBeGreaterThan(0.05);
  });

  it('WASM path matches CPU inlet velocity on small grid', async () => {
    const { runEulerTunnelWasmPath } = await import('@/physics/eulerTunnelAuto');
    const cpu = runEulerTunnel(smallConfig, () => {}, () => false);
    const wasm = await runEulerTunnelWasmPath(smallConfig);

    expect(wasm.velocity[1 * smallConfig.ny + 15]).toBeCloseTo(
      cpu.velocity[1 * smallConfig.ny + 15],
      0,
    );
  });

  it('WASM path reports step progress during solve', async () => {
    const { runEulerTunnelWasmPath } = await import('@/physics/eulerTunnelAuto');
    const samples: number[] = [];
    await runEulerTunnelWasmPath(smallConfig, (progress) => samples.push(progress));
    expect(samples.length).toBeGreaterThan(2);
    expect(samples[0]).toBeLessThanOrEqual(samples[samples.length - 1]!);
    expect(samples[samples.length - 1]).toBe(1);
  });

  it('uses CPU backend for non-default Euler options', async () => {
    const cases = [
      { scheme: 'hllc' as const },
      { scheme: 'roe' as const },
      { spatialOrder: 'muscl' as const },
    ];
    for (const extra of cases) {
      const { backend, result } = await runEulerTunnelAuto({ ...smallConfig, ...extra });
      expect(backend).toBe('cpu');
      expect(result.machField[1 * smallConfig.ny + 15]).toBeGreaterThan(0.05);
    }
  });
});
