import { describe, expect, it } from 'vitest';
import {
  EulerTunnelSimulator,
  fluidVelocityMaxDelta,
  getEulerTunnelMetric,
  runEulerTunnel,
} from '@/physics/eulerTunnelSolver';

describe('fluidVelocityMaxDelta', () => {
  it('returns zero for identical velocity fields', () => {
    const u = new Float32Array([10, 20, 0]);
    const v = new Float32Array([0, 1, 0]);
    const solid = new Uint8Array([0, 0, 1]);
    expect(fluidVelocityMaxDelta(u, v, u, v, solid, 100)).toBe(0);
  });
});

describe('runEulerTunnel', () => {
  it('produces inlet-scale velocity for subsonic Mach on an open grid', () => {
    const nx = 60;
    const ny = 30;
    const obstacle = new Uint8Array(nx * ny);
    const result = runEulerTunnel(
      { nx, ny, obstacle, mach: 0.2, altitude: 0, steps: 120 },
      () => {},
      () => false,
    );

    expect(result.velocity.length).toBe(nx * ny);
    const inlet = result.velocity[1 * ny + 15];
    expect(inlet).toBeGreaterThan(50);
    expect(result.machField[1 * ny + 15]).toBeGreaterThan(0.05);
    expect(getEulerTunnelMetric(result, 'mach')).toBe(result.machField);
    expect(result.temperature[1 * ny + 15]).toBeGreaterThan(200);
    expect(getEulerTunnelMetric(result, 'temperature')).toBe(result.temperature);
  });

  it('zeros velocity inside obstacle cells', () => {
    const nx = 40;
    const ny = 20;
    const obstacle = new Uint8Array(nx * ny);
    obstacle[20 * ny + 10] = 1;
    const result = runEulerTunnel(
      { nx, ny, obstacle, mach: 0.15, altitude: 0, steps: 80 },
      () => {},
      () => false,
    );
    expect(result.velocity[20 * ny + 10]).toBe(0);
  });

  it('stops early once the field settles instead of always using max steps', () => {
    const nx = 60;
    const ny = 30;
    const obstacle = new Uint8Array(nx * ny);
    let progress = 0;
    const early = runEulerTunnel(
      { nx, ny, obstacle, mach: 0.2, altitude: 0 },
      (p) => {
        progress = p;
      },
      () => false,
    );
    const forced = runEulerTunnel(
      { nx, ny, obstacle, mach: 0.2, altitude: 0, steps: 120 },
      () => {},
      () => false,
    );

    expect(progress).toBe(1);
    expect(early.velocity[1 * ny + 15]).toBeCloseTo(forced.velocity[1 * ny + 15], 0);
    expect(early.machField[1 * ny + 15]).toBeGreaterThan(0.05);
  });
});

describe('EulerTunnelSimulator', () => {
  it('steps incrementally toward the same steady field as runEulerTunnel', () => {
    const nx = 60;
    const ny = 30;
    const obstacle = new Uint8Array(nx * ny);
    const config = { nx, ny, obstacle, mach: 0.2, altitude: 0, steps: 120 };

    const sim = new EulerTunnelSimulator(config);
    while (!sim.converged && sim.stepIndex < sim.maxSteps) {
      sim.step();
    }

    const batch = runEulerTunnel(config, () => {}, () => false);
    expect(sim.velocity[1 * ny + 15]).toBeCloseTo(batch.velocity[1 * ny + 15], 0);
    expect(sim.progress).toBe(1);
  });

  it('updates obstacles and flow params without cold-restarting', () => {
    const nx = 40;
    const ny = 20;
    const obstacle = new Uint8Array(nx * ny);
    const sim = new EulerTunnelSimulator({ nx, ny, obstacle, mach: 0.2, altitude: 0, steps: 40 });
    for (let i = 0; i < 40; i++) sim.step();
    sim.converged = true;

    const interior = 10 * ny + 10;
    const neighborId = 10 * ny + 11;
    for (let i = 0; i < 40; i++) sim.step();

    obstacle[interior] = 1;
    sim.updateObstacle(obstacle);
    expect(sim.converged).toBe(false);

    const neighborPressure = sim.pressure[neighborId];
    obstacle[interior] = 0;
    sim.updateObstacle(obstacle);
    expect(sim.pressure[interior]).toBeCloseTo(neighborPressure, 0);

    sim.converged = true;
    sim.updateFlowParams(0.5, 0);
    expect(sim.converged).toBe(false);
    expect(sim.mach).toBe(0.5);
    expect(sim.buildResult().velocity[10]).toBeGreaterThan(100);
  });

  it('continuous mode keeps stepping past maxSteps and after tolerance convergence', () => {
    const nx = 40;
    const ny = 20;
    const obstacle = new Uint8Array(nx * ny);
    const sim = new EulerTunnelSimulator({
      nx,
      ny,
      obstacle,
      mach: 0.2,
      altitude: 0,
      steps: 20,
      continuous: true,
    });

    for (let i = 0; i < 50; i++) sim.step();
    expect(sim.stepIndex).toBe(50);
    expect(sim.converged).toBe(false);

    obstacle[10 * ny + 10] = 1;
    sim.updateObstacle(obstacle);
    const stepsBefore = sim.stepIndex;
    sim.steps(5);
    expect(sim.stepIndex).toBe(stepsBefore + 5);
    expect(sim.converged).toBe(false);
    expect(sim.simTimeS).toBeGreaterThan(0);
  });

  it('accumulates physical simulation time from CFL timesteps', () => {
    const nx = 60;
    const ny = 20;
    const obstacle = new Uint8Array(nx * ny);
    const sim = new EulerTunnelSimulator({
      nx,
      ny,
      obstacle,
      mach: 9,
      altitude: 0,
      continuous: true,
    });

    sim.steps(500);
    expect(sim.simTimeS).toBeGreaterThan(1e-6);
    expect(sim.simTimeS).toBeLessThan(0.01);
  });
});
