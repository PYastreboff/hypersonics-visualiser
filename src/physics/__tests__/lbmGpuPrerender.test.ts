import { describe, expect, it } from 'vitest';
import { prerenderLbm } from '@/physics/lbmPrerender';
import { prerenderLbmAuto } from '@/physics/lbmGpuPrerender';

const smallParams = {
  nx: 40,
  ny: 20,
  windSpeed: 0.12,
  fluidDensity: 1,
  renderStep: 10,
  playbackSeconds: 0.2,
  obstacle: new Uint8Array(40 * 20),
};

describe('prerenderLbmAuto', () => {
  it('falls back to CPU when WebGPU is unavailable', async () => {
    const cpu = prerenderLbm(smallParams);
    const { result, backend } = await prerenderLbmAuto(smallParams);

    expect(backend).toBe('cpu');
    expect(result.totalFrames).toBe(cpu.totalFrames);
    expect(result.velocityFrames.length).toBe(cpu.velocityFrames.length);
    expect(result.velocityFrames[0]).toBeCloseTo(cpu.velocityFrames[0], 4);
  });

  it('matches CPU inlet velocity when GPU is available', async () => {
    if (!globalThis.navigator?.gpu) return;

    const cpu = prerenderLbm(smallParams);
    const { result, backend } = await prerenderLbmAuto(smallParams);

    expect(['gpu', 'cpu']).toContain(backend);
    expect(result.velocityFrames[0]).toBeCloseTo(cpu.velocityFrames[0], 2);
    expect(result.velocityFrames[40]).toBeGreaterThan(0.05);
  });
});
