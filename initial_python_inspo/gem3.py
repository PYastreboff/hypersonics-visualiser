import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from matplotlib.widgets import Slider
import sys

# =========================================================================
# --- USER INPUT PARAMETERS ---
# =========================================================================
INITIAL_WIND_SPEED = 0.12  # Starting air velocity (Keep below 0.22 for stability)
MAX_WIND_SPEED = 0.22      # Hard safety ceiling to prevent simulation crash

SHAPES_LIST = [
    {"type": "airfoil", "cx": 100, "cy": 50, "chord": 80, "aoa": 40, "naca": "2412"},
]

DISPLAY_MODE = "velocity"  # Options: "velocity" or "pressure"
RESOLUTION_SCALE = 1.0     # Adjust grid size (1.0 = 300x100)
# =========================================================================

# --- 1. Dynamic Grid Setup ---
Nx = int(300 * RESOLUTION_SCALE)
Ny = int(100 * RESOLUTION_SCALE)

rho0, tau = 1.0, 0.6            
current_wind_speed = INITIAL_WIND_SPEED

v = np.array([[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]])
w = np.array([4/9, 1/9, 1/9, 1/9, 1/9, 1/36, 1/36, 1/36, 1/36])

v_x = v[:, 0, np.newaxis, np.newaxis]
v_y = v[:, 1, np.newaxis, np.newaxis]
w_mesh = w[:, np.newaxis, np.newaxis]
bounce_back = np.array([0, 3, 4, 1, 2, 7, 8, 5, 6])

# --- 2. Dynamic Multi-Obstacle Generation ---
obstacle = np.zeros((Nx, Ny), dtype=bool)
X_grid, Y_grid = np.meshgrid(np.arange(Nx), np.arange(Ny), indexing='ij')

for shape in SHAPES_LIST:
    cx, cy = int(shape["cx"] * RESOLUTION_SCALE), int(shape["cy"] * RESOLUTION_SCALE)
    rad = np.radians(-shape.get("aoa", 0))
    cos_a, sin_a = np.cos(rad), np.sin(rad)
    X_rot = (X_grid - cx) * cos_a - (Y_grid - cy) * sin_a
    Y_rot = (X_grid - cx) * sin_a + (Y_grid - cy) * cos_a
    
    if shape["type"] == "square":
        w_half = (shape.get("width", 20) * RESOLUTION_SCALE) / 2.0
        h_half = (shape.get("height", 20) * RESOLUTION_SCALE) / 2.0
        obstacle |= (X_rot >= -w_half) & (X_rot <= w_half) & (Y_rot >= -h_half) & (Y_rot <= h_half)
    elif shape["type"] == "circle":
        r_size = max(1, int(shape.get("radius", 12) * RESOLUTION_SCALE))
        obstacle |= (X_rot**2 + Y_rot**2 <= r_size**2)
    elif shape["type"] == "airfoil":
        chord = max(1, int(shape.get("chord", 80) * RESOLUTION_SCALE))
        naca_code = shape.get("naca", "0012")
        m, p, t = float(naca_code[0])/100.0, float(naca_code[1])/10.0, float(naca_code[2:])/100.0
        
        for x_idx in range(chord):
            xc = x_idx / chord  
            yt = 5.0 * t * chord * (0.2969 * np.sqrt(xc) - 0.1260 * xc - 0.3516 * (xc**2) + 0.2843 * (xc**3) - 0.1015 * (xc**4))
            yc = 0.0 if p == 0 else ((m * chord / (p**2)) * (2.0 * p * xc - xc**2) if xc <= p else (m * chord / ((1.0 - p)**2)) * ((1.0 - 2.0 * p) + 2.0 * p * xc - xc**2))
            dyc_dxc = 0.0 if p == 0 else ((2.0 * m / (p**2)) * (p - xc) if xc <= p else (2.0 * m / ((1.0 - p)**2)) * (p - xc))
            
            theta = np.arctan(dyc_dxc)
            xu, yu = x_idx - yt * np.sin(theta), yc + yt * np.cos(theta)
            xl, yl = x_idx + yt * np.sin(theta), yc - yt * np.cos(theta)
            
            y_min_bound, y_max_bound = min(yu, yl), max(yu, yl)
            avg_local_x = ((xu - chord // 4) + (xl - chord // 4)) / 2.0
            
            for y_offset in np.linspace(y_min_bound, y_max_bound, int(abs(y_max_bound - y_min_bound)) + 2):
                for x_spread in [-0.5, 0.0, 0.5]:
                    rot_x = (avg_local_x + x_spread) * cos_a - y_offset * sin_a
                    rot_y = (avg_local_x + x_spread) * sin_a + y_offset * cos_a
                    grid_x, grid_y = int(cx + rot_x), int(cy + rot_y)
                    if 0 <= grid_x < Nx and 0 <= grid_y < Ny:
                        obstacle[grid_x, grid_y] = True

# --- 3. Initialize Fluid State at Rest ---
F = np.zeros((9, Nx, Ny))
for i in range(9):
    F[i, :, :] = w[i] * rho0

# --- 4. Setup Interactive Window ---
fig, ax = plt.subplots(figsize=(10, 5))
plt.subplots_adjust(bottom=0.25)  # Push window layout up to make room for the slider

if DISPLAY_MODE == "velocity":
    cmap_choice, v_min, v_max = 'jet', 0, MAX_WIND_SPEED * 1.6
else:
    cmap_choice = 'jet'
    v_min = 0.330 - (MAX_WIND_SPEED * 0.05)
    v_max = 0.333 + (MAX_WIND_SPEED * 0.12)

# Display background array initial step
initial_metric = np.zeros((Nx, Ny))
im = ax.imshow(initial_metric.T, cmap=cmap_choice, origin='lower', vmin=v_min, vmax=v_max)

# Light gray shape overlay
gray_fill = np.zeros_like(obstacle, dtype=float)
gray_fill[obstacle] = 0.75  
im_gray = ax.imshow(np.ma.masked_where(~obstacle, gray_fill).T, cmap='gray', origin='lower', vmin=0, vmax=1, alpha=0.9)

ax.set_xlabel("X (Channel Length)")
ax.set_ylabel("Y (Channel Height)")

# Create Slider UI elements
ax_slider = plt.axes([0.15, 0.1, 0.7, 0.03])
speed_slider = Slider(ax_slider, 'Air Speed (m/s)', 0.0, MAX_WIND_SPEED, valinit=INITIAL_WIND_SPEED, valfmt='%0.2f')

def update_speed(val):
    global current_wind_speed
    current_wind_speed = speed_slider.val

speed_slider.on_changed(update_speed)

# --- 5. Real-Time Processing Loop Engine (With Auto-Reset Protection) ---
physics_steps_per_frame = 15  

def next_physics_frame(frame_idx):
    global F
    
    for _ in range(physics_steps_per_frame):
        for i in range(9):
            F[i, :, :] = np.roll(np.roll(F[i, :, :], v[i, 0], axis=0), v[i, 1], axis=1)
        for i in range(9):
            F[i, obstacle] = F[bounce_back[i], obstacle]
            
        rho = np.sum(F, axis=0)
        ux = np.sum(F * v_x, axis=0) / rho
        uy = np.sum(F * v_y, axis=0) / rho
        
        ux[0, :] = current_wind_speed
        uy[0, :] = 0.0
        rho[0, :] = 1.0
        
        feq = w_mesh * rho * (1 + 3*(v_x*ux + v_y*uy) + 4.5*(v_x*ux + v_y*uy)**2 - 1.5*(ux**2 + uy**2))
        F += -(1 / tau) * (F - feq)
        ux[obstacle], uy[obstacle] = 0, 0

    # STABILITY CHECK: Catch NaNs or infinities before they break matplotlib
    if np.isnan(F).any() or np.isinf(F).any():
        print("\n[WARNING]: Simulation unstable! Velocity limit exceeded. Resetting fluid flow...")
        # Reset fluid back to rest conditions safely
        F = np.zeros((9, Nx, Ny))
        for i in range(9):
            F[i, :, :] = w[i] * rho0
        # Lower the slider value automatically to help keep it stable
        speed_slider.set_val(max(0.0, current_wind_speed - 0.04))
        return [im, im_gray]

    # Read output layer if everything is stable
    if DISPLAY_MODE == "velocity":
        metric = np.sqrt(ux**2 + uy**2)
    else:
        metric = rho * (1.0 / 3.0)

    im.set_data(metric.T)
    im_gray.set_data(np.ma.masked_where(~obstacle, gray_fill).T)
    ax.set_title(f"Live CFD Wind Tunnel | Mode: {DISPLAY_MODE.upper()} | Wind Input: {round(current_wind_speed, 2)} m/s")
    
    return [im, im_gray]

# Interactive live mapping setup
ani = animation.FuncAnimation(fig, next_physics_frame, interval=1, blit=False, cache_frame_data=False)
plt.show()