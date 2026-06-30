import { LbmSolver } from '@/physics/lbmSolver';
import {
  renderTunnelBitmap,
  shouldTransferLiveMetric,
} from '@/visualization/tunnelRenderer';
import { computeLbmTunnelDrag } from '@/physics/tunnelDrag';
import type { LbmDisplayMode } from '@/types';

let generation = 0;
let solver: LbmSolver | null = null;
let obstacle: Uint8Array | null = null;
let nx = 0;
let ny = 0;
let renderStep = 1;
let displayMode: LbmDisplayMode = 'velocity';
let windSpeed = 0;
let fluidDensity = 1;

function latticeField(mode: LbmDisplayMode): 'velocity' | 'pressure' {
  return mode === 'pressure' ? 'pressure' : 'velocity';
}

async function postFrame(didStep: boolean) {
  if (!solver || !obstacle) return;

  const metric = solver.getMetric(latticeField(displayMode));
  const pressure = solver.getMetric('pressure');
  const drag = computeLbmTunnelDrag(pressure, obstacle, nx, ny, windSpeed, fluidDensity);
  const { bitmap, vmin, vmax } = await renderTunnelBitmap({
    metric,
    obstacle,
    nx,
    ny,
    displayMode,
    physicsMode: 'lbm',
    windSpeed,
    fluidDensity,
  });

  const transfers: Transferable[] = [bitmap];
  const payload: Record<string, unknown> = {
    type: 'frame',
    didStep,
    vmin,
    vmax,
    bitmap,
    tunnelCd: drag?.cd ?? null,
  };

  if (shouldTransferLiveMetric(nx, ny)) {
    const metricCopy = new Float32Array(metric);
    payload.metric = metricCopy;
    transfers.push(metricCopy.buffer);
  }

  self.postMessage(payload, { transfer: transfers });
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'cancel') {
    generation += 1;
    solver = null;
    return;
  }

  const gen = generation;

  if (msg.type === 'init') {
    generation += 1;
    nx = msg.nx;
    ny = msg.ny;
    renderStep = msg.renderStep;
    displayMode = msg.displayMode;
    windSpeed = msg.windSpeed;
    fluidDensity = msg.fluidDensity;
    obstacle = new Uint8Array(msg.obstacle);
    solver = new LbmSolver({ nx, ny, windSpeed, rho0: fluidDensity }, obstacle);
    await postFrame(false);
    return;
  }

  if (gen !== generation || !solver || !obstacle) return;

  if (msg.type === 'setDisplayMode') {
    displayMode = msg.displayMode;
    await postFrame(false);
    return;
  }

  if (msg.type === 'updateObstacle') {
    obstacle = new Uint8Array(msg.obstacle);
    solver.updateObstacle(obstacle);
    await postFrame(false);
    return;
  }

  if (msg.type === 'updateWindSpeed') {
    windSpeed = msg.windSpeed;
    solver.updateWindSpeed(windSpeed);
    await postFrame(false);
    return;
  }

  if (msg.type === 'updateFluidDensity') {
    fluidDensity = msg.fluidDensity;
    solver.updateFluidDensity(fluidDensity);
    await postFrame(false);
    return;
  }

  if (msg.type === 'paint') {
    await postFrame(false);
    return;
  }

  if (msg.type === 'step') {
    if (msg.obstacle) {
      obstacle = new Uint8Array(msg.obstacle);
      solver.updateObstacle(obstacle);
    }
    if (msg.displayMode) {
      displayMode = msg.displayMode;
    }
    if (typeof msg.fluidDensity === 'number') {
      fluidDensity = msg.fluidDensity;
      solver.updateFluidDensity(fluidDensity);
    }
    if (typeof msg.windSpeed === 'number') {
      windSpeed = msg.windSpeed;
      solver.updateWindSpeed(windSpeed);
    }
    const steps = msg.renderStep ?? renderStep;
    for (let i = 0; i < steps; i++) {
      solver.step();
    }
    if (gen !== generation) return;
    await postFrame(true);
  }
};
