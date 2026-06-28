import { lbmTotalFrames } from './lbmConfig';
import { LbmGpuSimulator, tryCreateLbmGpuDevice, type LbmGpuBackend } from './lbmGpu';
import type { LbmPrerenderParams, LbmPrerenderResult } from './lbmPrerender';
import { prerenderLbm } from './lbmPrerender';

export async function prerenderLbmGpu(
  params: LbmPrerenderParams,
  onProgress?: (progress: number, backend: LbmGpuBackend) => void,
  shouldCancel?: () => boolean,
): Promise<LbmPrerenderResult> {
  const { nx, ny, windSpeed, fluidDensity, renderStep, playbackSeconds, obstacle } = params;
  const rho0 = fluidDensity ?? 1;
  const totalFrames = lbmTotalFrames(playbackSeconds);
  const cellCount = nx * ny;

  const device = await tryCreateLbmGpuDevice();
  if (!device) {
    throw new Error('WebGPU unavailable');
  }

  const sim = await LbmGpuSimulator.create(device, {
    nx,
    ny,
    windSpeed,
    rho0,
    obstacle,
  });

  const velocityFrames = new Float32Array(totalFrames * cellCount);
  const pressureFrames = new Float32Array(totalFrames * cellCount);

  try {
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (shouldCancel?.()) {
        throw new Error('cancelled');
      }

      await sim.advance(renderStep);
      const { ux, uy, rho } = await sim.readDisplay();
      const base = frameIdx * cellCount;
      for (let i = 0; i < cellCount; i++) {
        velocityFrames[base + i] = Math.hypot(ux[i], uy[i]);
        pressureFrames[base + i] = rho[i] * (1 / 3);
      }
      onProgress?.((frameIdx + 1) / totalFrames, 'gpu');
    }
  } finally {
    sim.destroy();
    device.destroy();
  }

  return {
    velocityFrames,
    pressureFrames,
    totalFrames,
    nx,
    ny,
    fluidDensity: rho0,
    windSpeed,
  };
}

export async function prerenderLbmAuto(
  params: LbmPrerenderParams,
  onProgress?: (progress: number, backend: LbmGpuBackend) => void,
  shouldCancel?: () => boolean,
): Promise<{ result: LbmPrerenderResult; backend: LbmGpuBackend }> {
  try {
    const result = await prerenderLbmGpu(params, onProgress, shouldCancel);
    return { result, backend: 'gpu' };
  } catch (err) {
    if (shouldCancel?.() || (err instanceof Error && err.message === 'cancelled')) {
      throw err;
    }
    console.warn('GPU LBM pre-render failed, using CPU fallback:', err);
    const result = prerenderLbm(
      params,
      (progress) => onProgress?.(progress, 'cpu'),
      shouldCancel,
    );
    return { result, backend: 'cpu' };
  }
}
