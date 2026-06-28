struct SimParams {
  nx: u32,
  ny: u32,
  windSpeed: f32,
  rho0: f32,
  invTau: f32,
  _pad: f32,
}

const W: array<f32, 9> = array<f32, 9>(
  4.0 / 9.0,
  1.0 / 9.0,
  1.0 / 9.0,
  1.0 / 9.0,
  1.0 / 9.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
  1.0 / 36.0,
);

const VX: array<i32, 9> = array<i32, 9>(0, 1, 0, -1, 0, 1, -1, -1, 1);
const VY: array<i32, 9> = array<i32, 9>(0, 0, 1, 0, -1, 1, 1, -1, -1);
const BOUNCE_BACK: array<u32, 9> = array<u32, 9>(0u, 3u, 4u, 1u, 2u, 7u, 8u, 5u, 6u);

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> fIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> fOut: array<f32>;
@group(0) @binding(3) var<storage, read> obstacle: array<u32>;
@group(0) @binding(4) var<storage, read_write> uxOut: array<f32>;
@group(0) @binding(5) var<storage, read_write> uyOut: array<f32>;
@group(0) @binding(6) var<storage, read_write> rhoOut: array<f32>;

fn wrap(a: i32, n: i32) -> i32 {
  return (a % n + n) % n;
}

fn fIndex(cell: u32, dir: u32) -> u32 {
  return cell * 9u + dir;
}

@compute @workgroup_size(8, 8, 1)
fn lbmStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.nx || y >= params.ny) {
    return;
  }

  let nx = i32(params.nx);
  let ny = i32(params.ny);
  let idx = x * params.ny + y;

  var fStreamed: array<f32, 9>;
  for (var i = 0u; i < 9u; i++) {
    let sx = u32(wrap(i32(x) - VX[i], nx));
    let sy = u32(wrap(i32(y) - VY[i], ny));
    let sidx = sx * params.ny + sy;
    fStreamed[i] = fIn[fIndex(sidx, i)];
  }

  var fLocal: array<f32, 9>;
  if (obstacle[idx] != 0u) {
    for (var i = 0u; i < 9u; i++) {
      fLocal[i] = fStreamed[BOUNCE_BACK[i]];
    }
  } else {
    for (var i = 0u; i < 9u; i++) {
      fLocal[i] = fStreamed[i];
    }
  }

  var rho = 0.0;
  var mx = 0.0;
  var my = 0.0;
  for (var i = 0u; i < 9u; i++) {
    rho += fLocal[i];
    mx += fLocal[i] * f32(VX[i]);
    my += fLocal[i] * f32(VY[i]);
  }

  var ux = mx / rho;
  var uy = my / rho;

  if (x == 0u && obstacle[idx] == 0u) {
    ux = params.windSpeed;
    uy = 0.0;
    rho = params.rho0;
  }

  uxOut[idx] = ux;
  uyOut[idx] = uy;
  rhoOut[idx] = rho;

  for (var i = 0u; i < 9u; i++) {
    let vx = f32(VX[i]);
    let vy = f32(VY[i]);
    let cu = vx * ux + vy * uy;
    let u2 = ux * ux + uy * uy;
    let feq = W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * u2);
    fOut[fIndex(idx, i)] = fLocal[i] + -params.invTau * (fLocal[i] - feq);
  }

  if (obstacle[idx] != 0u) {
    uxOut[idx] = 0.0;
    uyOut[idx] = 0.0;
  }
}
