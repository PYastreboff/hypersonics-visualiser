export interface EulerWasmParams {
  nx: number;
  ny: number;
  rho0: number;
  u0: number;
  p0: number;
  maxSteps: number;
  tolerance: number;
  obstacle: Uint8Array;
}

export interface EulerWasmPackedResult {
  velocity: Float32Array;
  machField: Float32Array;
  pressure: Float32Array;
}

type WasmModule = {
  default: (moduleOrPath?: unknown) => Promise<unknown>;
  run_euler_tunnel_wasm: (
    nx: number,
    ny: number,
    rho0: number,
    u0: number,
    p0: number,
    maxSteps: number,
    tolerance: number,
    obstacle: Uint8Array,
    progressCb?: ((progress: number) => void) | null,
  ) => Float32Array;
  wasm_simd_available: () => boolean;
};

let wasmModule: WasmModule | null = null;
let initPromise: Promise<WasmModule> | null = null;

async function resolveWasmBytes(): Promise<ArrayBuffer | Buffer> {
  if (import.meta.env.MODE === 'test') {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const wasmPath = fileURLToPath(
      new URL('../wasm/euler-tunnel/pkg/euler_tunnel_wasm_bg.wasm', import.meta.url),
    );
    return readFileSync(wasmPath);
  }

  const { default: wasmUrl } = await import(
    '../wasm/euler-tunnel/pkg/euler_tunnel_wasm_bg.wasm?url'
  );
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`Failed to load Euler WASM (${response.status})`);
  }
  return response.arrayBuffer();
}

async function loadWasmModule(): Promise<WasmModule> {
  const mod = (await import('../wasm/euler-tunnel/pkg/euler_tunnel_wasm.js')) as WasmModule;
  await mod.default(await resolveWasmBytes());
  return mod;
}

export async function tryInitEulerWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule;
  if (initPromise) return initPromise;

  initPromise = loadWasmModule().then((mod) => {
    wasmModule = mod;
    return mod;
  });

  return initPromise;
}

export function eulerWasmSimdAvailable(): boolean {
  return wasmModule?.wasm_simd_available() ?? false;
}

export async function runEulerTunnelWasm(
  params: EulerWasmParams,
  onProgress?: (progress: number) => void,
): Promise<EulerWasmPackedResult> {
  const wasm = await tryInitEulerWasm();
  const packed = wasm.run_euler_tunnel_wasm(
    params.nx,
    params.ny,
    params.rho0,
    params.u0,
    params.p0,
    params.maxSteps,
    params.tolerance,
    params.obstacle,
    onProgress ?? undefined,
  );
  const n = params.nx * params.ny;
  return {
    velocity: new Float32Array(packed.subarray(0, n)),
    machField: new Float32Array(packed.subarray(n, n * 2)),
    pressure: new Float32Array(packed.subarray(n * 2, n * 3)),
  };
}
