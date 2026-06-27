import { runEuler2D } from './eulerSolver';

let cancelled = false;

self.onmessage = (e: MessageEvent) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (e.data.type === 'run') {
    cancelled = false;
    const { mach, altitude, shapes, gridNx, gridNy } = e.data;

    try {
      const result = runEuler2D(
        {
          mach,
          altitude,
          gridNx: gridNx ?? 256,
          gridNy: gridNy ?? 128,
          bodies: shapes,
        },
        (progress) => {
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
          density: result.density,
          pressure: result.pressure,
          mach: result.mach,
          temperature: result.temperature,
          gridNx: result.gridNx,
          gridNy: result.gridNy,
        },
        {
          transfer: [
            result.density.buffer,
            result.pressure.buffer,
            result.mach.buffer,
            result.temperature.buffer,
          ],
        },
      );
    } catch (err) {
      if (cancelled || (err instanceof Error && err.message === 'cancelled')) {
        self.postMessage({ type: 'cancelled' });
      } else {
        self.postMessage({
          type: 'error',
          error: err instanceof Error ? err.message : 'Solver failed',
        });
      }
    }
  }
};
