import { Vector3 } from 'three';
import type { FlowParams, FlowSample, PlacedShape } from '@/types';
import { GAMMA } from './constants';
import {
  densityAtAltitude,
  speedOfSound,
  temperatureAtAltitude,
  velocityFromMach,
} from './atmosphere';
import { detectRegime } from './regimes';
import { obliqueShockAngle, bowShockStandoff } from './shockRelations';
import { postShockState } from './rankineHugoniot';
import { getAerofoilDimensions, getWedgeDimensions } from '@/shapes/solidGeometry';
import { getShapeDefinition } from '@/shapes/definitions';
import { getFlowDirection } from './flowDirection';

export function isPointInsideAnyShape(x: number, y: number, z: number, shapes: PlacedShape[]): boolean {
  const point = new Vector3(x, y, z);
  return shapes.some((shape) => distanceToShape(point, shape) < 0);
}

function distanceToShape(point: Vector3, shape: PlacedShape): number {
  const local = point.clone().sub(new Vector3(...shape.position));
  const def = getShapeDefinition(shape.kind);
  const charLen = def.lengthScale(shape.params, shape.scale);
  const r = shape.params.radius ?? 0.5;
  const sx = shape.scale[0];
  const sy = shape.scale[1];
  const sz = shape.scale[2];

  switch (shape.kind) {
    case 'sphere': {
      const radius = r * Math.max(sx, sy, sz);
      return local.length() - radius;
    }
    case 'cone':
    case 'ogive':
    case 'biconic': {
      const len = (shape.params.length ?? 2) * sx;
      const rad = r * Math.max(sy, sz);
      const ax = local.x + len / 2;
      if (ax < 0) return Math.sqrt(local.y ** 2 + local.z ** 2) - rad;
      const coneR = rad * (1 - ax / len);
      return Math.sqrt(local.y ** 2 + local.z ** 2) - Math.max(coneR, 0);
    }
    case 'wedge': {
      const { len, halfHeight, depth } = getWedgeDimensions(shape.params, shape.scale);
      const d2 = depth / 2;
      if (Math.abs(local.z) > d2) return local.length();
      const ax = local.x + len / 2;
      if (ax < 0) return Math.sqrt(local.y ** 2 + local.z ** 2);
      const slope = halfHeight / len;
      return Math.abs(local.y) - slope * ax;
    }
    case 'cylinder': {
      const rad = r * Math.max(sy, sz);
      const len = (shape.params.length ?? 2) * sx;
      if (Math.abs(local.x) > len / 2) return local.length();
      return Math.sqrt(local.y ** 2 + local.z ** 2) - rad;
    }
    case 'flatPlate': {
      const len = (shape.params.length ?? 2) * sx;
      const h = 0.05 * sy;
      if (Math.abs(local.x) > len / 2 || Math.abs(local.y) > h) return local.length();
      return Math.abs(local.z);
    }
    case 'aerofoil': {
      const { chord, thicknessRatio, span } = getAerofoilDimensions(shape.params, shape.scale);
      if (Math.abs(local.z) > span / 2) return local.length();
      if (local.x < 0 || local.x > chord) return local.length();
      const xt = local.x / chord;
      const yt =
        5 *
        thicknessRatio *
        chord *
        (0.2969 * Math.sqrt(xt) - 0.126 * xt - 0.3516 * xt ** 2 + 0.2843 * xt ** 3 - 0.1015 * xt ** 4);
      return Math.abs(local.y) - Math.abs(yt);
    }
    default:
      return local.length() - charLen * 0.5;
  }
}

function potentialFlowVelocity(
  point: Vector3,
  shape: PlacedShape,
  freeStream: Vector3,
  speed: number,
): Vector3 {
  const dist = distanceToShape(point, shape);
  const def = getShapeDefinition(shape.kind);
  const charLen = def.lengthScale(shape.params, shape.scale);
  const base = freeStream.clone().multiplyScalar(speed);

  if (dist < 0) return base.clone().multiplyScalar(0.08);

  const center = new Vector3(...shape.position);
  const rel = point.clone().sub(center);
  const r = Math.max(rel.length(), charLen * 0.15);
  const rHat = rel.clone().normalize();

  if (shape.kind === 'sphere') {
    const radius = (shape.params.radius ?? 0.5) * Math.max(...shape.scale);
    const factor = 1 - (radius / r) ** 3 * 0.85;
    const radial = rHat.clone().multiplyScalar(freeStream.dot(rHat) * (radius / r) ** 3 * 1.6);
    return base.clone().multiplyScalar(Math.max(factor, 0.12)).sub(radial.multiplyScalar(speed * 0.5));
  }

  const influence = Math.exp(-dist / (charLen * 0.65));
  const lift = rHat.clone().multiplyScalar(freeStream.dot(rHat) * influence * 0.85);
  return base.clone().sub(lift).normalize().multiplyScalar(speed * (1 - influence * 0.25));
}

function isUpstreamOf(point: Vector3, shape: PlacedShape, flowDir: Vector3): boolean {
  const center = new Vector3(...shape.position);
  return point.clone().sub(center).dot(flowDir) < 0;
}

function supersonicVelocity(
  point: Vector3,
  shape: PlacedShape,
  freeStream: Vector3,
  mach: number,
  rho: number,
  temp: number,
  speed: number,
): { vel: Vector3; rho: number; temp: number } {
  const dist = distanceToShape(point, shape);
  const def = getShapeDefinition(shape.kind);
  const charLen = def.lengthScale(shape.params, shape.scale);
  const base = freeStream.clone().multiplyScalar(speed);

  if (dist < 0) {
    return { vel: base.clone().multiplyScalar(0.08), rho, temp };
  }

  let vel = base.clone();
  let localRho = rho;
  let localTemp = temp;

  if (isUpstreamOf(point, shape, freeStream) && dist < charLen * 0.9) {
    let wedgeAngle = ((shape.params.halfAngle ?? 15) * Math.PI) / 180;
    if (shape.kind === 'wedge') {
      wedgeAngle = ((shape.params.wedgeAngle ?? 10) * Math.PI) / 180;
    } else if (shape.kind === 'cone' || shape.kind === 'biconic') {
      const r = (shape.params.radius ?? 0.4) * Math.max(shape.scale[1], shape.scale[2]);
      const h = (shape.params.length ?? 2) * shape.scale[0];
      wedgeAngle = Math.atan(r / h);
    } else if (shape.kind === 'aerofoil') {
      const { chord, thicknessRatio } = getAerofoilDimensions(shape.params, shape.scale);
      wedgeAngle = Math.atan2(thicknessRatio * chord, chord * 0.25);
    }

    const beta = obliqueShockAngle(Math.max(wedgeAngle, 0.02), mach);
    if (beta !== null) {
      const shockDist = charLen * 0.35;
      const shockBlend = Math.exp(-dist / shockDist);
      const post = postShockState(mach, 101325, rho, temp);
      vel = base
        .clone()
        .multiplyScalar((post.m2 / mach) * shockBlend + (1 - shockBlend));
      localRho = post.rho2 * shockBlend + rho * (1 - shockBlend);
      localTemp = post.t2 * shockBlend + temp * (1 - shockBlend);
    } else if (def.isBlunt) {
      const radius = getBluntRadius(shape);
      const standoff = bowShockStandoff(radius, mach);
      const shockBlend = Math.exp(-dist / Math.max(standoff, 0.05));
      const post = postShockState(mach, 101325, rho, temp);
      vel = base
        .clone()
        .multiplyScalar((post.m2 / mach) * shockBlend + (1 - shockBlend));
      localRho = post.rho2 * shockBlend + rho * (1 - shockBlend);
      localTemp = post.t2 * shockBlend + temp * (1 - shockBlend);
    }
  }

  const center = new Vector3(...shape.position);
  const rel = point.clone().sub(center);
  const rHat = rel.clone().normalize();
  const influence = Math.exp(-dist / (charLen * 0.55));
  const toward = rHat.clone().multiplyScalar(Math.max(freeStream.dot(rHat), 0) * influence * 0.7);
  vel.sub(toward.multiplyScalar(speed));

  if (vel.length() < speed * 0.15) {
    vel = base.clone().multiplyScalar(0.15);
  }

  return { vel, rho: localRho, temp: localTemp };
}

function getBluntRadius(shape: PlacedShape): number {
  const p = shape.params;
  const s = shape.scale;
  if (shape.kind === 'sphere' || shape.kind === 'custom') {
    return (p.radius ?? 0.5) * Math.max(...s);
  }
  if (shape.kind === 'cylinder') {
    return (p.radius ?? 0.3) * Math.max(s[1], s[2]);
  }
  return (p.radius ?? 0.5) * Math.max(s[1], s[2]);
}

function blendSamples(samples: FlowSample[], weights: number[]): FlowSample {
  const vel = new Vector3();
  let density = 0;
  let pressure = 0;
  let temperature = 0;
  let machLocal = 0;
  let wSum = 0;

  for (let i = 0; i < samples.length; i++) {
    const w = weights[i];
    vel.add(samples[i].velocity.clone().multiplyScalar(w));
    density += samples[i].density * w;
    pressure += samples[i].pressure * w;
    temperature += samples[i].temperature * w;
    machLocal += samples[i].machLocal * w;
    wSum += w;
  }

  if (wSum > 0) {
    vel.divideScalar(wSum);
    density /= wSum;
    pressure /= wSum;
    temperature /= wSum;
    machLocal /= wSum;
  }

  return { velocity: vel, density, pressure, temperature, machLocal };
}

export class FlowField {
  private params: FlowParams;
  private shapes: PlacedShape[];

  constructor(params: FlowParams, shapes: PlacedShape[]) {
    this.params = params;
    this.shapes = shapes;
  }

  update(params: FlowParams, shapes: PlacedShape[]) {
    this.params = params;
    this.shapes = shapes;
  }

  sample(x: number, y: number, z: number): FlowSample {
    const point = new Vector3(x, y, z);
    const temp = this.params.freeStreamTemp ?? temperatureAtAltitude(this.params.altitude);
    const rho = densityAtAltitude(this.params.altitude);
    const a = speedOfSound(temp);
    const pInf = rho * a * a / GAMMA;
    const freeStream = getFlowDirection(
      this.params.angleOfAttack,
      this.params.sideslip,
    );
    const mach = this.params.mach;
    const regime = detectRegime(mach);
    const speed = velocityFromMach(mach, temp);

    if (this.shapes.length === 0) {
      const vel = freeStream.clone().multiplyScalar(speed);
      return {
        velocity: vel,
        density: rho,
        pressure: pInf,
        temperature: temp,
        machLocal: mach,
      };
    }

    const samples: FlowSample[] = [];
    const weights: number[] = [];

    for (const shape of this.shapes) {
      const center = new Vector3(...shape.position);
      const distToCenter = point.distanceTo(center);
      const def = getShapeDefinition(shape.kind);
      const charLen = def.lengthScale(shape.params, shape.scale);
      const surfaceDist = distanceToShape(point, shape);
      const weight = Math.exp(-distToCenter / (charLen * 2.5)) * (surfaceDist >= 0 ? 1 : 0.05);

      let vel: Vector3;
      let localRho = rho;
      let localTemp = temp;

      if (regime === 'subsonic' || regime === 'transonic') {
        vel = potentialFlowVelocity(point, shape, freeStream, speed);
        if (regime === 'transonic' && mach > 0.8 && surfaceDist < charLen * 0.2) {
          localRho *= 1 + 0.2 * (mach - 0.8);
          localTemp *= 1 + 0.08 * (mach - 0.8);
        }
      } else {
        const sup = supersonicVelocity(point, shape, freeStream, mach, rho, temp, speed);
        vel = sup.vel;
        localRho = sup.rho;
        localTemp = sup.temp;
      }

      const localMach = vel.length() / a;
      const localP = localRho * a * a / GAMMA * (1 + 0.5 * (GAMMA - 1) * localMach * localMach);

      samples.push({
        velocity: vel,
        density: localRho,
        pressure: localP,
        temperature: localTemp,
        machLocal: localMach,
      });
      weights.push(weight);
    }

    const blended = blendSamples(samples, weights);
    const baseVel = freeStream.clone().multiplyScalar(speed);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const blendFactor = Math.min(1, wSum / Math.max(this.shapes.length * 0.35, 0.35));
    blended.velocity.lerp(baseVel, 1 - blendFactor);

    if (blended.velocity.length() < speed * 0.12) {
      blended.velocity.copy(baseVel.clone().multiplyScalar(0.12));
    }

    return blended;
  }

  sampleVelocity(x: number, y: number, z: number): Vector3 {
    return this.sample(x, y, z).velocity;
  }

  sampleDensity(x: number, y: number, z: number): number {
    return this.sample(x, y, z).density;
  }

  sampleTemperature(x: number, y: number, z: number): number {
    return this.sample(x, y, z).temperature;
  }
}

export function createFlowField(params: FlowParams, shapes: PlacedShape[]): FlowField {
  return new FlowField(params, shapes);
}
