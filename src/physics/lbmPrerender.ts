import { LbmSolver } from './lbmSolver';
import { lbmTotalFrames } from './lbmConfig';

export interface LbmPrerenderParams {
  nx: number;
  ny: number;
  windSpeed: number;
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
}

export function prerenderLbm(
  params: LbmPrerenderParams,
  onProgress?: (progress: number) => void,
  shouldCancel?: () => boolean,
): LbmPrerenderResult {
  const { nx, ny, windSpeed, renderStep, playbackSeconds, obstacle } = params;
  const totalFrames = lbmTotalFrames(playbackSeconds);
  const totalPhysicsSteps = totalFrames * renderStep;
  const cellCount = nx * ny;

  const solver = new LbmSolver({ nx, ny, windSpeed }, obstacle);
  const velocityFrames = new Float32Array(totalFrames * cellCount);
  const pressureFrames = new Float32Array(totalFrames * cellCount);

  let frameIdx = 0;
  for (let t = 0; t < totalPhysicsSteps; t++) {
    if (shouldCancel?.()) {
      throw new Error('cancelled');
    }

    solver.step();

    if (t % renderStep === 0) {
      const { ux, uy, rho } = solver.getMacroscopic();
      const base = frameIdx * cellCount;
      for (let i = 0; i < cellCount; i++) {
        velocityFrames[base + i] = Math.sqrt(ux[i] * ux[i] + uy[i] * uy[i]);
        pressureFrames[base + i] = rho[i] * (1 / 3);
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
  };
}

export function getPrerenderFrame(
  result: LbmPrerenderResult,
  frameIdx: number,
  displayMode: 'velocity' | 'pressure',
): Float32Array {
  const { nx, ny, totalFrames, velocityFrames, pressureFrames } = result;
  const idx = ((frameIdx % totalFrames) + totalFrames) % totalFrames;
  const base = idx * nx * ny;
  const source = displayMode === 'velocity' ? velocityFrames : pressureFrames;
  return source.subarray(base, base + nx * ny);
}
