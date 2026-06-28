import { LbmSolver } from './lbmSolver';
import { lbmTotalFrames } from './lbmConfig';

export interface LbmPrerenderParams {
  nx: number;
  ny: number;
  windSpeed: number;
  fluidDensity?: number;
  renderStep: number;
  playbackSeconds: number;
  obstacle: Uint8Array;
}

export interface LbmPrerenderResult {
  velocityFrames: Float32Array;
  pressureFrames: Float32Array;
  totalFrames: number;
  nx: number;
  ny: number;
  /** ρ₀ used when these frames were baked. */
  fluidDensity: number;
  /** Inlet speed used when these frames were baked. */
  windSpeed: number;
}

export function prerenderLbm(
  params: LbmPrerenderParams,
  onProgress?: (progress: number) => void,
  shouldCancel?: () => boolean,
): LbmPrerenderResult {
  const { nx, ny, windSpeed, fluidDensity, renderStep, playbackSeconds, obstacle } = params;
  const totalFrames = lbmTotalFrames(playbackSeconds);
  const totalPhysicsSteps = totalFrames * renderStep;
  const cellCount = nx * ny;

  const solver = new LbmSolver({ nx, ny, windSpeed, rho0: fluidDensity }, obstacle);
  const velocityFrames = new Float32Array(totalFrames * cellCount);
  const pressureFrames = new Float32Array(totalFrames * cellCount);

  let frameIdx = 0;
  for (let t = 0; t < totalPhysicsSteps; t++) {
    if (shouldCancel?.()) {
      throw new Error('cancelled');
    }

    solver.step();

    if (t % renderStep === 0) {
      const velocityMetric = solver.getMetric('velocity');
      const pressureMetric = solver.getMetric('pressure');
      const base = frameIdx * cellCount;
      for (let i = 0; i < cellCount; i++) {
        velocityFrames[base + i] = velocityMetric[i];
        pressureFrames[base + i] = pressureMetric[i];
      }
      frameIdx += 1;
      onProgress?.(frameIdx / totalFrames);
    }
  }

  return {
    velocityFrames,
    pressureFrames,
    totalFrames,
    nx,
    ny,
    fluidDensity: fluidDensity ?? 1,
    windSpeed,
  };
}

function scalePrerenderSlice(
  slice: Float32Array,
  scale: number,
): Float32Array {
  if (Math.abs(scale - 1) < 1e-9) {
    return slice;
  }
  const scaled = new Float32Array(slice.length);
  for (let i = 0; i < slice.length; i++) {
    scaled[i] = slice[i] * scale;
  }
  return scaled;
}

export function getPrerenderFrame(
  result: LbmPrerenderResult,
  frameIdx: number,
  displayMode: 'velocity' | 'pressure',
  fluidDensity?: number,
  windSpeed?: number,
): Float32Array {
  const { nx, ny, totalFrames, velocityFrames, pressureFrames } = result;
  const idx = ((frameIdx % totalFrames) + totalFrames) % totalFrames;
  const base = idx * nx * ny;
  const source = displayMode === 'velocity' ? velocityFrames : pressureFrames;
  const slice = source.subarray(base, base + nx * ny);

  if (displayMode === 'velocity' && windSpeed !== undefined) {
    return scalePrerenderSlice(slice, windSpeed / result.windSpeed);
  }

  if (displayMode === 'pressure' && fluidDensity !== undefined) {
    return scalePrerenderSlice(slice, fluidDensity / result.fluidDensity);
  }

  return slice;
}
