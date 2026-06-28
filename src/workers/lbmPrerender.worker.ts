import { prerenderLbmAuto } from '../physics/lbmGpuPrerender';

let cancelled = false;

self.onmessage = async (e: MessageEvent) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (e.data.type === 'run') {
    cancelled = false;
    const { nx, ny, windSpeed, fluidDensity, renderStep, playbackSeconds, obstacle } = e.data;

    try {
      const { result, backend: completedBackend } = await prerenderLbmAuto(
        {
          nx,
          ny,
          windSpeed,
          fluidDensity,
          renderStep,
          playbackSeconds,
          obstacle: new Uint8Array(obstacle),
        },
        (progress: number, renderBackend: 'gpu' | 'cpu') => {
          self.postMessage({ type: 'progress', progress, backend: renderBackend });
        },
        () => cancelled,
      );

      if (cancelled) {
        self.postMessage({ type: 'cancelled' });
        return;
      }

      self.postMessage(
        {
          type: 'complete',
          velocityFrames: result.velocityFrames,
          pressureFrames: result.pressureFrames,
          totalFrames: result.totalFrames,
          nx: result.nx,
          ny: result.ny,
          backend: completedBackend,
        },
        {
          transfer: [result.velocityFrames.buffer, result.pressureFrames.buffer],
        },
      );
    } catch (err) {
      if (cancelled) {
        self.postMessage({ type: 'cancelled' });
        return;
      }
      self.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
