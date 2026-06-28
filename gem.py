import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import sys

# =========================================================================
# --- USER INPUT PARAMETERS (CHANGE THESE TO TEST SPEEDS & SHAPES) ---
# =========================================================================
WIND_SPEED = 0.13          # Adjust wind velocity in m/s (e.g., 0.05 to 0.15)

# MULTIPLE SHAPES CONFIGURATION
SHAPES_LIST = [
    {"type": "airfoil", "cx": 100, "cy": 50, "chord": 80, "aoa": 15, "naca": "2412"},
    {"type": "square",  "cx": 220, "cy": 40, "width": 20, "height": 20, "aoa": 30}
]

# AUTOMATIC TIME CONTROL
PLAYBACK_TIME_SECONDS = 6.0  # How long do you want the final video to play for?

# Display and Resolution controls
DISPLAY_MODE = "velocity"  # Options: "velocity" (m/s) or "pressure"
RESOLUTION_SCALE = 1.0     # 0.5 = Low Res, 1.0 = Standard (300x100), 2.0 = High Res
# =========================================================================

# --- 1. Calculate Frames Dynamically From Playback Time ---
TOTAL_FRAMES = int(PLAYBACK_TIME_SECONDS * (1000 / 30))

# --- 2. Dynamic Grid Setup ---
Nx = int(300 * RESOLUTION_SCALE)
Ny = int(100 * RESOLUTION_SCALE)
render_step = int(20 * RESOLUTION_SCALE) 

if render_step < 1:
    render_step = 1

rho0, tau = 1.0, 0.6            

v = np.array([[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]])
w = np.array([4/9, 1/9, 1/9, 1/9, 1/9, 1/36, 1/36, 1/36, 1/36])

v_x = v[:, 0, np.newaxis, np.newaxis]
v_y = v[:, 1, np.newaxis, np.newaxis]
w_mesh = w[:, np.newaxis, np.newaxis]
bounce_back = np.array([0, 3, 4, 1, 2, 7, 8, 5, 6])

# --- 3. Dynamic Multi-Obstacle Generation ---
obstacle = np.zeros((Nx, Ny), dtype=bool)
X_grid, Y_grid = np.meshgrid(np.arange(Nx), np.arange(Ny), indexing='ij')

for shape in SHAPES_LIST:
    cx = int(shape["cx"] * RESOLUTION_SCALE)
    cy = int(shape["cy"] * RESOLUTION_SCALE)
    aoa = shape.get("aoa", 0)
    
    rad = np.radians(-aoa)
    cos_a, sin_a = np.cos(rad), np.sin(rad)
    
    X_local = X_grid - cx
    Y_local = Y_grid - cy
    
    X_rot = X_local * cos_a - Y_local * sin_a
    Y_rot = X_local * sin_a + Y_local * cos_a
    
    if shape["type"] == "square":
        w_half = (shape.get("width", 20) * RESOLUTION_SCALE) / 2.0
        h_half = (shape.get("height", 20) * RESOLUTION_SCALE) / 2.0
        shape_mask = (X_rot >= -w_half) & (X_rot <= w_half) & (Y_rot >= -h_half) & (Y_rot <= h_half)
        obstacle |= shape_mask

    elif shape["type"] == "circle":
        r_size = max(1, int(shape.get("radius", 12) * RESOLUTION_SCALE))
        shape_mask = (X_rot**2 + Y_rot**2 <= r_size**2)
        obstacle |= shape_mask

    elif shape["type"] == "airfoil":
        chord = max(1, int(shape.get("chord", 80) * RESOLUTION_SCALE))
        naca_code = shape.get("naca", "0012")
        m = float(naca_code[0]) / 100.0   
        p = float(naca_code[1]) / 10.0    
        t = float(naca_code[2:]) / 100.0  
        
        for x_idx in range(chord):
            xc = x_idx / chord  
            yt = 5.0 * t * chord * (0.2969 * np.sqrt(xc) - 0.1260 * xc - 0.3516 * (xc**2) + 0.2843 * (xc**3) - 0.1015 * (xc**4))
            
            if p == 0:  
                yc = 0.0
                dyc_dxc = 0.0
            else:
                if xc <= p:
                    yc = (m * chord / (p**2)) * (2.0 * p * xc - xc**2)
                    dyc_dxc = (2.0 * m / (p**2)) * (p - xc)
                else:
                    yc = (m * chord / ((1.0 - p)**2)) * ((1.0 - 2.0 * p) + 2.0 * p * xc - xc**2)
                    dyc_dxc = (2.0 * m / ((1.0 - p)**2)) * (p - xc)
            
            theta = np.arctan(dyc_dxc)
            xu = x_idx - yt * np.sin(theta)
            yu = yc + yt * np.cos(theta)
            xl = x_idx + yt * np.sin(theta)
            yl = yc - yt * np.cos(theta)
            
            local_xu, local_yu = xu - chord // 4, yu
            local_xl, local_yl = xl - chord // 4, yl
            
            y_min_bound = min(local_yu, local_yl)
            y_max_bound = max(local_yu, local_yl)
            avg_local_x = (local_xu + local_xl) / 2.0
            
            # Draw extra thick vertical bounding bars to seal mathematical coordinate gaps
            for y_offset in np.linspace(y_min_bound, y_max_bound, int(abs(y_max_bound - y_min_bound)) + 2):
                for x_spread in [-0.5, 0.0, 0.5]:  # Left/Right micro-spread patches the structural gaps
                    rot_x = (avg_local_x + x_spread) * cos_a - y_offset * sin_a
                    rot_y = (avg_local_x + x_spread) * sin_a + y_offset * cos_a
                    grid_x, grid_y = int(cx + rot_x), int(cy + rot_y)
                    if 0 <= grid_x < Nx and 0 <= grid_y < Ny:
                        obstacle[grid_x, grid_y] = True

# --- 4. Initialize Fluid State at Rest ---
F = np.zeros((9, Nx, Ny))
for i in range(9):
    F[i, :, :] = w[i] * rho0

frames_data = []

# --- 5. Main Background Physics Loop ---
total_physics_steps = TOTAL_FRAMES * render_step
print(f"Starting Seamless CFD Engine ({Nx}x{Ny} Grid)...")

for t in range(total_physics_steps):
    for i in range(9):
        F[i, :, :] = np.roll(np.roll(F[i, :, :], v[i, 0], axis=0), v[i, 1], axis=1)
    for i in range(9):
        F[i, obstacle] = F[bounce_back[i], obstacle]
        
    rho = np.sum(F, axis=0)
    ux = np.sum(F * v_x, axis=0) / rho
    uy = np.sum(F * v_y, axis=0) / rho
    
    ux[0, :] = WIND_SPEED
    uy[0, :] = 0.0
    rho[0, :] = 1.0
    
    feq = w_mesh * rho * (1 + 3*(v_x*ux + v_y*uy) + 4.5*(v_x*ux + v_y*uy)**2 - 1.5*(ux**2 + uy**2))
    F += -(1 / tau) * (F - feq)
    ux[obstacle], uy[obstacle] = 0, 0

    if t % render_step == 0:
        metric = np.sqrt(ux**2 + uy**2) if DISPLAY_MODE == "velocity" else rho * (1.0 / 3.0) 
        frames_data.append(metric.copy())
        sys.stdout.write(f"\rRendering frame: {len(frames_data)} / {TOTAL_FRAMES}")
        sys.stdout.flush()

print("\nPre-rendering completely finished! Initializing playback.")

# --- 6. Animation Playback Engine (Gap-Free Light Gray) ---
fig, ax = plt.subplots(figsize=(10, 4))

if DISPLAY_MODE == "velocity":
    cmap_choice, v_min, v_max = 'jet', 0, WIND_SPEED * 1.8
else:
    cmap_choice = 'jet'
    v_min = 0.330 - (WIND_SPEED * 0.05)
    v_max = 0.333 + (WIND_SPEED * 0.12)

# 1. Base fluid animation
im = ax.imshow(frames_data[0].T, cmap=cmap_choice, origin='lower', vmin=v_min, vmax=v_max)

# 2. Setup structural mask for a solid light gray color profile
gray_fill = np.zeros_like(obstacle, dtype=float)
gray_fill[obstacle] = 0.75  # 0.75 pushes it higher up the black->white spectrum for light gray

# Drawing mask with balanced alpha and tight bounds ensures a uniform light-gray layer
im_gray = ax.imshow(np.ma.masked_where(~obstacle, gray_fill).T, cmap='gray', origin='lower', vmin=0, vmax=1, alpha=0.9)

ax.set_xlabel("X (Channel Length)")
ax.set_ylabel("Y (Channel Height)")

def update(frame_idx):
    im.set_data(frames_data[frame_idx].T)
    im_gray.set_data(np.ma.masked_where(~obstacle, gray_fill).T)
    ax.set_title(f"CFD Wind Tunnel | Mode: {DISPLAY_MODE.upper()} | Time: {round((frame_idx * 30)/1000, 1)}s / {PLAYBACK_TIME_SECONDS}s")
    return [im, im_gray]

ani = animation.FuncAnimation(fig, update, frames=len(frames_data), interval=30, blit=False)
plt.show()