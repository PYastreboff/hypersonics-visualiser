import {
  EulerTunnelSimulator,
  getEulerTunnelMetric,
} from '@/physics/eulerTunnelSolver';
import {
  renderTunnelBitmap,
  shouldTransferLiveMetric,
} from '@/visualization/tunnelRenderer';
import type { LbmDisplayMode } from '@/types';

let generation = 0;
let sim: EulerTunnelSimulator | null = null;
let obstacle: Uint8Array | null = null;
let nx = 0;
let ny = 0;

let displayMode: LbmDisplayMode = 'mach';
let windSpeed = 0;
let fluidDensity = 1;
let eulerMach = 0.3;
let eulerAltitude = 0;

async function postFrame() {
  if (!sim || !obstacle) return;

  const result = sim.buildResult();
  const drag = sim.computeObstacleDrag(obstacle);
  const metric = getEulerTunnelMetric(result, displayMode);
  const { bitmap, vmin, vmax } = await renderTunnelBitmap({
    metric,
    obstacle,
    nx,
    ny,
    displayMode,
    physicsMode: 'euler',
    windSpeed,
    fluidDensity,
    eulerMach,
    eulerAltitude,
  });

  const transfers: Transferable[] = [bitmap];
  const payload: Record<string, unknown> = {
    type: 'frame',
    stepIndex: sim.stepIndex,
    converged: sim.converged,
    progress: sim.progress,
    simTimeS: sim.simTimeS,
    tunnelCd: drag?.cd ?? null,
    vmin,
    vmax,
    bitmap,
    mach: result.mach,
    altitude: result.altitude,
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
    sim = null;
    return;
  }

  const gen = generation;

  if (msg.type === 'init') {
    generation += 1;
    nx = msg.nx;
    ny = msg.ny;
    displayMode = msg.displayMode;
    windSpeed = msg.windSpeed ?? 0;
    fluidDensity = msg.fluidDensity ?? 1;
    eulerMach = msg.mach;
    eulerAltitude = msg.altitude;
    obstacle = new Uint8Array(msg.obstacle);
    sim = new EulerTunnelSimulator({
      nx,
      ny,
      obstacle,
      mach: eulerMach,
      altitude: eulerAltitude,
      continuous: true,
    });
    await postFrame();
    return;
  }

  if (gen !== generation || !sim || !obstacle) return;

  if (msg.type === 'setDisplayMode') {
    displayMode = msg.displayMode;
    await postFrame();
    return;
  }

  if (msg.type === 'updateObstacle') {
    obstacle = new Uint8Array(msg.obstacle);
    sim.updateObstacle(obstacle);
    await postFrame();
    return;
  }

  if (msg.type === 'updateFlowParams') {
    eulerMach = msg.mach;
    eulerAltitude = msg.altitude;
    sim.updateFlowParams(eulerMach, eulerAltitude);
    await postFrame();
    return;
  }

  if (msg.type === 'paint') {
    await postFrame();
    return;
  }

  if (msg.type === 'step') {
    if (msg.obstacle) {
      obstacle = new Uint8Array(msg.obstacle);
      sim.updateObstacle(obstacle);
    }
    if (typeof msg.mach === 'number') {
      eulerMach = msg.mach;
      eulerAltitude = msg.altitude ?? 0;
      sim.updateFlowParams(eulerMach, eulerAltitude);
    }
    if (msg.displayMode) {
      displayMode = msg.displayMode;
    }
    sim.steps(msg.count ?? 1);
    if (gen !== generation) return;
    await postFrame();
  }
};
