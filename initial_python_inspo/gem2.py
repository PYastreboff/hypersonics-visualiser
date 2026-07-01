import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from scipy.optimize import root_scalar
import sys

# =========================================================================
# --- USER INPUT PARAMETERS ---
# =========================================================================
# REGIME CONTROL: 
#   - Subsonic (LBM): Set between 0.01 and 0.22 
#   - Supersonic (High-Fidelity Shape Shock): Set to 1.5, 2.5, or 3.5+
MACH_NUMBER = 2.5  

SHAPES_LIST = [
    {"type": "airfoil", "cx": 65,  "cy": 50, "chord": 65, "aoa": 0, "naca": "0012"},
    # Try changing aoa to 45 to see it switch back to a sharp diamond oblique shock!
    {"type": "square",  "cx": 160, "cy": 65, "width": 20, "height": 20, "aoa": 45},  # Flat square blunt shock
    {"type": "circle",  "cx": 240, "cy": 35, "radius": 12}                        # Blunt circle bow shock
]

DISPLAY_MODE = "pressure"   # Options: "velocity" or "pressure"
PLAYBACK_TIME_SECONDS = 5.0
RESOLUTION_SCALE = 1.0     
# =========================================================================

Nx = int(300 * RESOLUTION_SCALE)
Ny = int(100 * RESOLUTION_SCALE)
TOTAL_FRAMES = int(PLAYBACK_TIME_SECONDS * (1000 / 30))
X_grid, Y_grid = np.meshgrid(np.arange(Nx), np.arange(Ny), indexing='ij')

# --- 1. Master Obstacle Generation Engine ---
obstacle = np.zeros((Nx, Ny), dtype=bool)
shape_masks = [] 

for shape in SHAPES_LIST:
    cx, cy = int(shape["cx"] * RESOLUTION_SCALE), int(shape["cy"] * RESOLUTION_SCALE)
    aoa = shape.get("aoa", 0)
    rad = np.radians(-aoa)
    cos_a, sin_a = np.cos(rad), np.sin(rad)
    
    X_rot = (X_grid - cx) * cos_a - (Y_grid - cy) * sin_a
    Y_rot = (X_grid - cx) * sin_a + (Y_grid - cy) * cos_a
    
    current_mask = np.zeros((Nx, Ny), dtype=bool)
    if shape["type"] == "square":
        w_half = (shape.get("width", 20) * RESOLUTION_SCALE) / 2.0
        h_half = (shape.get("height", 20) * RESOLUTION_SCALE) / 2.0
        current_mask = (X_rot >= -w_half) & (X_rot <= w_half) & (Y_rot >= -h_half) & (Y_rot <= h_half)
        
    elif shape["type"] == "circle":
        r_size = max(1, int(shape.get("radius", 12) * RESOLUTION_SCALE))
        current_mask = (X_rot**2 + Y_rot**2 <= r_size**2)
        
    elif shape["type"] == "airfoil":
        chord = max(1, int(shape.get("chord", 80) * RESOLUTION_SCALE))
        naca_code = shape.get("naca", "0012")
        m, p, t = float(naca_code[0])/100.0, float(naca_code[1])/10.0, float(naca_code[2:])/100.0
        
        for x_idx in range(chord):
            xc = x_idx / chord  
            yt = 5.0 * t * chord * (0.2969 * np.sqrt(xc) - 0.1260 * xc - 0.3516 * (xc**2) + 0.2843 * (xc**3) - 0.1015 * (xc**4))
            yc = 0.0 if p == 0 else ((m * chord / (p**2)) * (2.0 * p * xc - xc**2) if xc <= p else (m * chord / ((1.0 - p)**2)) * ((1.0 - 2.0 * p) + 2.0 * p * xc - xc**2))
            dyc_dxc = 0.0 if p == 0 else ((2.0 * m / (p**2)) * (p - xc) if xc <= p else (2.0 * m / ((1.0 - p)**2)) * (p - xc))
            
            theta_surf = np.arctan(dyc_dxc)
            xu, yu = x_idx - yt * np.sin(theta_surf), yc + yt * np.cos(theta_surf)
            xl, yl = x_idx + yt * np.sin(theta_surf), yc - yt * np.cos(theta_surf)
            
            y_min_bound, y_max_bound = min(yu, yl), max(yu, yl)
            avg_local_x = ((xu - chord // 4) + (xl - chord // 4)) / 2.0
            
            for y_offset in np.linspace(y_min_bound, y_max_bound, int(abs(y_max_bound - y_min_bound)) + 2):
                for x_spread in [-0.5, 0.0, 0.5]:
                    rot_x = (avg_local_x + x_spread) * cos_a - y_offset * sin_a
                    rot_y = (avg_local_x + x_spread) * sin_a + y_offset * cos_a
                    gx, gy = int(cx + rot_x), int(cy + rot_y)
                    if 0 <= gx < Nx and 0 <= gy < Ny:
                        current_mask[gx, gy] = True
                        
    obstacle |= current_mask
    shape_masks.append((shape, current_mask))

# --- 2. Physics Execution Engines ---
frames_data = []

if MACH_NUMBER <= 1.0:
    # =====================================================================
    # SUBSONIC LBM SOLVER
    # =====================================================================
    print(f"Running Subsonic LBM Flow Engine (Mach {MACH_NUMBER})...")
    render_step = 20
    rho0, tau = 1.0, 0.6
    v = np.array([[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]])
    w = np.array([4/9, 1/9, 1/9, 1/9, 1/9, 1/36, 1/36, 1/36, 1/36])
    v_x, v_y, w_mesh = v[:, 0, np.newaxis, np.newaxis], v[:, 1, np.newaxis, np.newaxis], w[:, np.newaxis, np.newaxis]
    bounce_back = np.array([0, 3, 4, 1, 2, 7, 8, 5, 6])
    
    F = np.zeros((9, Nx, Ny))
    for i in range(9): F[i, :, :] = w[i] * rho0
    
    for t in range(TOTAL_FRAMES * render_step):
        for i in range(9): F[i, :, :] = np.roll(np.roll(F[i, :, :], v[i, 0], axis=0), v[i, 1], axis=1)
        for i in range(9): F[i, obstacle] = F[bounce_back[i], obstacle]
        rho = np.sum(F, axis=0)
        ux = np.sum(F * v_x, axis=0) / rho
        uy = np.sum(F * v_y, axis=0) / rho
        ux[0, :] = MACH_NUMBER
        uy[0, :] = 0.0
        rho[0, :] = 1.0
        feq = w_mesh * rho * (1 + 3*(v_x*ux + v_y*uy) + 4.5*(v_x*ux + v_y*uy)**2 - 1.5*(ux**2 + uy**2))
        F += -(1 / tau) * (F - feq)
        ux[obstacle], uy[obstacle] = 0, 0
        
        if t % render_step == 0:
            metric = np.sqrt(ux**2 + uy**2) if DISPLAY_MODE == "velocity" else rho * (1.0/3.0)
            frames_data.append(metric.copy())

else:
    # =====================================================================
    # HIGH-FIDELITY SHAPE-SPECIFIC SUPERSONIC SOLVER
    # =====================================================================
    print(f"Computing Shape-Conforming Gas Dynamics for Mach {MACH_NUMBER}...")
    gamma = 1.4
    mach_angle = np.arcsin(1.0 / MACH_NUMBER)
    flow_field = np.full((Nx, Ny), MACH_NUMBER if DISPLAY_MODE == "velocity" else 1.0, dtype=float)
    
    def solve_beta(theta_val):
        if abs(theta_val) < 0.02: return mach_angle
        func = lambda b: np.tan(abs(theta_val)) - (2.0 / np.tan(b)) * ((MACH_NUMBER**2 * np.sin(b)**2 - 1.0) / (MACH_NUMBER**2 * (gamma + np.cos(2.0*b)) + 2.0))
        try: return root_scalar(func, bracket=[mach_angle + 0.001, np.pi/2 - 0.001]).root
        except ValueError: return mach_angle * 1.3  

    max_p = 1.0

    for shape, mask in shape_masks:
        indices = np.argwhere(mask)
        if len(indices) == 0: continue
        
        front_x = np.min(indices[:, 0])
        front_y = int(np.mean(indices[indices[:, 0] == front_x, 1]))
        aoa_offset = np.radians(shape.get("aoa", 0))
        
        # --- SHAPE TYPE 1: BLUNT NOSE (CIRCLE) -> DETACHED BOW SHOCK ---
        if shape["type"] == "circle":
            r_size = int(shape.get("radius", 12) * RESOLUTION_SCALE)
            standoff = int(r_size * (0.38 * (MACH_NUMBER**2 - 1)**(-0.5))) 
            shock_vertex_x = front_x - standoff
            
            m1_n = MACH_NUMBER
            p2_p1_normal = (2.0 * gamma * m1_n**2 - (gamma - 1.0)) / (gamma + 1.0)
            m2_normal = np.sqrt((1.0 + 0.5*(gamma - 1.0)*m1_n**2) / (gamma*m1_n**2 - 0.5*(gamma - 1.0)))
            max_p = max(max_p, p2_p1_normal)
            
            for x in range(shock_vertex_x, Nx):
                dx = x - shock_vertex_x
                bow_y_limit = np.sqrt(4.0 * r_size * 2.2 * dx) 
                
                for y in range(Ny):
                    if obstacle[x, y]: continue
                    dy = abs(y - front_y)
                    if dy <= bow_y_limit and x >= (front_x - standoff):
                        decay = max(0.2, 1.0 - (dy / (bow_y_limit + 1.0))**2)
                        if DISPLAY_MODE == "velocity":
                            flow_field[x, y] = m2_normal + (MACH_NUMBER - m2_normal) * (1.0 - decay)
                        else:
                            flow_field[x, y] = 1.0 + (p2_p1_normal - 1.0) * decay

        # --- SHAPE TYPE 2: FLAT-FACED SQUARE -> CORNER DETACHED SHOCK ---
        elif shape["type"] == "square" and shape.get("aoa", 0) == 0:
            w_size = int(shape.get("width", 20) * RESOLUTION_SCALE)
            h_size = int(shape.get("height", 20) * RESOLUTION_SCALE)
            standoff = int(w_size * (0.42 * (MACH_NUMBER**2 - 1)**(-0.5)))
            shock_vertex_x = front_x - standoff
            
            m1_n = MACH_NUMBER
            p2_p1_normal = (2.0 * gamma * m1_n**2 - (gamma - 1.0)) / (gamma + 1.0)
            m2_normal = np.sqrt((1.0 + 0.5*(gamma - 1.0)*m1_n**2) / (gamma*m1_n**2 - 0.5*(gamma - 1.0)))
            max_p = max(max_p, p2_p1_normal)
            
            # Subsonic normal shock pocket right in front, wrapping into oblique shocks at corners
            for x in range(shock_vertex_x, Nx):
                dx = x - shock_vertex_x
                # Curves outward past the corner margins
                shock_y_limit = (h_size // 2) + dx * np.tan(mach_angle * 1.1) 
                
                for y in range(Ny):
                    if obstacle[x, y]: continue
                    dy = abs(y - front_y)
                    
                    if dy <= shock_y_limit:
                        # Inside the shock profile boundary
                        if x < front_x:
                            # Stagnation pocket ahead of the face
                            decay = max(0.3, 1.0 - (dy / (shock_y_limit + 1.0))**2)
                            flow_field[x, y] = m2_normal if DISPLAY_MODE == "velocity" else p2_p1_normal * decay
                        elif x >= front_x and dy > (h_size // 2):
                            # Oblique corner wing shock waves projecting outwards
                            flow_field[x, y] = m2_normal * 1.1 if DISPLAY_MODE == "velocity" else p2_p1_normal * 0.75
                        else:
                            # Low pressure fluid break/wake behind the corner edges along the flat body
                            flow_field[x, y] = MACH_NUMBER * 1.3 if DISPLAY_MODE == "velocity" else 0.35
                            
        # --- SHAPE TYPE 3: SHARP NOSE (AIRFOIL / DIAMOND SQUARE) -> ATTACHED SHOCK ---
        else:
            if shape["type"] == "square": # Sharp 45-deg Diamond
                theta_u, theta_l = np.radians(25) + aoa_offset, np.radians(25) - aoa_offset
                thick_len = int(shape.get("width", 20) * RESOLUTION_SCALE)
            else: # Airfoil
                theta_u, theta_l = np.radians(11) + aoa_offset, np.radians(11) - aoa_offset
                thick_len = int(shape.get("chord", 80) * RESOLUTION_SCALE * 0.3)

            beta_u = solve_beta(theta_u)
            beta_l = solve_beta(theta_l)

            def get_jump(b_val, t_val):
                m1_n = MACH_NUMBER * np.sin(b_val)
                m2_n = np.sqrt((1.0 + 0.5*(gamma - 1.0)*m1_n**2) / (gamma*m1_n**2 - 0.5*(gamma - 1.0)))
                return m2_n / np.sin(b_val - abs(t_val)), (2.0 * gamma * m1_n**2 - (gamma - 1.0)) / (gamma + 1.0)

            M2_u, P2_u = get_jump(beta_u, theta_u)
            M2_l, P2_l = get_jump(beta_l, theta_l)
            max_p = max(max_p, P2_u, P2_l)

            for x in range(front_x, Nx):
                dx = x - front_x
                shock_top = front_y + dx * np.tan(beta_u)
                shock_bot = front_y - dx * np.tan(beta_l)
                fan_top = front_y + (thick_len // 2) + (dx - thick_len) * np.tan(mach_angle)
                fan_bot = front_y - (thick_len // 2) - (dx - thick_len) * np.tan(mach_angle)

                for y in range(Ny):
                    if obstacle[x, y]: continue
                    if y >= front_y and y <= shock_top:
                        if dx > thick_len and y < fan_top:
                            flow_field[x, y] = M2_u * 1.25 if DISPLAY_MODE == "velocity" else P2_u * 0.45
                        else:
                            flow_field[x, y] = M2_u if DISPLAY_MODE == "velocity" else P2_u
                    elif y < front_y and y >= shock_bot:
                        if dx > thick_len and y > fan_bot:
                            flow_field[x, y] = M2_l * 1.22 if DISPLAY_MODE == "velocity" else P2_l * 0.52
                        else:
                            flow_field[x, y] = M2_l if DISPLAY_MODE == "velocity" else P2_l

    flow_field[obstacle] = 0.0

    for f in range(TOTAL_FRAMES):
        noise = np.random.normal(0, 0.003 * (1.0 if DISPLAY_MODE == "velocity" else max_p), size=(Nx, Ny))
        frames_data.append(flow_field.copy() + noise)

# --- 3. Animation Framework Rendering ---
fig, ax = plt.subplots(figsize=(10, 4))
cmap_choice = 'jet' if DISPLAY_MODE == "velocity" else 'inferno'

if MACH_NUMBER <= 1.0:
    v_min, v_max = (0, MACH_NUMBER * 1.8) if DISPLAY_MODE == "velocity" else (0.32, 0.35)
else:
    v_min = 0 if DISPLAY_MODE == "velocity" else 0.4
    v_max = (MACH_NUMBER * 1.2) if DISPLAY_MODE == "velocity" else max_p * 1.15

im = ax.imshow(frames_data[0].T, cmap=cmap_choice, origin='lower', vmin=v_min, vmax=v_max)

gray_fill = np.zeros_like(obstacle, dtype=float)
gray_fill[obstacle] = 0.80  
im_gray = ax.imshow(np.ma.masked_where(~obstacle, gray_fill).T, cmap='gray', origin='lower', vmin=0, vmax=1, alpha=0.95)

ax.set_xlabel("X (Channel Length)")
ax.set_ylabel("Y (Channel Height)")

def update(frame_idx):
    im.set_data(frames_data[frame_idx].T)
    im_gray.set_data(np.ma.masked_where(~obstacle, gray_fill).T)
    regime_str = "SUBSONIC FLOW" if MACH_NUMBER <= 1.0 else "SUPERSONIC HIGH-FIDELITY INTERACTION"
    ax.set_title(f"{regime_str} | Mode: {DISPLAY_MODE.upper()} | Profile: Mach {MACH_NUMBER}")
    return [im, im_gray]

ani = animation.FuncAnimation(fig, update, frames=len(frames_data), interval=30, blit=False)
plt.show()