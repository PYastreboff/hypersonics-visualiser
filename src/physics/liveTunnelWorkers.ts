import type { LbmDisplayMode } from '@/types';
import type { EulerTunnelResult } from '@/physics/eulerTunnelSolver';
import { blitTunnelBitmap } from '@/visualization/tunnelRenderer';

export type LiveWorkerKind = 'lbm' | 'euler';

export interface LiveFrameMessage {
  type: 'frame';
  bitmap: ImageBitmap;
  metric?: Float32Array;
  vmin: number;
  vmax: number;
  /** LBM live: true when a physics step ran before this frame (not paint-only). */
  didStep?: boolean;
  stepIndex?: number;
  converged?: boolean;
  progress?: number;
  simTimeS?: number;
  tunnelCd?: number | null;
  mach?: number;
  altitude?: number;
}

export interface LiveWorkerHandle {
  kind: LiveWorkerKind;
  worker: Worker;
  busy: boolean;
  generation: number;
}

export function createLiveWorker(kind: LiveWorkerKind): Worker {
  const url =
    kind === 'lbm'
      ? new URL('../workers/lbmLive.worker.ts', import.meta.url)
      : new URL('../workers/eulerTunnelLive.worker.ts', import.meta.url);
  return new Worker(url, { type: 'module' });
}

export function terminateLiveWorker(handle: LiveWorkerHandle | null): void {
  if (!handle) return;
  handle.generation += 1;
  handle.worker.postMessage({ type: 'cancel' });
  handle.worker.terminate();
}

export function blitLiveFrame(
  ctx: CanvasRenderingContext2D,
  msg: LiveFrameMessage,
  nx: number,
  ny: number,
  containerW: number,
  containerH: number,
): void {
  blitTunnelBitmap(ctx, msg.bitmap, nx, ny, containerW, containerH);
  msg.bitmap.close();
}

export function eulerResultFromFrame(
  msg: LiveFrameMessage,
  nx: number,
  ny: number,
  fallback: EulerTunnelResult | null,
): EulerTunnelResult | null {
  if (!msg.metric) return fallback;
  return {
    nx,
    ny,
    mach: msg.mach ?? fallback?.mach ?? 0,
    altitude: msg.altitude ?? fallback?.altitude ?? 0,
    velocity: msg.metric,
    machField: fallback?.machField ?? new Float32Array(nx * ny),
    pressure: fallback?.pressure ?? new Float32Array(nx * ny),
    temperature: fallback?.temperature ?? new Float32Array(nx * ny),
  };
}

export function liveWorkerPaintPayload(displayMode: LbmDisplayMode) {
  return { type: 'paint' as const, displayMode };
}
