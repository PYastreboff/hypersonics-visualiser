# Flow Visualiser

A browser-based flow visualiser — 2D Lattice Boltzmann CFD and an interactive 3D flow tunnel for shapes from subsonic to hypersonic (Mach 0–12+).

## Features

- **LBM CFD** — 2D Lattice Boltzmann wind tunnel (ported from `gem.py`) with jet colormap, velocity/pressure fields, and configurable obstacles
- **Interactive 3D flow view** — place, move, and rotate shapes (sphere, cone, wedge, cylinder, flat plate, biconic, ogive)
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
| `npm run build:pages` | Production build for GitHub Pages |
| `npm run preview` | Preview production build |
| `npm run preview:pages` | Preview the GitHub Pages build locally |
| `npm run deploy` | Manual deploy to `gh-pages` (optional; CI does this on push) |
| `npm test` | Run unit tests |

## GitHub Pages

Pushes to `main` build with base path `/<repo-name>/` (e.g. `/hypersonics-visualiser/`) and deploy via GitHub Actions.

1. Push this repo to GitHub.
2. In the repo: **Settings → Pages → Build and deployment → Source** → select **GitHub Actions** (not “Deploy from a branch” and not `main`).
3. Push to `main` — the [Deploy workflow](.github/workflows/deploy.yml) runs tests, builds, and publishes `dist/`.

The site will be at **https://pyastreboff.github.io/hypersonics-visualiser/**

**Blank white page?** Usually one of these:

- **Wrong base path** — the build must use `/hypersonics-visualiser/` (matching the GitHub repo name). Asset URLs like `/flow-visualiser/assets/...` will 404.
- **Pages source is wrong** — use **GitHub Actions**, not the `main` branch (source only, no built app) or a stale `gh-pages` branch from an old manual deploy.
- **Wrong URL** — open the project URL above, not the raw `gh-pages` branch file listing on GitHub.

To preview the Pages build locally:

```bash
npm run preview:pages
```

Then open http://localhost:4173/hypersonics-visualiser/

To deploy manually to the `gh-pages` branch (only if Pages source is set to that branch): `npm run deploy`

## Physics limitations

- **Preview mode** is educational / qualitative — regime-specific analytical models, not full 3D Navier-Stokes
- **Transition** uses Reynolds correlations, not boundary-layer PDEs
- **Multi-body** interaction uses distance-weighted field blending in preview; true multi-body CFD only in HF mode
- **HF mode** runs 2D inviscid Euler on a coarse grid — no skin friction from the solver
- **Mach 10+** uses ideal gas (γ = 1.4); real-gas chemistry is not modeled

## Controls

- **Left panel** — flow parameters, shapes, and visualization toggles
- **Right panel** (3D mode) — drag, lift, Reynolds, stagnation temperature
- **3D view** — orbit (drag), select shape (click), move (TransformControls when selected)
- **LBM CFD view** — `gem.py` inputs: wind speed, shapes list, playback time, display mode, resolution
- **Run high-fidelity** — launches 2D Euler worker; enable slice plane to view results
