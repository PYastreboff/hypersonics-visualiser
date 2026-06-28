import shaderSource from './lbmGpu.wgsl?raw';

const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36] as const;

export type LbmGpuBackend = 'gpu' | 'cpu';

export interface LbmGpuSimParams {
  nx: number;
  ny: number;
  windSpeed: number;
  rho0: number;
  tau?: number;
  obstacle: Uint8Array;
}

function packUniforms(nx: number, ny: number, windSpeed: number, rho0: number, tau: number): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  const u32 = new Uint32Array(buf);
  const f32 = new Float32Array(buf);
  u32[0] = nx;
  u32[1] = ny;
  f32[2] = windSpeed;
  f32[3] = rho0;
  f32[4] = 1 / tau;
  return buf;
}

function initDistributions(nx: number, ny: number, rho0: number): Float32Array {
  const cellCount = nx * ny;
  const f = new Float32Array(cellCount * 9);
  for (let idx = 0; idx < cellCount; idx++) {
    for (let i = 0; i < 9; i++) {
      f[idx * 9 + i] = W[i] * rho0;
    }
  }
  return f;
}

function obstacleToU32(obstacle: Uint8Array): Uint32Array {
  const out = new Uint32Array(obstacle.length);
  for (let i = 0; i < obstacle.length; i++) {
    out[i] = obstacle[i];
  }
  return out;
}

export async function tryCreateLbmGpuDevice(): Promise<GPUDevice | null> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return null;

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;

    const device = await adapter.requestDevice();
    device.lost.then((info) => {
      console.warn('WebGPU device lost:', info.message);
    });
    return device;
  } catch {
    return null;
  }
}

export class LbmGpuSimulator {
  readonly backend: LbmGpuBackend = 'gpu';
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroupA: GPUBindGroup;
  private readonly bindGroupB: GPUBindGroup;
  private readonly uniformBuffer: GPUBuffer;
  private readonly fBufferA: GPUBuffer;
  private readonly fBufferB: GPUBuffer;
  private readonly obstacleBuffer: GPUBuffer;
  private readonly uxBuffer: GPUBuffer;
  private readonly uyBuffer: GPUBuffer;
  private readonly rhoBuffer: GPUBuffer;
  private readonly stagingDisplay: GPUBuffer;
  private readonly cellCount: number;
  private readonly nx: number;
  private readonly ny: number;
  private useBufferA = true;

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroupA: GPUBindGroup,
    bindGroupB: GPUBindGroup,
    uniformBuffer: GPUBuffer,
    fBufferA: GPUBuffer,
    fBufferB: GPUBuffer,
    obstacleBuffer: GPUBuffer,
    uxBuffer: GPUBuffer,
    uyBuffer: GPUBuffer,
    rhoBuffer: GPUBuffer,
    stagingDisplay: GPUBuffer,
    nx: number,
    ny: number,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroupA = bindGroupA;
    this.bindGroupB = bindGroupB;
    this.uniformBuffer = uniformBuffer;
    this.fBufferA = fBufferA;
    this.fBufferB = fBufferB;
    this.obstacleBuffer = obstacleBuffer;
    this.uxBuffer = uxBuffer;
    this.uyBuffer = uyBuffer;
    this.rhoBuffer = rhoBuffer;
    this.stagingDisplay = stagingDisplay;
    this.nx = nx;
    this.ny = ny;
    this.cellCount = nx * ny;
  }

  static async create(device: GPUDevice, params: LbmGpuSimParams): Promise<LbmGpuSimulator> {
    const { nx, ny, windSpeed, rho0, obstacle } = params;
    const tau = params.tau ?? 0.6;
    const cellCount = nx * ny;
    const fBytes = cellCount * 9 * 4;
    const cellBytes = cellCount * 4;
    const displayBytes = cellCount * 3 * 4;

    const module = device.createShaderModule({ code: shaderSource });
    const compilation = await module.getCompilationInfo();
    const shaderErrors = compilation.messages.filter((m) => m.type === 'error');
    if (shaderErrors.length > 0) {
      throw new Error(shaderErrors.map((m) => m.message).join('; '));
    }

    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'lbmStep' },
    });

    const uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, new Uint8Array(packUniforms(nx, ny, windSpeed, rho0, tau)));

    const fBufferA = device.createBuffer({
      size: fBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const fBufferB = device.createBuffer({
      size: fBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(fBufferA, 0, initDistributions(nx, ny, rho0));

    const obstacleBuffer = device.createBuffer({
      size: cellCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(obstacleBuffer, 0, obstacleToU32(obstacle));

    const uxBuffer = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const uyBuffer = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const rhoBuffer = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const stagingDisplay = device.createBuffer({
      size: displayBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const bindGroupA = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: fBufferA } },
        { binding: 2, resource: { buffer: fBufferB } },
        { binding: 3, resource: { buffer: obstacleBuffer } },
        { binding: 4, resource: { buffer: uxBuffer } },
        { binding: 5, resource: { buffer: uyBuffer } },
        { binding: 6, resource: { buffer: rhoBuffer } },
      ],
    });
    const bindGroupB = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: fBufferB } },
        { binding: 2, resource: { buffer: fBufferA } },
        { binding: 3, resource: { buffer: obstacleBuffer } },
        { binding: 4, resource: { buffer: uxBuffer } },
        { binding: 5, resource: { buffer: uyBuffer } },
        { binding: 6, resource: { buffer: rhoBuffer } },
      ],
    });

    return new LbmGpuSimulator(
      device,
      pipeline,
      bindGroupA,
      bindGroupB,
      uniformBuffer,
      fBufferA,
      fBufferB,
      obstacleBuffer,
      uxBuffer,
      uyBuffer,
      rhoBuffer,
      stagingDisplay,
      nx,
      ny,
    );
  }

  private encodeSteps(encoder: GPUCommandEncoder, steps: number): void {
    const workgroupsX = Math.ceil(this.nx / 8);
    const workgroupsY = Math.ceil(this.ny / 8);

    for (let step = 0; step < steps; step++) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.useBufferA ? this.bindGroupA : this.bindGroupB);
      pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
      pass.end();
      this.useBufferA = !this.useBufferA;
    }
  }

  async advance(steps: number): Promise<void> {
    if (steps <= 0) return;
    const encoder = this.device.createCommandEncoder();
    this.encodeSteps(encoder, steps);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
  }

  async readDisplay(): Promise<{ ux: Float32Array; uy: Float32Array; rho: Float32Array }> {
    const cellBytes = this.cellCount * 4;
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.uxBuffer, 0, this.stagingDisplay, 0, cellBytes);
    encoder.copyBufferToBuffer(this.uyBuffer, 0, this.stagingDisplay, cellBytes, cellBytes);
    encoder.copyBufferToBuffer(this.rhoBuffer, 0, this.stagingDisplay, cellBytes * 2, cellBytes);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    await this.stagingDisplay.mapAsync(GPUMapMode.READ);
    const mapped = new Float32Array(this.stagingDisplay.getMappedRange().slice(0));
    this.stagingDisplay.unmap();

    const ux = mapped.subarray(0, this.cellCount);
    const uy = mapped.subarray(this.cellCount, this.cellCount * 2);
    const rho = mapped.subarray(this.cellCount * 2, this.cellCount * 3);
    return {
      ux: new Float32Array(ux),
      uy: new Float32Array(uy),
      rho: new Float32Array(rho),
    };
  }

  destroy(): void {
    this.uniformBuffer.destroy();
    this.fBufferA.destroy();
    this.fBufferB.destroy();
    this.obstacleBuffer.destroy();
    this.uxBuffer.destroy();
    this.uyBuffer.destroy();
    this.rhoBuffer.destroy();
    this.stagingDisplay.destroy();
  }
}
