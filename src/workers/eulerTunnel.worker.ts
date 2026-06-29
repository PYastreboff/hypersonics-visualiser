import { runEulerTunnelAuto } from '@/physics/eulerTunnelAuto';
import { runEulerTunnel } from '@/physics/eulerTunnelSolver';

let runGeneration = 0;

self.onmessage = async (e: MessageEvent) => {
  if (e.data.type === 'cancel') {
    runGeneration += 1;
    return;
  }

  if (e.data.type !== 'run') return;

  const generation = ++runGeneration;
  const isCancelled = () => generation !== runGeneration;

  const { nx, ny, mach, altitude, obstacle } = e.data;
  const config = {
    nx,
    ny,
    mach,
    altitude,
    obstacle: new Uint8Array(obstacle),
  };

  try {
    let result;
    let backend: 'gpu' | 'wasm' | 'cpu' = 'cpu';

    try {
      const solved = await runEulerTunnelAuto(
        config,
        (progress, solvedBackend) => {
          if (isCancelled()) return;
          backend = solvedBackend;
          self.postMessage({ type: 'progress', progress, backend: solvedBackend });
        },
        isCancelled,
      );
      result = solved.result;
      backend = solved.backend;
    } catch (autoErr) {
      if (isCancelled() || (autoErr instanceof Error && autoErr.message === 'cancelled')) {
        throw autoErr;
      }
      console.warn('Euler auto solve failed, retrying CPU:', autoErr);
      result = runEulerTunnel(
        config,
        (progress) => {
          if (isCancelled()) return;
          self.postMessage({ type: 'progress', progress, backend: 'cpu' });
        },
        isCancelled,
      );
      backend = 'cpu';
    }

    if (isCancelled()) {
      self.postMessage({ type: 'cancelled' });
      return;
    }

    const velocity = new Float32Array(result.velocity);
    const machField = new Float32Array(result.machField);
    const pressure = new Float32Array(result.pressure);
    const temperature = new Float32Array(result.temperature);

    self.postMessage(
      {
        type: 'complete',
        nx: result.nx,
        ny: result.ny,
        mach: result.mach,
        altitude: result.altitude,
        velocity,
        machField,
        pressure,
        temperature,
        backend,
      },
      {
        transfer: [velocity.buffer, machField.buffer, pressure.buffer, temperature.buffer],
      },
    );
  } catch (err) {
    if (isCancelled() || (err instanceof Error && err.message === 'cancelled')) {
      self.postMessage({ type: 'cancelled' });
    } else {
      self.postMessage({
        type: 'error',
        error: err instanceof Error ? err.message : 'Euler solver failed',
      });
    }
  }
};
