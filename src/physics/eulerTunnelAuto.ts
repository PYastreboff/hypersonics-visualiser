import {
  densityAtAltitude,
  speedOfSound,
  temperatureAtAltitude,
} from '@/physics/atmosphere';
import { GAMMA } from '@/physics/constants';
import {
  fluidVelocityMaxDelta,
  runEulerTunnel,
  type EulerTunnelConfig,
  type EulerTunnelResult,
} from '@/physics/eulerTunnelSolver';
import { runEulerTunnelWasm, tryInitEulerWasm } from '@/physics/eulerTunnelWasm';

export type EulerTunnelBackend = 'gpu' | 'wasm' | 'cpu';

function defaultMaxSteps(nx: number, ny: number): number {
  return Math.min(4000, Math.max(1000, Math.round((nx * ny) / 20)));
}

function freestream(altitude: number, mach: number) {
  const temp = temperatureAtAltitude(altitude);
  const rho0 = densityAtAltitude(altitude);
  const a0 = speedOfSound(temp);
  const u0 = mach * a0;
  const p0 = (rho0 * a0 * a0) / GAMMA;
  return { rho0, u0, p0 };
}

export async function runEulerTunnelGpu(
  config: EulerTunnelConfig,
  onProgress?: (progress: number, backend: EulerTunnelBackend) => void,
  shouldCancel?: () => boolean,
): Promise<EulerTunnelResult> {
  const { EulerGpuSimulator, tryCreateEulerGpuDevice } = await import('@/physics/eulerGpu');
  const { nx, ny, obstacle, mach, altitude } = config;
  const { rho0, u0, p0 } = freestream(altitude, mach);
  const maxSteps = config.steps ?? defaultMaxSteps(nx, ny);
  const tolerance = config.convergenceTolerance ?? 1e-4;
  const minSteps = Math.min(300, Math.max(100, Math.floor(maxSteps * 0.08)));
  const checkInterval = 8;
  const stableChecksRequired = 3;

  const device = await tryCreateEulerGpuDevice();
  if (!device) {
    throw new Error('WebGPU unavailable');
  }

  const sim = await EulerGpuSimulator.create(device, {
    nx,
    ny,
    rho0,
    u0,
    p0,
    obstacle,
  });

  let uPrev: Float32Array;
  let vPrev: Float32Array;
  let stableChecks = 0;

  try {
    const initial = await sim.readUV();
    uPrev = new Float32Array(initial.u);
    vPrev = new Float32Array(initial.v);

    for (let step = 0; step < maxSteps; step++) {
      if (shouldCancel?.()) {
        throw new Error('cancelled');
      }
      if (step % 25 === 0) {
        onProgress?.(step / maxSteps, 'gpu');
      }

      await sim.step();

      if (step >= minSteps && step % checkInterval === 0) {
        const { u, v } = await sim.readUV();
        const delta = fluidVelocityMaxDelta(uPrev, vPrev, u, v, obstacle, u0);
        uPrev.set(u);
        vPrev.set(v);
        if (delta < tolerance) {
          stableChecks += 1;
          if (stableChecks >= stableChecksRequired) {
            break;
          }
        } else {
          stableChecks = 0;
        }
      }
    }

    onProgress?.(1, 'gpu');
    const { velocity, machField, pressure } = await sim.buildOutput(obstacle);
    return { nx, ny, mach, altitude, velocity, machField, pressure };
  } finally {
    sim.destroy();
  }
}

export async function runEulerTunnelWasmPath(
  config: EulerTunnelConfig,
  onProgress?: (progress: number, backend: EulerTunnelBackend) => void,
  shouldCancel?: () => boolean,
): Promise<EulerTunnelResult> {
  if (shouldCancel?.()) {
    throw new Error('cancelled');
  }

  const { nx, ny, obstacle, mach, altitude } = config;
  const { rho0, u0, p0 } = freestream(altitude, mach);
  const maxSteps = config.steps ?? defaultMaxSteps(nx, ny);
  const tolerance = config.convergenceTolerance ?? 1e-4;

  const packed = await runEulerTunnelWasm(
    {
      nx,
      ny,
      rho0,
      u0,
      p0,
      maxSteps,
      tolerance,
      obstacle,
    },
    (progress) => onProgress?.(progress, 'wasm'),
  );

  if (shouldCancel?.()) {
    throw new Error('cancelled');
  }

  return {
    nx,
    ny,
    mach,
    altitude,
    velocity: packed.velocity,
    machField: packed.machField,
    pressure: packed.pressure,
  };
}

export async function runEulerTunnelAuto(
  config: EulerTunnelConfig,
  onProgress?: (progress: number, backend: EulerTunnelBackend) => void,
  shouldCancel?: () => boolean,
): Promise<{ result: EulerTunnelResult; backend: EulerTunnelBackend }> {
  // WASM first (fast, worker-safe). CPU fallback. GPU disabled until atomics are fixed.
  try {
    await tryInitEulerWasm();
    const result = await runEulerTunnelWasmPath(config, onProgress, shouldCancel);
    return { result, backend: 'wasm' };
  } catch (wasmErr) {
    if (shouldCancel?.() || (wasmErr instanceof Error && wasmErr.message === 'cancelled')) {
      throw wasmErr;
    }
    console.warn('WASM Euler solve failed, using CPU fallback:', wasmErr);
  }

  const result = runEulerTunnel(
    config,
    (progress) => onProgress?.(progress, 'cpu'),
    () => shouldCancel?.() ?? false,
  );
  return { result, backend: 'cpu' };
}
