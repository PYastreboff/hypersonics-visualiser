import { runEulerTunnel } from '@/physics/eulerTunnelSolver';

let cancelled = false;

self.onmessage = (e: MessageEvent) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (e.data.type === 'run') {
    cancelled = false;
    const { nx, ny, mach, altitude, obstacle } = e.data;

    try {
      const result = runEulerTunnel(
        {
          nx,
          ny,
          mach,
          altitude,
          obstacle: new Uint8Array(obstacle),
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
          nx: result.nx,
          ny: result.ny,
          mach: result.mach,
          altitude: result.altitude,
          velocity: result.velocity,
          machField: result.machField,
          pressure: result.pressure,
        },
        {
          transfer: [result.velocity.buffer, result.machField.buffer, result.pressure.buffer],
        },
      );
    } catch (err) {
      if (cancelled || (err instanceof Error && err.message === 'cancelled')) {
        self.postMessage({ type: 'cancelled' });
      } else {
        self.postMessage({
          type: 'error',
          error: err instanceof Error ? err.message : 'Euler solver failed',
        });
      }
    }
  }
};
