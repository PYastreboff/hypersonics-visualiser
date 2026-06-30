const GAMMA: f32 = 1.4;
const GAMMA_M1: f32 = 0.4;

struct Params {
  nx: u32,
  ny: u32,
  rho0: f32,
  u0: f32,
  p0: f32,
  invDx: f32,
  invDy: f32,
  cfl: f32,
  cellSize: f32,
}

struct Flux4 {
  f0: f32,
  f1: f32,
  f2: f32,
  f3: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> rhoIn: array<f32>;
@group(0) @binding(2) var<storage, read> uIn: array<f32>;
@group(0) @binding(3) var<storage, read> vIn: array<f32>;
@group(0) @binding(4) var<storage, read> pIn: array<f32>;
@group(0) @binding(5) var<storage, read_write> rhoOut: array<f32>;
@group(0) @binding(6) var<storage, read_write> uOut: array<f32>;
@group(0) @binding(7) var<storage, read_write> vOut: array<f32>;
@group(0) @binding(8) var<storage, read_write> pOut: array<f32>;
@group(0) @binding(9) var<storage, read_write> aScratch: array<f32>;
@group(0) @binding(10) var<storage, read> solid: array<u32>;
@group(0) @binding(11) var<storage, read_write> maxLambdaBits: atomic<u32>;
@group(0) @binding(12) var<storage, read_write> dtBuf: array<f32>;

fn soundSpeed(rho: f32, p: f32) -> f32 {
  return sqrt(GAMMA * p / max(rho, 1e-6));
}

fn fluxX(r: f32, ux: f32, vy: f32, pr: f32) -> Flux4 {
  let E = pr / GAMMA_M1 + 0.5 * r * (ux * ux + vy * vy);
  return Flux4(r * ux, r * ux * ux + pr, r * ux * vy, (E + pr) * ux);
}

fn fluxY(r: f32, ux: f32, vy: f32, pr: f32) -> Flux4 {
  let E = pr / GAMMA_M1 + 0.5 * r * (ux * ux + vy * vy);
  return Flux4(r * vy, r * ux * vy, r * vy * vy + pr, (E + pr) * vy);
}

fn rusanovX(
  rL: f32, uL: f32, vL: f32, pL: f32,
  rR: f32, uR: f32, vR: f32, pR: f32,
  waveSpeed: f32,
) -> Flux4 {
  let fL = fluxX(rL, uL, vL, pL);
  let fR = fluxX(rR, uR, vR, pR);
  let eL = pL / GAMMA_M1 + 0.5 * rL * (uL * uL + vL * vL);
  let eR = pR / GAMMA_M1 + 0.5 * rR * (uR * uR + vR * vR);
  let halfS = 0.5 * waveSpeed;
  return Flux4(
    0.5 * (fL.f0 + fR.f0) - halfS * (rR - rL),
    0.5 * (fL.f1 + fR.f1) - halfS * (rR * uR - rL * uL),
    0.5 * (fL.f2 + fR.f2) - halfS * (rR * vR - rL * vL),
    0.5 * (fL.f3 + fR.f3) - halfS * (eR - eL),
  );
}

fn rusanovY(
  rB: f32, uB: f32, vB: f32, pB: f32,
  rT: f32, uT: f32, vT: f32, pT: f32,
  waveSpeed: f32,
) -> Flux4 {
  let fB = fluxY(rB, uB, vB, pB);
  let fT = fluxY(rT, uT, vT, pT);
  let eB = pB / GAMMA_M1 + 0.5 * rB * (uB * uB + vB * vB);
  let eT = pT / GAMMA_M1 + 0.5 * rT * (uT * uT + vT * vT);
  let halfS = 0.5 * waveSpeed;
  return Flux4(
    0.5 * (fB.f0 + fT.f0) - halfS * (rT - rB),
    0.5 * (fB.f1 + fT.f1) - halfS * (rT * uT - rB * uB),
    0.5 * (fB.f2 + fT.f2) - halfS * (rT * vT - rB * vB),
    0.5 * (fB.f3 + fT.f3) - halfS * (eT - eB),
  );
}

fn atomicMaxF32(ptr: ptr<storage, read_write, atomic<u32>>, val: f32) {
  atomicMax(ptr, bitcast<u32>(val));
}

@compute @workgroup_size(8, 8, 1)
fn eulerSoundSpeed(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.nx || y >= params.ny) {
    return;
  }
  let id = x * params.ny + y;
  if (solid[id] != 0u) {
    return;
  }
  aScratch[id] = soundSpeed(rhoIn[id], pIn[id]);
}

@compute @workgroup_size(8, 8, 1)
fn eulerMaxLambda(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nx = params.nx;
  let ny = params.ny;
  let x = gid.x;
  let y = gid.y;
  if (x < 1u || y < 1u || x >= nx - 1u || y >= ny - 1u) {
    return;
  }
  let id = x * ny + y;
  if (solid[id] != 0u) {
    return;
  }

  let idL = id - ny;
  let idR = id + ny;
  let idB = id - 1u;
  let idT = id + 1u;

  let ux = uIn[id];
  let vy = vIn[id];
  let aC = aScratch[id];
  var lambda = max(abs(ux) + aC, abs(vy) + aC);
  lambda = max(lambda, abs(uIn[idL]) + aScratch[idL]);
  lambda = max(lambda, abs(uIn[idR]) + aScratch[idR]);
  lambda = max(lambda, abs(vIn[idB]) + aScratch[idB]);
  lambda = max(lambda, abs(vIn[idT]) + aScratch[idT]);
  atomicMaxF32(&maxLambdaBits, lambda);
}

@compute @workgroup_size(1, 1, 1)
fn eulerFinalizeDt(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x > 0u) {
    return;
  }
  let maxL = bitcast<f32>(atomicLoad(&maxLambdaBits));
  dtBuf[0] = params.cfl * params.cellSize / max(maxL, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn eulerUpdate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nx = params.nx;
  let ny = params.ny;
  let x = gid.x;
  let y = gid.y;
  if (x < 1u || y < 1u || x >= nx - 1u || y >= ny - 1u) {
    return;
  }
  let id = x * ny + y;
  if (solid[id] != 0u) {
    rhoOut[id] = params.rho0;
    uOut[id] = 0.0;
    vOut[id] = 0.0;
    pOut[id] = params.p0;
    return;
  }

  let r = rhoIn[id];
  let ux = uIn[id];
  let vy = vIn[id];
  let pr = pIn[id];
  let E = pr / GAMMA_M1 + 0.5 * r * (ux * ux + vy * vy);
  let dt = dtBuf[0];

  let idL = id - ny;
  let idR = id + ny;
  let idB = id - 1u;
  let idT = id + 1u;

  let uL = uIn[idL];
  let uR = uIn[idR];
  let vB_n = vIn[idB];
  let vT = vIn[idT];
  let aC = aScratch[id];
  let aL = aScratch[idL];
  let aR = aScratch[idR];
  let aB = aScratch[idB];
  let aT = aScratch[idT];

  let fxR = rusanovX(
    r, ux, vy, pr,
    rhoIn[idR], uR, vIn[idR], pIn[idR],
    max(abs(ux) + aC, abs(uR) + aR),
  );
  let fxL = rusanovX(
    rhoIn[idL], uL, vIn[idL], pIn[idL],
    r, ux, vy, pr,
    max(abs(uL) + aL, abs(ux) + aC),
  );
  let fyT = rusanovY(
    r, ux, vy, pr,
    rhoIn[idT], uIn[idT], vT, pIn[idT],
    max(abs(vy) + aC, abs(vT) + aT),
  );
  let fyB = rusanovY(
    rhoIn[idB], uIn[idB], vB_n, pIn[idB],
    r, ux, vy, pr,
    max(abs(vB_n) + aB, abs(vy) + aC),
  );

  let dRho = -(fxR.f0 - fxL.f0) * params.invDx - (fyT.f0 - fyB.f0) * params.invDy;
  let dRhoU = -(fxR.f1 - fxL.f1) * params.invDx - (fyT.f1 - fyB.f1) * params.invDy;
  let dRhoV = -(fxR.f2 - fxL.f2) * params.invDx - (fyT.f2 - fyB.f2) * params.invDy;
  let dE = -(fxR.f3 - fxL.f3) * params.invDx - (fyT.f3 - fyB.f3) * params.invDy;

  let rhoNew = max(1e-6, r + dt * dRho);
  let rhoU = r * ux + dt * dRhoU;
  let rhoV = r * vy + dt * dRhoV;
  let EN = E + dt * dE;
  let uNew = rhoU / rhoNew;
  let vNew = rhoV / rhoNew;

  rhoOut[id] = rhoNew;
  uOut[id] = uNew;
  vOut[id] = vNew;
  pOut[id] = max(1e3, GAMMA_M1 * (EN - 0.5 * rhoNew * (uNew * uNew + vNew * vNew)));
}

@compute @workgroup_size(8, 8, 1)
fn eulerBoundary(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nx = params.nx;
  let ny = params.ny;
  let x = gid.x;
  let y = gid.y;
  if (x >= nx || y >= ny) {
    return;
  }

  let onXEdge = x == 0u || x == nx - 1u;
  let onYEdge = y == 0u || y == ny - 1u;
  if (!onXEdge && !onYEdge) {
    return;
  }

  let id = x * ny + y;

  if (x == 0u) {
    rhoOut[id] = params.rho0;
    uOut[id] = params.u0;
    vOut[id] = 0.0;
    pOut[id] = params.p0;
    return;
  }

  if (x == nx - 1u) {
    let inGhost = (nx - 2u) * ny + y;
    rhoOut[id] = rhoOut[inGhost];
    uOut[id] = uOut[inGhost];
    vOut[id] = vOut[inGhost];
    pOut[id] = pOut[inGhost];
    return;
  }

  if (y == 0u) {
    let botIn = x * ny + 1u;
    rhoOut[id] = rhoOut[botIn];
    uOut[id] = uOut[botIn];
    vOut[id] = -vOut[botIn];
    pOut[id] = pOut[botIn];
    return;
  }

  if (y == ny - 1u) {
    let topIn = x * ny + ny - 2u;
    rhoOut[id] = rhoOut[topIn];
    uOut[id] = uOut[topIn];
    vOut[id] = -vOut[topIn];
    pOut[id] = pOut[topIn];
  }
}
