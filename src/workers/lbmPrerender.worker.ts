import { prerenderLbm } from '../physics/lbmPrerender';

let cancelled = false;

self.onmessage = (e: MessageEvent) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (e.data.type === 'run') {
    cancelled = false;
    const { nx, ny, windSpeed, fluidDensity, renderStep, playbackSeconds, obstacle } = e.data;

    try {
      const result = prerenderLbm(
        {
          nx,
          ny,
          windSpeed,
          fluidDensity,
          renderStep,
          playbackSeconds,
          obstacle: new Uint8Array(obstacle),
        },
        (progress: number) => {
          self.postMessage({ type: 'progress', progress });
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
