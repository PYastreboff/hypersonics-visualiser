# Hypersonics Visualiser

A browser-based virtual wind tunnel for visualising hypersonic and supersonic flow effects on 3D shapes — Mach 0 to 10+.

## Features

- **Interactive wind tunnel** — place, move, and rotate shapes (sphere, cone, wedge, cylinder, flat plate, biconic, ogive)
- **Mach 0–12** with altitude-linked atmosphere (ISA), Reynolds number, and regime detection
- **Live preview physics** — regime-aware flow field, streamlines, shock surfaces, surface Cp/temperature coloring
- **Aerodynamic metrics** — Cd, Cl, pressure drag, skin friction, wall temperature, multi-body interference estimate
- **Transition visualization** — laminar / transitional / turbulent bands (Re\_x correlation)
- **Slice planes** — density, temperature, or Mach false-color fields
- **STL import** — load custom bodies
- **High-fidelity mode** — 2D compressible Euler solver in a Web Worker (coarse grid, inviscid)

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm test` | Run unit tests |

## Physics limitations

- **Preview mode** is educational / qualitative — regime-specific analytical models, not full 3D Navier-Stokes
- **Transition** uses Reynolds correlations, not boundary-layer PDEs
- **Multi-body** interaction uses distance-weighted field blending in preview; true multi-body CFD only in HF mode
- **HF mode** runs 2D inviscid Euler on a coarse grid — no skin friction from the solver
- **Mach 10+** uses ideal gas (γ = 1.4); real-gas chemistry is not modeled

## Controls

- **Left panel** — add shapes, flow parameters, visualization toggles
- **Right panel** — drag, lift, Reynolds, stagnation temperature
- **3D view** — orbit (drag), select shape (click), move (TransformControls when selected)
- **Run high-fidelity** — launches 2D Euler worker; enable slice plane to view results
