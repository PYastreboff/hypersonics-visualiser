import shaderSource from './eulerGpu.wgsl?raw';
import { GAMMA } from '@/physics/constants';

export type EulerGpuBackend = 'gpu';

export interface EulerGpuSimParams {
  nx: number;
  ny: number;
  rho0: number;
  u0: number;
  p0: number;
  obstacle: Uint8Array;
}

const CFL = 0.35;
const LAMBDA_INIT_BITS = 0x3f800000; // f32 1.0

function packUniformsFull(
  nx: number,
  ny: number,
  rho0: number,
  u0: number,
  p0: number,
  invDx: number,
  invDy: number,
  cellSize: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(48);
  const u32 = new Uint32Array(buf);
  const f32 = new Float32Array(buf);
  u32[0] = nx;
  u32[1] = ny;
  f32[2] = rho0;
  f32[3] = u0;
  f32[4] = p0;
  f32[5] = invDx;
  f32[6] = invDy;
  f32[7] = CFL;
  f32[8] = cellSize;
  return buf;
}

function obstacleToU32(obstacle: Uint8Array): Uint32Array {
  const out = new Uint32Array(obstacle.length);
  for (let i = 0; i < obstacle.length; i++) {
    out[i] = obstacle[i];
  }
  return out;
}

function initFields(
  nx: number,
  ny: number,
  n: number,
  solid: Uint32Array,
  rho0: number,
  u0: number,
  p0: number,
): { rho: Float32Array; u: Float32Array; v: Float32Array; p: Float32Array } {
  const rho = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const p = new Float32Array(n);
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      const id = x * ny + y;
      if (solid[id]) {
        rho[id] = rho0;
        u[id] = 0;
        v[id] = 0;
        p[id] = p0;
        continue;
      }
      rho[id] = rho0;
      u[id] = u0;
      v[id] = 0;
      p[id] = p0;
    }
  }
  return { rho, u, v, p };
}

export async function tryCreateEulerGpuDevice(): Promise<GPUDevice | null> {
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

type StepPipeline = GPUComputePipeline;

export class EulerGpuSimulator {
  readonly backend: EulerGpuBackend = 'gpu';
  private readonly device: GPUDevice;
  private readonly bindGroupA: GPUBindGroup;
  private readonly bindGroupB: GPUBindGroup;
  private readonly uniformBuffer: GPUBuffer;
  private readonly rhoA: GPUBuffer;
  private readonly rhoB: GPUBuffer;
  private readonly uA: GPUBuffer;
  private readonly uB: GPUBuffer;
  private readonly vA: GPUBuffer;
  private readonly vB: GPUBuffer;
  private readonly pA: GPUBuffer;
  private readonly pB: GPUBuffer;
  private readonly aScratch: GPUBuffer;
  private readonly solidBuffer: GPUBuffer;
  private readonly maxLambdaBuffer: GPUBuffer;
  private readonly dtBuffer: GPUBuffer;
  private readonly stagingUV: GPUBuffer;
  private readonly stagingFull: GPUBuffer;
  private readonly soundSpeedPipeline: StepPipeline;
  private readonly maxLambdaPipeline: StepPipeline;
  private readonly finalizeDtPipeline: StepPipeline;
  private readonly updatePipeline: StepPipeline;
  private readonly boundaryPipeline: StepPipeline;
  private readonly cellCount: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly p0: number;
  private useBufferA = true;

  private constructor(
    device: GPUDevice,
    bindGroupA: GPUBindGroup,
    bindGroupB: GPUBindGroup,
    uniformBuffer: GPUBuffer,
    rhoA: GPUBuffer,
    rhoB: GPUBuffer,
    uA: GPUBuffer,
    uB: GPUBuffer,
    vA: GPUBuffer,
    vB: GPUBuffer,
    pA: GPUBuffer,
    pB: GPUBuffer,
    aScratch: GPUBuffer,
    solidBuffer: GPUBuffer,
    maxLambdaBuffer: GPUBuffer,
    dtBuffer: GPUBuffer,
    stagingUV: GPUBuffer,
    stagingFull: GPUBuffer,
    soundSpeedPipeline: StepPipeline,
    maxLambdaPipeline: StepPipeline,
    finalizeDtPipeline: StepPipeline,
    updatePipeline: StepPipeline,
    boundaryPipeline: StepPipeline,
    nx: number,
    ny: number,
    _rho0: number,
    _u0: number,
    p0: number,
  ) {
    this.device = device;
    this.bindGroupA = bindGroupA;
    this.bindGroupB = bindGroupB;
    this.uniformBuffer = uniformBuffer;
    this.rhoA = rhoA;
    this.rhoB = rhoB;
    this.uA = uA;
    this.uB = uB;
    this.vA = vA;
    this.vB = vB;
    this.pA = pA;
    this.pB = pB;
    this.aScratch = aScratch;
    this.solidBuffer = solidBuffer;
    this.maxLambdaBuffer = maxLambdaBuffer;
    this.dtBuffer = dtBuffer;
    this.stagingUV = stagingUV;
    this.stagingFull = stagingFull;
    this.soundSpeedPipeline = soundSpeedPipeline;
    this.maxLambdaPipeline = maxLambdaPipeline;
    this.finalizeDtPipeline = finalizeDtPipeline;
    this.updatePipeline = updatePipeline;
    this.boundaryPipeline = boundaryPipeline;
    this.nx = nx;
    this.ny = ny;
    this.cellCount = nx * ny;
    this.p0 = p0;
  }

  static async create(device: GPUDevice, params: EulerGpuSimParams): Promise<EulerGpuSimulator> {
    const { nx, ny, rho0, u0, p0, obstacle } = params;
    const cellCount = nx * ny;
    const cellBytes = cellCount * 4;
    const Lx = 3.0;
    const Ly = Lx * (ny / nx);
    const invDx = nx / Lx;
    const invDy = ny / Ly;
    const cellSize = Math.min(Lx / nx, Ly / ny);

    const module = device.createShaderModule({ code: shaderSource });
    const compilation = await module.getCompilationInfo();
    const shaderErrors = compilation.messages.filter((m) => m.type === 'error');
    if (shaderErrors.length > 0) {
      throw new Error(shaderErrors.map((m) => m.message).join('; '));
    }

    const createPipeline = (entryPoint: string) =>
      device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint },
      });

    const soundSpeedPipeline = createPipeline('eulerSoundSpeed');
    const maxLambdaPipeline = createPipeline('eulerMaxLambda');
    const finalizeDtPipeline = createPipeline('eulerFinalizeDt');
    const updatePipeline = createPipeline('eulerUpdate');
    const boundaryPipeline = createPipeline('eulerBoundary');

    const uniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Uint8Array(packUniformsFull(nx, ny, rho0, u0, p0, invDx, invDy, cellSize)),
    );

    const solidU32 = obstacleToU32(obstacle);
    const init = initFields(nx, ny, cellCount, solidU32, rho0, u0, p0);

    const rhoA = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const rhoB = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const uA = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const uB = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const vA = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const vB = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const pA = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const pB = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(rhoA, 0, init.rho);
    device.queue.writeBuffer(uA, 0, init.u);
    device.queue.writeBuffer(vA, 0, init.v);
    device.queue.writeBuffer(pA, 0, init.p);

    const aScratch = device.createBuffer({
      size: cellBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const solidBuffer = device.createBuffer({
      size: cellCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(solidBuffer, 0, solidU32);

    const maxLambdaBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const dtBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const stagingUV = device.createBuffer({
      size: cellBytes * 2,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const stagingFull = device.createBuffer({
      size: cellBytes * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const makeBindGroup = (rhoIn: GPUBuffer, uIn: GPUBuffer, vIn: GPUBuffer, pIn: GPUBuffer, rhoOut: GPUBuffer, uOut: GPUBuffer, vOut: GPUBuffer, pOut: GPUBuffer) =>
      device.createBindGroup({
        layout: soundSpeedPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: rhoIn } },
          { binding: 2, resource: { buffer: uIn } },
          { binding: 3, resource: { buffer: vIn } },
          { binding: 4, resource: { buffer: pIn } },
          { binding: 5, resource: { buffer: rhoOut } },
          { binding: 6, resource: { buffer: uOut } },
          { binding: 7, resource: { buffer: vOut } },
          { binding: 8, resource: { buffer: pOut } },
          { binding: 9, resource: { buffer: aScratch } },
          { binding: 10, resource: { buffer: solidBuffer } },
          { binding: 11, resource: { buffer: maxLambdaBuffer } },
          { binding: 12, resource: { buffer: dtBuffer } },
        ],
      });

    const bindGroupA = makeBindGroup(rhoA, uA, vA, pA, rhoB, uB, vB, pB);
    const bindGroupB = makeBindGroup(rhoB, uB, vB, pB, rhoA, uA, vA, pA);

    return new EulerGpuSimulator(
      device,
      bindGroupA,
      bindGroupB,
      uniformBuffer,
      rhoA,
      rhoB,
      uA,
      uB,
      vA,
      vB,
      pA,
      pB,
      aScratch,
      solidBuffer,
      maxLambdaBuffer,
      dtBuffer,
      stagingUV,
      stagingFull,
      soundSpeedPipeline,
      maxLambdaPipeline,
      finalizeDtPipeline,
      updatePipeline,
      boundaryPipeline,
      nx,
      ny,
      rho0,
      u0,
      p0,
    );
  }

  private encodeStep(encoder: GPUCommandEncoder): void {
    const bindGroup = this.useBufferA ? this.bindGroupA : this.bindGroupB;
    const workgroupsX = Math.ceil(this.nx / 8);
    const workgroupsY = Math.ceil(this.ny / 8);

    this.device.queue.writeBuffer(this.maxLambdaBuffer, 0, new Uint32Array([LAMBDA_INIT_BITS]));

    const dispatch = (pipeline: GPUComputePipeline, wx: number, wy: number) => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(wx, wy, 1);
      pass.end();
    };

    dispatch(this.soundSpeedPipeline, workgroupsX, workgroupsY);
    dispatch(this.maxLambdaPipeline, workgroupsX, workgroupsY);
    dispatch(this.finalizeDtPipeline, 1, 1);
    dispatch(this.updatePipeline, workgroupsX, workgroupsY);
    dispatch(this.boundaryPipeline, workgroupsX, workgroupsY);

    this.useBufferA = !this.useBufferA;
  }

  async step(): Promise<void> {
    const encoder = this.device.createCommandEncoder();
    this.encodeStep(encoder);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
  }

  private currentReadBuffers(): { rho: GPUBuffer; u: GPUBuffer; v: GPUBuffer; p: GPUBuffer } {
    // After swap, useBufferA points to buffer that will be input next step,
    // so current state is the opposite set.
    if (this.useBufferA) {
      return { rho: this.rhoB, u: this.uB, v: this.vB, p: this.pB };
    }
    return { rho: this.rhoA, u: this.uA, v: this.vA, p: this.pA };
  }

  async readUV(): Promise<{ u: Float32Array; v: Float32Array }> {
    const { u, v } = this.currentReadBuffers();
    const cellBytes = this.cellCount * 4;
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(u, 0, this.stagingUV, 0, cellBytes);
    encoder.copyBufferToBuffer(v, 0, this.stagingUV, cellBytes, cellBytes);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    await this.stagingUV.mapAsync(GPUMapMode.READ);
    const mapped = new Float32Array(this.stagingUV.getMappedRange().slice(0));
    this.stagingUV.unmap();

    return {
      u: new Float32Array(mapped.subarray(0, this.cellCount)),
      v: new Float32Array(mapped.subarray(this.cellCount, this.cellCount * 2)),
    };
  }

  async readState(): Promise<{ rho: Float32Array; u: Float32Array; v: Float32Array; p: Float32Array }> {
    const state = this.currentReadBuffers();
    const cellBytes = this.cellCount * 4;
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(state.rho, 0, this.stagingFull, 0, cellBytes);
    encoder.copyBufferToBuffer(state.u, 0, this.stagingFull, cellBytes, cellBytes);
    encoder.copyBufferToBuffer(state.v, 0, this.stagingFull, cellBytes * 2, cellBytes);
    encoder.copyBufferToBuffer(state.p, 0, this.stagingFull, cellBytes * 3, cellBytes);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    await this.stagingFull.mapAsync(GPUMapMode.READ);
    const mapped = new Float32Array(this.stagingFull.getMappedRange().slice(0));
    this.stagingFull.unmap();

    const n = this.cellCount;
    return {
      rho: new Float32Array(mapped.subarray(0, n)),
      u: new Float32Array(mapped.subarray(n, n * 2)),
      v: new Float32Array(mapped.subarray(n * 2, n * 3)),
      p: new Float32Array(mapped.subarray(n * 3, n * 4)),
    };
  }

  async buildOutput(solid: Uint8Array): Promise<{
    velocity: Float32Array;
    machField: Float32Array;
    pressure: Float32Array;
  }> {
    const { rho, u, v, p } = await this.readState();
    const n = this.cellCount;
    const velocity = new Float32Array(n);
    const machField = new Float32Array(n);
    const pressure = new Float32Array(n);
    const gamma = GAMMA;

    for (let i = 0; i < n; i++) {
      if (solid[i]) {
        velocity[i] = 0;
        machField[i] = 0;
        pressure[i] = this.p0;
        continue;
      }
      const speed = Math.hypot(u[i], v[i]);
      const a = Math.sqrt(gamma * p[i] / Math.max(rho[i], 1e-6));
      velocity[i] = speed;
      machField[i] = speed / Math.max(a, 1e-6);
      pressure[i] = p[i];
    }

    return { velocity, machField, pressure };
  }

  destroy(): void {
    this.uniformBuffer.destroy();
    this.rhoA.destroy();
    this.rhoB.destroy();
    this.uA.destroy();
    this.uB.destroy();
    this.vA.destroy();
    this.vB.destroy();
    this.pA.destroy();
    this.pB.destroy();
    this.aScratch.destroy();
    this.solidBuffer.destroy();
    this.maxLambdaBuffer.destroy();
    this.dtBuffer.destroy();
    this.stagingUV.destroy();
    this.stagingFull.destroy();
    this.device.destroy();
  }
}
