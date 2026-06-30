import {
  EulerTunnelSimulator,
  getEulerTunnelMetric,
} from '@/physics/eulerTunnelSolver';
import {
  renderTunnelBitmap,
  shouldTransferLiveMetric,
} from '@/visualization/tunnelRenderer';
import type { LbmDisplayMode, EulerSolverScheme, EulerSpatialOrder, EulerWallMode } from '@/types';

let generation = 0;
let sim: EulerTunnelSimulator | null = null;
let obstacle: Uint8Array | null = null;
let obstacleSlip: Uint8Array | null = null;
let nx = 0;
let ny = 0;

let displayMode: LbmDisplayMode = 'mach';
let windSpeed = 0;
let fluidDensity = 1;
let eulerMach = 0.3;
let eulerAltitude = 0;
let eulerScheme: EulerSolverScheme = 'rusanov';
let eulerSpatialOrder: EulerSpatialOrder = 'first';
let eulerWallMode: EulerWallMode = 'reflective';
let dragTick = 0;
let lastTunnelCd: number | null = null;

async function postFrame() {
  if (!sim || !obstacle) return;

  const result = sim.buildResult();
  if (dragTick++ % 4 === 0) {
    lastTunnelCd = sim.computeObstacleDrag(obstacle)?.cd ?? null;
  }
  const dragCd = lastTunnelCd;
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
    tunnelCd: dragCd,
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
    eulerScheme = msg.scheme ?? 'rusanov';
    eulerSpatialOrder = msg.spatialOrder ?? 'first';
    eulerWallMode = msg.wallMode ?? 'reflective';
    obstacle = new Uint8Array(msg.obstacle);
    obstacleSlip = msg.obstacleSlip ? new Uint8Array(msg.obstacleSlip) : new Uint8Array(nx * ny);
    sim = new EulerTunnelSimulator({
      nx,
      ny,
      obstacle,
      obstacleSlip: obstacleSlip,
      mach: eulerMach,
      altitude: eulerAltitude,
      scheme: eulerScheme,
      spatialOrder: eulerSpatialOrder,
      wallMode: eulerWallMode,
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
    obstacleSlip = msg.obstacleSlip ? new Uint8Array(msg.obstacleSlip) : obstacleSlip;
    sim.updateObstacle(obstacle, obstacleSlip ?? undefined);
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
      if (msg.obstacleSlip) obstacleSlip = new Uint8Array(msg.obstacleSlip);
      sim.updateObstacle(obstacle, obstacleSlip ?? undefined);
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
