use js_sys::Function;
use wasm_bindgen::prelude::*;
use wide::f32x4;

const GAMMA: f32 = 1.4;
const GAMMA_M1: f32 = 0.4;

type Flux = [f32; 4];

#[inline]
fn sound_speed(rho: f32, p: f32) -> f32 {
    (GAMMA * p / rho.max(1e-6)).sqrt()
}

#[inline]
fn flux_x(r: f32, ux: f32, vy: f32, pr: f32) -> Flux {
    let e = pr / GAMMA_M1 + 0.5 * r * (ux * ux + vy * vy);
    [r * ux, r * ux * ux + pr, r * ux * vy, (e + pr) * ux]
}

#[inline]
fn flux_y(r: f32, ux: f32, vy: f32, pr: f32) -> Flux {
    let e = pr / GAMMA_M1 + 0.5 * r * (ux * ux + vy * vy);
    [r * vy, r * ux * vy, r * vy * vy + pr, (e + pr) * vy]
}

#[inline]
fn rusanov_x(
    r_l: f32, u_l: f32, v_l: f32, p_l: f32,
    r_r: f32, u_r: f32, v_r: f32, p_r: f32,
    wave_speed: f32,
) -> Flux {
    let f_l = flux_x(r_l, u_l, v_l, p_l);
    let f_r = flux_x(r_r, u_r, v_r, p_r);
    let u_l_c = [r_l, r_l * u_l, r_l * v_l, p_l / GAMMA_M1 + 0.5 * r_l * (u_l * u_l + v_l * v_l)];
    let u_r_c = [r_r, r_r * u_r, r_r * v_r, p_r / GAMMA_M1 + 0.5 * r_r * (u_r * u_r + v_r * v_r)];
    let half_s = 0.5 * wave_speed;
    [
        0.5 * (f_l[0] + f_r[0]) - half_s * (u_r_c[0] - u_l_c[0]),
        0.5 * (f_l[1] + f_r[1]) - half_s * (u_r_c[1] - u_l_c[1]),
        0.5 * (f_l[2] + f_r[2]) - half_s * (u_r_c[2] - u_l_c[2]),
        0.5 * (f_l[3] + f_r[3]) - half_s * (u_r_c[3] - u_l_c[3]),
    ]
}

#[inline]
fn rusanov_y(
    r_b: f32, u_b: f32, v_b: f32, p_b: f32,
    r_t: f32, u_t: f32, v_t: f32, p_t: f32,
    wave_speed: f32,
) -> Flux {
    let f_b = flux_y(r_b, u_b, v_b, p_b);
    let f_t = flux_y(r_t, u_t, v_t, p_t);
    let u_b_c = [r_b, r_b * u_b, r_b * v_b, p_b / GAMMA_M1 + 0.5 * r_b * (u_b * u_b + v_b * v_b)];
    let u_t_c = [r_t, r_t * u_t, r_t * v_t, p_t / GAMMA_M1 + 0.5 * r_t * (u_t * u_t + v_t * v_t)];
    let half_s = 0.5 * wave_speed;
    [
        0.5 * (f_b[0] + f_t[0]) - half_s * (u_t_c[0] - u_b_c[0]),
        0.5 * (f_b[1] + f_t[1]) - half_s * (u_t_c[1] - u_b_c[1]),
        0.5 * (f_b[2] + f_t[2]) - half_s * (u_t_c[2] - u_b_c[2]),
        0.5 * (f_b[3] + f_t[3]) - half_s * (u_t_c[3] - u_b_c[3]),
    ]
}

#[inline]
fn fluid_velocity_max_delta(
    u_a: &[f32], v_a: &[f32], u_b: &[f32], v_b: &[f32],
    solid: &[u8], speed_scale: f32,
) -> f32 {
    let scale = speed_scale.max(1e-6);
    let mut max_delta = 0.0f32;
    for i in 0..u_a.len() {
        if solid[i] == 0 {
            max_delta = max_delta.max((u_b[i] - u_a[i]).abs());
            max_delta = max_delta.max((v_b[i] - v_a[i]).abs());
        }
    }
    max_delta / scale
}

#[inline]
fn fill_sound_speed(rho: &[f32], p: &[f32], a_scratch: &mut [f32], solid: &[u8]) {
    let n = rho.len();
    let gamma = f32x4::splat(GAMMA);
    let eps = f32x4::splat(1e-6);
    let mut i = 0;
    while i + 4 <= n {
        let all_fluid = solid[i] == 0
            && solid[i + 1] == 0
            && solid[i + 2] == 0
            && solid[i + 3] == 0;
        if all_fluid {
            let rho_v = f32x4::new([rho[i], rho[i + 1], rho[i + 2], rho[i + 3]]);
            let p_v = f32x4::new([p[i], p[i + 1], p[i + 2], p[i + 3]]);
            let denom = rho_v.max(eps);
            let a = (gamma * p_v / denom).sqrt();
            let arr = a.to_array();
            a_scratch[i] = arr[0];
            a_scratch[i + 1] = arr[1];
            a_scratch[i + 2] = arr[2];
            a_scratch[i + 3] = arr[3];
        } else {
            for j in 0..4 {
                if solid[i + j] == 0 {
                    a_scratch[i + j] = sound_speed(rho[i + j], p[i + j]);
                }
            }
        }
        i += 4;
    }
    while i < n {
        if solid[i] == 0 {
            a_scratch[i] = sound_speed(rho[i], p[i]);
        }
        i += 1;
    }
}

fn default_max_steps(nx: u32, ny: u32) -> u32 {
    let cells = nx * ny;
    (cells / 20).max(1000).min(4000)
}

fn apply_boundary(
    nx: usize, ny: usize,
    rho: &mut [f32], u: &mut [f32], v: &mut [f32], p: &mut [f32],
    rho0: f32, u0: f32, p0: f32,
) {
    for y in 0..ny {
        let in_ghost = (nx - 2) * ny + y;
        let out_id = (nx - 1) * ny + y;
        rho[y] = rho0;
        u[y] = u0;
        v[y] = 0.0;
        p[y] = p0;
        rho[out_id] = rho[in_ghost];
        u[out_id] = u[in_ghost];
        v[out_id] = v[in_ghost];
        p[out_id] = p[in_ghost];
    }
    for x in 0..nx {
        let bot_in = x * ny + 1;
        let top_in = x * ny + ny - 2;
        let bot = x * ny;
        let top = x * ny + ny - 1;
        rho[bot] = rho[bot_in];
        u[bot] = u[bot_in];
        v[bot] = -v[bot_in];
        p[bot] = p[bot_in];
        rho[top] = rho[top_in];
        u[top] = u[top_in];
        v[top] = -v[top_in];
        p[top] = p[top_in];
    }
}

/// Run Euler tunnel solve. Returns packed [velocity, mach, pressure] (3 * nx * ny floats).
#[wasm_bindgen]
pub fn run_euler_tunnel_wasm(
    nx: u32,
    ny: u32,
    rho0: f32,
    u0: f32,
    p0: f32,
    max_steps: u32,
    tolerance: f32,
    obstacle: &[u8],
    progress_cb: Option<Function>,
) -> Vec<f32> {
    let nx = nx as usize;
    let ny = ny as usize;
    let n = nx * ny;
    assert_eq!(obstacle.len(), n);

    let lx = 3.0f32;
    let ly = lx * (ny as f32) / (nx as f32);
    let inv_dx = (nx as f32) / lx;
    let inv_dy = (ny as f32) / ly;
    let cell_size = (lx / nx as f32).min(ly / ny as f32);
    let cfl = 0.35f32;

    let mut rho_a = vec![0.0f32; n];
    let mut u_a = vec![0.0f32; n];
    let mut v_a = vec![0.0f32; n];
    let mut p_a = vec![0.0f32; n];
    let mut rho_b = vec![0.0f32; n];
    let mut u_b = vec![0.0f32; n];
    let mut v_b = vec![0.0f32; n];
    let mut p_b = vec![0.0f32; n];
    let mut a_scratch = vec![0.0f32; n];

    for x in 0..nx {
        for y in 0..ny {
            let id = x * ny + y;
            if obstacle[id] != 0 {
                rho_a[id] = rho0;
                u_a[id] = 0.0;
                v_a[id] = 0.0;
                p_a[id] = p0;
            } else {
                rho_a[id] = rho0;
                u_a[id] = u0;
                v_a[id] = 0.0;
                p_a[id] = p0;
            }
        }
    }

    let max_steps = if max_steps == 0 {
        default_max_steps(nx as u32, ny as u32)
    } else {
        max_steps
    };
    let min_steps = (300.min((max_steps as f32 * 0.08) as u32)).max(100);
    let check_interval = 8u32;
    let stable_checks_required = 3u32;
    let mut stable_checks = 0u32;

    let report_progress = |step: u32| {
        if let Some(ref cb) = progress_cb {
            let progress = (step as f64) / (max_steps as f64);
            let _ = cb.call1(&JsValue::NULL, &JsValue::from(progress));
        }
    };

    for step in 0..max_steps {
        if step % 25 == 0 {
            report_progress(step);
        }

        fill_sound_speed(&rho_a, &p_a, &mut a_scratch, obstacle);

        let mut max_lambda = 1.0f32;
        for x in 1..nx - 1 {
            let x_base = x * ny;
            for y in 1..ny - 1 {
                let id = x_base + y;
                if obstacle[id] != 0 {
                    continue;
                }
                let id_l = id - ny;
                let id_r = id + ny;
                let id_b = id - 1;
                let id_t = id + 1;
                let ux = u_a[id];
                let vy = v_a[id];
                let a_c = a_scratch[id];
                let mut lambda = (ux.abs() + a_c).max(vy.abs() + a_c);
                lambda = lambda.max(u_a[id_l].abs() + a_scratch[id_l]);
                lambda = lambda.max(u_a[id_r].abs() + a_scratch[id_r]);
                lambda = lambda.max(v_a[id_b].abs() + a_scratch[id_b]);
                lambda = lambda.max(v_a[id_t].abs() + a_scratch[id_t]);
                if lambda > max_lambda {
                    max_lambda = lambda;
                }
            }
        }
        let dt = cfl * cell_size / max_lambda;

        for x in 1..nx - 1 {
            let x_base = x * ny;
            for y in 1..ny - 1 {
                let id = x_base + y;
                if obstacle[id] != 0 {
                    rho_b[id] = rho0;
                    u_b[id] = 0.0;
                    v_b[id] = 0.0;
                    p_b[id] = p0;
                    continue;
                }

                let r = rho_a[id];
                let ux = u_a[id];
                let vy = v_a[id];
                let pr = p_a[id];
                let e = pr / GAMMA_M1 + 0.5 * r * (ux * ux + vy * vy);

                let id_l = id - ny;
                let id_r = id + ny;
                let id_b = id - 1;
                let id_t = id + 1;

                let u_l = u_a[id_l];
                let u_r = u_a[id_r];
                let v_b_n = v_a[id_b];
                let v_t = v_a[id_t];
                let a_c = a_scratch[id];
                let a_l = a_scratch[id_l];
                let a_r = a_scratch[id_r];
                let a_b = a_scratch[id_b];
                let a_t = a_scratch[id_t];

                let fx_r = rusanov_x(
                    r, ux, vy, pr,
                    rho_a[id_r], u_r, v_a[id_r], p_a[id_r],
                    (ux.abs() + a_c).max(u_r.abs() + a_r),
                );
                let fx_l = rusanov_x(
                    rho_a[id_l], u_l, v_a[id_l], p_a[id_l],
                    r, ux, vy, pr,
                    (u_l.abs() + a_l).max(ux.abs() + a_c),
                );
                let fy_t = rusanov_y(
                    r, ux, vy, pr,
                    rho_a[id_t], u_a[id_t], v_t, p_a[id_t],
                    (vy.abs() + a_c).max(v_t.abs() + a_t),
                );
                let fy_b = rusanov_y(
                    rho_a[id_b], u_a[id_b], v_b_n, p_a[id_b],
                    r, ux, vy, pr,
                    (v_b_n.abs() + a_b).max(vy.abs() + a_c),
                );

                let d_rho = -(fx_r[0] - fx_l[0]) * inv_dx - (fy_t[0] - fy_b[0]) * inv_dy;
                let d_rho_u = -(fx_r[1] - fx_l[1]) * inv_dx - (fy_t[1] - fy_b[1]) * inv_dy;
                let d_rho_v = -(fx_r[2] - fx_l[2]) * inv_dx - (fy_t[2] - fy_b[2]) * inv_dy;
                let d_e = -(fx_r[3] - fx_l[3]) * inv_dx - (fy_t[3] - fy_b[3]) * inv_dy;

                let rho_new = (r + dt * d_rho).max(1e-6);
                let rho_u = r * ux + dt * d_rho_u;
                let rho_v = r * vy + dt * d_rho_v;
                let en = e + dt * d_e;
                let u_new = rho_u / rho_new;
                let v_new = rho_v / rho_new;

                rho_b[id] = rho_new;
                u_b[id] = u_new;
                v_b[id] = v_new;
                p_b[id] = (GAMMA_M1 * (en - 0.5 * rho_new * (u_new * u_new + v_new * v_new))).max(1e3);
            }
        }

        apply_boundary(nx, ny, &mut rho_b, &mut u_b, &mut v_b, &mut p_b, rho0, u0, p0);

        if step >= min_steps && step % check_interval == 0 {
            let delta = fluid_velocity_max_delta(&u_a, &v_a, &u_b, &v_b, obstacle, u0);
            if delta < tolerance {
                stable_checks += 1;
                if stable_checks >= stable_checks_required {
                    std::mem::swap(&mut rho_a, &mut rho_b);
                    std::mem::swap(&mut u_a, &mut u_b);
                    std::mem::swap(&mut v_a, &mut v_b);
                    std::mem::swap(&mut p_a, &mut p_b);
                    break;
                }
            } else {
                stable_checks = 0;
            }
        }

        std::mem::swap(&mut rho_a, &mut rho_b);
        std::mem::swap(&mut u_a, &mut u_b);
        std::mem::swap(&mut v_a, &mut v_b);
        std::mem::swap(&mut p_a, &mut p_b);
    }

    let mut out = vec![0.0f32; n * 3];
    let eps = f32x4::splat(1e-6);
    let zero = f32x4::splat(0.0);
    let mut i = 0;
    while i + 4 <= n {
        if obstacle[i] != 0
            || obstacle[i + 1] != 0
            || obstacle[i + 2] != 0
            || obstacle[i + 3] != 0
        {
            for j in 0..4 {
                let idx = i + j;
                if obstacle[idx] != 0 {
                    out[idx] = 0.0;
                    out[n + idx] = 0.0;
                    out[2 * n + idx] = p0;
                } else {
                    let speed = (u_a[idx] * u_a[idx] + v_a[idx] * v_a[idx]).sqrt();
                    let a = sound_speed(rho_a[idx], p_a[idx]);
                    out[idx] = speed;
                    out[n + idx] = speed / a.max(1e-6);
                    out[2 * n + idx] = p_a[idx];
                }
            }
        } else {
            let u_v = f32x4::new([u_a[i], u_a[i + 1], u_a[i + 2], u_a[i + 3]]);
            let v_v = f32x4::new([v_a[i], v_a[i + 1], v_a[i + 2], v_a[i + 3]]);
            let rho_v = f32x4::new([rho_a[i], rho_a[i + 1], rho_a[i + 2], rho_a[i + 3]]);
            let p_v = f32x4::new([p_a[i], p_a[i + 1], p_a[i + 2], p_a[i + 3]]);
            let speed = (u_v * u_v + v_v * v_v).sqrt();
            let a = (f32x4::splat(GAMMA) * p_v / rho_v.max(eps)).sqrt();
            let mach = speed / a.max(eps);
            let speed_a = speed.to_array();
            let mach_a = mach.to_array();
            let p_a_arr = p_v.to_array();
            out[i] = speed_a[0];
            out[i + 1] = speed_a[1];
            out[i + 2] = speed_a[2];
            out[i + 3] = speed_a[3];
            out[n + i] = mach_a[0];
            out[n + i + 1] = mach_a[1];
            out[n + i + 2] = mach_a[2];
            out[n + i + 3] = mach_a[3];
            out[2 * n + i] = p_a_arr[0];
            out[2 * n + i + 1] = p_a_arr[1];
            out[2 * n + i + 2] = p_a_arr[2];
            out[2 * n + i + 3] = p_a_arr[3];
        }
        i += 4;
    }
    while i < n {
        if obstacle[i] != 0 {
            out[i] = 0.0;
            out[n + i] = 0.0;
            out[2 * n + i] = p0;
        } else {
            let speed = (u_a[i] * u_a[i] + v_a[i] * v_a[i]).sqrt();
            let a = sound_speed(rho_a[i], p_a[i]);
            out[i] = speed;
            out[n + i] = speed / a.max(1e-6);
            out[2 * n + i] = p_a[i];
        }
        i += 1;
    }

    let _ = zero;
    report_progress(max_steps);
    out
}

#[wasm_bindgen]
pub fn wasm_simd_available() -> bool {
    cfg!(target_feature = "simd128")
}
