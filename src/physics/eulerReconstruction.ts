import type { EulerSpatialOrder } from '@/types';

export interface PrimitiveState {
  rho: number;
  u: number;
  v: number;
  p: number;
}

function signedDenom(d: number): number {
  if (Math.abs(d) >= 1e-12) return d;
  return d >= 0 ? 1e-12 : -1e-12;
}

function vanLeerLimiter(s: number): number {
  return Math.max(0, Math.min(1, s, 0.5 * (1 + s)));
}

function musclPair(qIm1: number, qI: number, qIp1: number, qIp2: number): [number, number] {
  const d1 = qI - qIm1;
  const d2 = qIp1 - qI;
  const d3 = qIp2 - qIp1;
  const sL = d1 / signedDenom(d2);
  const sR = d2 / signedDenom(d3);
  const left = qI + 0.5 * vanLeerLimiter(sL) * d2;
  const right = qIp1 - 0.5 * vanLeerLimiter(sR) * d3;
  return [left, right];
}

function readPrimitive(
  rho: Float32Array,
  u: Float32Array,
  v: Float32Array,
  p: Float32Array,
  id: number,
): PrimitiveState {
  return { rho: rho[id], u: u[id], v: v[id], p: p[id] };
}

function musclPrimitive(
  rho: Float32Array,
  u: Float32Array,
  v: Float32Array,
  p: Float32Array,
  ids: [number, number, number, number],
): [PrimitiveState, PrimitiveState] | null {
  for (const id of ids) {
    if (id < 0 || id >= rho.length) return null;
  }
  const [im1, i, ip1, ip2] = ids;
  const [rhoL, rhoR] = musclPair(rho[im1], rho[i], rho[ip1], rho[ip2]);
  const [uL, uR] = musclPair(u[im1], u[i], u[ip1], u[ip2]);
  const [vL, vR] = musclPair(v[im1], v[i], v[ip1], v[ip2]);
  const [pL, pR] = musclPair(p[im1], p[i], p[ip1], p[ip2]);
  return [
    { rho: Math.max(1e-6, rhoL), u: uL, v: vL, p: Math.max(1e3, pL) },
    { rho: Math.max(1e-6, rhoR), u: uR, v: vR, p: Math.max(1e3, pR) },
  ];
}

/** Face between cell `leftId` and `rightId` along x (normal +x). */
export function facePrimitivesX(
  order: EulerSpatialOrder,
  rho: Float32Array,
  u: Float32Array,
  v: Float32Array,
  p: Float32Array,
  solid: Uint8Array,
  leftId: number,
  rightId: number,
  ny: number,
): [PrimitiveState, PrimitiveState] {
  const left = readPrimitive(rho, u, v, p, leftId);
  const right = readPrimitive(rho, u, v, p, rightId);
  if (order === 'first' || solid[leftId] || solid[rightId]) {
    return [left, right];
  }

  const muscl = musclPrimitive(rho, u, v, p, [
    leftId - ny,
    leftId,
    rightId,
    rightId + ny,
  ]);
  if (!muscl || solid[leftId - ny] || solid[rightId + ny]) {
    return [left, right];
  }
  return muscl;
}

/** Face between cell `bottomId` and `topId` along y (normal +y). */
export function facePrimitivesY(
  order: EulerSpatialOrder,
  rho: Float32Array,
  u: Float32Array,
  v: Float32Array,
  p: Float32Array,
  solid: Uint8Array,
  bottomId: number,
  topId: number,
): [PrimitiveState, PrimitiveState] {
  const bottom = readPrimitive(rho, u, v, p, bottomId);
  const top = readPrimitive(rho, u, v, p, topId);
  if (order === 'first' || solid[bottomId] || solid[topId]) {
    return [bottom, top];
  }

  const muscl = musclPrimitive(rho, u, v, p, [
    bottomId - 1,
    bottomId,
    topId,
    topId + 1,
  ]);
  if (!muscl || solid[bottomId - 1] || solid[topId + 1]) {
    return [bottom, top];
  }
  return muscl;
}
