import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simStore';
import { LbmSolver } from '@/physics/lbmSolver';
import {
  buildObstacleMask,
  lbmInputToSpec,
  nextLbmShapeId,
  scaleShapeSpecs,
} from '@/physics/lbmObstacles';
import { findShapeAtGrid, screenToGrid, brushScreenCircle } from '@/physics/lbmHitTest';
import {
  addBrushToStencilSet,
  stencilArraysFromKeys,
  strokeLogicalPoints,
} from '@/physics/lbmDrawBrush';
import { lbmGridSize, lbmTotalFrames, LBM_FRAME_MS, lbmDisplayModeLabel, lbmRunModeLabel, lbmPhysicsModeLabel } from '@/physics/lbmConfig';
import {
  getPrerenderFrame,
  type LbmPrerenderResult,
} from '@/physics/lbmPrerender';
import {
  getEulerTunnelMetric,
  type EulerTunnelResult,
} from '@/physics/eulerTunnelSolver';
import type { LbmDisplayMode, LbmPhysicsMode } from '@/types';
import { tunnelMetricColor, resolveTunnelMetricRange, lbmObstacleColor } from '@/visualization/jetColormap';
import { LbmColorLegend } from './LbmColorLegend';

function lbmLatticeField(mode: LbmDisplayMode): 'velocity' | 'pressure' {
  return mode === 'pressure' ? 'pressure' : 'velocity';
}

function fitDrawRect(
  containerW: number,
  containerH: number,
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  if (containerW <= 0 || containerH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const containerAspect = containerW / containerH;
  if (containerAspect > aspect) {
    const h = containerH;
    const w = h * aspect;
    return { x: (containerW - w) / 2, y: 0, w, h };
  }
  const w = containerW;
  const h = w / aspect;
  return { x: 0, y: (containerH - h) / 2, w, h };
}

function renderFrame(
  ctx: CanvasRenderingContext2D,
  metric: Float32Array,
  obstacle: Uint8Array,
  nx: number,
  ny: number,
  displayMode: LbmDisplayMode,
  physicsMode: LbmPhysicsMode,
  windSpeed: number,
  containerW: number,
  containerH: number,
  offscreen: HTMLCanvasElement,
  fluidDensity = 1,
  eulerMach = 0.3,
  eulerAltitude = 0,
  highlightMask: Uint8Array | null = null,
): { vmin: number; vmax: number } {
  const { vmin, vmax } = resolveTunnelMetricRange(
    physicsMode,
    displayMode,
    windSpeed,
    fluidDensity,
    eulerMach,
    eulerAltitude,
    metric,
    obstacle,
  );
  const range = Math.max(vmax - vmin, 1e-9);
  const image = offscreen.getContext('2d')!.createImageData(nx, ny);

  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      const idx = x * ny + y;
      const px = x;
      const py = ny - 1 - y;
      const out = (py * nx + px) * 4;

      if (obstacle[idx]) {
        const [r, g, b] = lbmObstacleColor(displayMode, Boolean(highlightMask?.[idx]), physicsMode);
        image.data[out] = r;
        image.data[out + 1] = g;
        image.data[out + 2] = b;
        image.data[out + 3] = 255;
        continue;
      }

      const t = (metric[idx] - vmin) / range;
      const [r, g, b] = tunnelMetricColor(displayMode, t);
      image.data[out] = r;
      image.data[out + 1] = g;
      image.data[out + 2] = b;
      image.data[out + 3] = 255;
    }
  }

  offscreen.width = nx;
  offscreen.height = ny;
  const offCtx = offscreen.getContext('2d')!;
  offCtx.putImageData(image, 0, 0);

  const rect = fitDrawRect(containerW, containerH, nx / ny);
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, containerW, containerH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, rect.x, rect.y, rect.w, rect.h);
  return { vmin, vmax };
}

export function LbmTunnelView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const solverRef = useRef<LbmSolver | null>(null);
  const obstacleRef = useRef<Uint8Array | null>(null);
  const prerenderRef = useRef<LbmPrerenderResult | null>(null);
  const prerenderWorkerRef = useRef<Worker | null>(null);
  const prerenderRunIdRef = useRef(0);
  const [prerenderBackend, setPrerenderBackend] = useState<'gpu' | 'cpu' | null>(null);
  const eulerResultRef = useRef<EulerTunnelResult | null>(null);
  const eulerWorkerRef = useRef<Worker | null>(null);
  const dragRef = useRef<{
    shapeId: string;
    startGx: number;
    startGy: number;
    origCx: number;
    origCy: number;
    wasPlaying: boolean;
  } | null>(null);
  const drawRef = useRef<{
    mode: 'increase' | 'decrease';
    shapeId?: string;
    cx?: number;
    cy?: number;
    stencilKeys?: Set<string>;
    lastLx: number;
    lastLy: number;
    wasPlaying: boolean;
  } | null>(null);
  const frameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);
  const hoverMaskRef = useRef<Uint8Array | null>(null);

  const {
    lbmShapes,
    lbmPhysicsMode,
    lbmDisplayMode,
    lbmWindSpeed,
    lbmFluidDensity,
    lbmEulerMach,
    lbmEulerAltitude,
    eulerTunnelStatus,
    eulerTunnelProgress,
    eulerTunnelSeed,
    lbmResolutionScale,
    lbmTunnelNx,
    lbmTunnelNy,
    lbmPlaybackSeconds,
    lbmPlaying,
    lbmSeed,
    lbmRewind,
    lbmRunMode,
    lbmPrerenderStatus,
    lbmPrerenderProgress,
    lbmElapsedSec,
    lbmFrameIndex,
    setLbmFrameIndex,
    seekLbmFrame,
    setLbmPrerenderState,
    setLbmPlaying,
    updateLbmShapePosition,
    commitLbmShapeLayout,
    setSelectedLbmShapeId,
    hoveredLbmShapeId,
    setHoveredLbmShapeId,
    lbmInteractionMode,
    lbmBrushRadius,
    lbmDrawDensity,
    addLbmShape,
    updateLbmShapeStencil,
    applyLbmEraseBrush,
    setEulerTunnelState,
  } = useSimStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushPreview, setBrushPreview] = useState<{
    cx: number;
    cy: number;
    r: number;
  } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [eulerLegendRange, setEulerLegendRange] = useState<{ vmin: number; vmax: number } | null>(
    null,
  );

  const { nx, ny, renderStep } = lbmGridSize(lbmTunnelNx, lbmTunnelNy, lbmResolutionScale);
  const totalFrames = lbmTotalFrames(lbmPlaybackSeconds);

  const getOffscreen = useCallback(() => {
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    return offscreenRef.current;
  }, []);

  const buildObstacle = useCallback(() => {
    const shapes = useSimStore.getState().lbmShapes;
    const specs = scaleShapeSpecs(
      shapes.map(lbmInputToSpec),
      lbmResolutionScale,
    );
    return buildObstacleMask(nx, ny, specs);
  }, [nx, ny, lbmResolutionScale]);

  const updateHoverHighlight = useCallback(
    (shapeId: string | null) => {
      if (!shapeId) {
        hoverMaskRef.current = null;
        return;
      }
      const shape = useSimStore.getState().lbmShapes.find((s) => s.id === shapeId);
      if (!shape) {
        hoverMaskRef.current = null;
        return;
      }
      const specs = scaleShapeSpecs([lbmInputToSpec(shape)], lbmResolutionScale);
      hoverMaskRef.current = buildObstacleMask(nx, ny, specs);
    },
    [lbmResolutionScale, nx, ny],
  );

  const paintMetric = useCallback(
    (metric: Float32Array) => {
      const canvas = canvasRef.current;
      const obstacle = obstacleRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !obstacle || !ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const viewW = canvas.clientWidth;
      const viewH = canvas.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const {
        lbmPhysicsMode,
        lbmDisplayMode,
        lbmWindSpeed,
        lbmFluidDensity,
        lbmEulerMach,
        lbmEulerAltitude,
      } = useSimStore.getState();

      const range = renderFrame(
        ctx,
        metric,
        obstacle,
        nx,
        ny,
        lbmDisplayMode,
        lbmPhysicsMode,
        lbmWindSpeed,
        viewW,
        viewH,
        getOffscreen(),
        lbmFluidDensity,
        lbmEulerMach,
        lbmEulerAltitude,
        hoverMaskRef.current,
      );
      if (lbmPhysicsMode === 'euler') {
        setEulerLegendRange(range);
      }
    },
    [nx, ny, getOffscreen],
  );

  const paintMetricRef = useRef(paintMetric);
  paintMetricRef.current = paintMetric;

  const paintCurrent = useCallback(() => {
    const {
      lbmPhysicsMode,
      lbmRunMode,
      lbmDisplayMode,
      lbmFluidDensity,
      lbmWindSpeed,
    } = useSimStore.getState();

    if (lbmPhysicsMode === 'euler') {
      const result = eulerResultRef.current;
      if (!result) return;
      paintMetric(getEulerTunnelMetric(result, lbmDisplayMode));
      return;
    }

    if (lbmRunMode === 'prerender' && prerenderRef.current) {
      paintMetric(
        getPrerenderFrame(
          prerenderRef.current,
          frameRef.current,
          lbmLatticeField(lbmDisplayMode),
          lbmFluidDensity,
          lbmWindSpeed,
        ),
      );
      return;
    }
    const solver = solverRef.current;
    if (!solver) return;
    paintMetric(solver.getMetric(lbmLatticeField(lbmDisplayMode)));
  }, [paintMetric]);

  const paintCurrentRef = useRef(paintCurrent);
  paintCurrentRef.current = paintCurrent;

  const rebuildObstacleVisual = useCallback(() => {
    const shapes = useSimStore.getState().lbmShapes;
    const specs = scaleShapeSpecs(
      shapes.map(lbmInputToSpec),
      lbmResolutionScale,
    );
    const newMask = buildObstacleMask(nx, ny, specs);
    let obstacle = obstacleRef.current;
    if (!obstacle || obstacle.length !== newMask.length) {
      obstacle = new Uint8Array(newMask);
      obstacleRef.current = obstacle;
    } else {
      obstacle.set(newMask);
    }
    solverRef.current?.updateObstacle(obstacle);
    return obstacle;
  }, [nx, ny, lbmResolutionScale]);

  const resetLiveSimulation = useCallback(() => {
    const shapes = useSimStore.getState().lbmShapes;
    const specs = scaleShapeSpecs(
      shapes.map(lbmInputToSpec),
      lbmResolutionScale,
    );
    const obstacle = buildObstacleMask(nx, ny, specs);
    obstacleRef.current = obstacle;
    solverRef.current = new LbmSolver(
      {
        nx,
        ny,
        windSpeed: useSimStore.getState().lbmWindSpeed,
        rho0: useSimStore.getState().lbmFluidDensity,
      },
      obstacle,
    );
    frameRef.current = 0;
    setLbmFrameIndex(0);
    paintMetric(solverRef.current.getMetric(lbmLatticeField(useSimStore.getState().lbmDisplayMode)));
  }, [nx, ny, lbmResolutionScale, paintMetric, setLbmFrameIndex]);

  const cancelEulerRun = useCallback(() => {
    if (eulerWorkerRef.current) {
      eulerWorkerRef.current.postMessage({ type: 'cancel' });
      eulerWorkerRef.current.terminate();
      eulerWorkerRef.current = null;
    }
  }, []);

  const startEulerRun = useCallback(() => {
    cancelEulerRun();

    const obstacle = buildObstacle();
    obstacleRef.current = obstacle;
    const obstacleCopy = new Uint8Array(obstacle);
    const { lbmEulerMach, lbmEulerAltitude } = useSimStore.getState();

    setEulerTunnelState({ status: 'running', progress: 0 });

    const worker = new Worker(
      new URL('../workers/eulerTunnel.worker.ts', import.meta.url),
      { type: 'module' },
    );
    eulerWorkerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === 'progress') {
        setEulerTunnelState({ progress: data.progress });
      } else if (data.type === 'complete') {
        eulerResultRef.current = {
          nx: data.nx,
          ny: data.ny,
          mach: data.mach,
          altitude: data.altitude,
          velocity: data.velocity,
          machField: data.machField,
          pressure: data.pressure,
        };
        setEulerTunnelState({ status: 'ready', progress: 1 });
        paintMetricRef.current(
          getEulerTunnelMetric(eulerResultRef.current, useSimStore.getState().lbmDisplayMode),
        );
        worker.terminate();
        eulerWorkerRef.current = null;
      } else if (data.type === 'error') {
        setEulerTunnelState({ status: 'error', progress: 0 });
        worker.terminate();
        eulerWorkerRef.current = null;
      } else if (data.type === 'cancelled') {
        setEulerTunnelState({ status: 'cancelled', progress: 0 });
        worker.terminate();
        eulerWorkerRef.current = null;
      }
    };

    worker.postMessage(
      {
        type: 'run',
        nx,
        ny,
        mach: lbmEulerMach,
        altitude: lbmEulerAltitude,
        obstacle: obstacleCopy.buffer,
      },
      [obstacleCopy.buffer],
    );
  }, [buildObstacle, cancelEulerRun, nx, ny, setEulerTunnelState]);

  const cancelPrerender = useCallback(() => {
    prerenderRunIdRef.current += 1;
    if (prerenderWorkerRef.current) {
      prerenderWorkerRef.current.postMessage({ type: 'cancel' });
      prerenderWorkerRef.current.terminate();
      prerenderWorkerRef.current = null;
    }
  }, []);

  const startPrerender = useCallback(() => {
    cancelPrerender();
    prerenderRef.current = null;
    setPrerenderBackend(null);

    const runId = ++prerenderRunIdRef.current;
    const obstacle = buildObstacle();
    obstacleRef.current = obstacle;
    const obstacleCopy = new Uint8Array(obstacle);

    setLbmPrerenderState({ status: 'running', progress: 0 });
    setLbmPlaying(false);
    frameRef.current = 0;
    setLbmFrameIndex(0);

    const worker = new Worker(
      new URL('../workers/lbmPrerender.worker.ts', import.meta.url),
      { type: 'module' },
    );
    prerenderWorkerRef.current = worker;

    const isCurrentRun = () => runId === prerenderRunIdRef.current;

    worker.onmessage = (e: MessageEvent) => {
      if (!isCurrentRun()) return;
      const data = e.data;
      if (data.type === 'progress') {
        if (data.backend) setPrerenderBackend(data.backend);
        setLbmPrerenderState({ progress: data.progress });
      } else if (data.type === 'complete') {
        if (data.backend) setPrerenderBackend(data.backend);
        prerenderRef.current = {
          velocityFrames: data.velocityFrames,
          pressureFrames: data.pressureFrames,
          totalFrames: data.totalFrames,
          nx: data.nx,
          ny: data.ny,
          fluidDensity: useSimStore.getState().lbmFluidDensity,
          windSpeed: useSimStore.getState().lbmWindSpeed,
        };
        setLbmPrerenderState({ status: 'ready', progress: 1 });
        frameRef.current = 0;
        setLbmFrameIndex(0);
        setLbmPlaying(true);
        paintMetricRef.current(
          getPrerenderFrame(
            prerenderRef.current,
            0,
            lbmLatticeField(useSimStore.getState().lbmDisplayMode),
            useSimStore.getState().lbmFluidDensity,
            useSimStore.getState().lbmWindSpeed,
          ),
        );
        worker.terminate();
        prerenderWorkerRef.current = null;
      } else if (data.type === 'error') {
        setLbmPrerenderState({ status: 'error', progress: 0 });
        worker.terminate();
        prerenderWorkerRef.current = null;
      } else if (data.type === 'cancelled') {
        if (prerenderWorkerRef.current === worker) {
          setLbmPrerenderState({ status: 'cancelled', progress: 0 });
        }
        worker.terminate();
        if (prerenderWorkerRef.current === worker) {
          prerenderWorkerRef.current = null;
        }
      }
    };

    worker.onerror = () => {
      if (!isCurrentRun()) return;
      setLbmPrerenderState({ status: 'error', progress: 0 });
      worker.terminate();
      prerenderWorkerRef.current = null;
    };

    worker.postMessage(
      {
        type: 'run',
        nx,
        ny,
        windSpeed: useSimStore.getState().lbmWindSpeed,
        fluidDensity: useSimStore.getState().lbmFluidDensity,
        renderStep,
        playbackSeconds: lbmPlaybackSeconds,
        obstacle: obstacleCopy.buffer,
      },
      [obstacleCopy.buffer],
    );
  }, [
    buildObstacle,
    cancelPrerender,
    lbmPlaybackSeconds,
    nx,
    ny,
    paintMetric,
    renderStep,
    setLbmFrameIndex,
    seekLbmFrame,
    setLbmPlaying,
    setLbmPrerenderState,
  ]);

  const startEulerRunRef = useRef(startEulerRun);
  startEulerRunRef.current = startEulerRun;
  const startPrerenderRef = useRef(startPrerender);
  startPrerenderRef.current = startPrerender;

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm' || lbmRunMode !== 'prerender') return;
    startPrerenderRef.current();
    return () => cancelPrerender();
  }, [
    lbmPhysicsMode,
    lbmRunMode,
    lbmSeed,
    lbmResolutionScale,
    lbmTunnelNx,
    lbmTunnelNy,
    lbmPlaybackSeconds,
    nx,
    ny,
    renderStep,
    cancelPrerender,
  ]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm' || lbmRunMode === 'prerender') return;
    resetLiveSimulation();
    setLbmPlaying(true);
  }, [lbmPhysicsMode, lbmRunMode, lbmSeed, resetLiveSimulation, setLbmPlaying, lbmTunnelNx, lbmTunnelNy]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'euler') return;
    startEulerRunRef.current();
    return () => cancelEulerRun();
  }, [
    lbmPhysicsMode,
    eulerTunnelSeed,
    lbmResolutionScale,
    lbmTunnelNx,
    lbmTunnelNy,
    nx,
    ny,
    cancelEulerRun,
  ]);

  useEffect(() => {
    updateHoverHighlight(hoveredLbmShapeId);
    rebuildObstacleVisual();
    paintCurrent();
  }, [hoveredLbmShapeId, lbmShapes, lbmResolutionScale, updateHoverHighlight, rebuildObstacleVisual, paintCurrent]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm' || lbmRunMode !== 'prerender' || lbmPrerenderStatus !== 'ready' || !prerenderRef.current) return;
    frameRef.current = lbmFrameIndex;
    if (!lbmPlaying) {
      const { lbmDisplayMode, lbmFluidDensity, lbmWindSpeed } = useSimStore.getState();
      paintMetricRef.current(
        getPrerenderFrame(
          prerenderRef.current,
          lbmFrameIndex,
          lbmLatticeField(lbmDisplayMode),
          lbmFluidDensity,
          lbmWindSpeed,
        ),
      );
    }
  }, [
    lbmFrameIndex,
    lbmPhysicsMode,
    lbmRunMode,
    lbmPrerenderStatus,
    lbmPlaying,
    lbmFluidDensity,
    lbmWindSpeed,
  ]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm' || lbmRunMode !== 'prerender' || lbmPrerenderStatus !== 'ready' || !prerenderRef.current) return;
    frameRef.current = 0;
    setLbmFrameIndex(0);
    paintCurrent();
  }, [lbmPhysicsMode, lbmRewind, lbmRunMode, lbmPrerenderStatus, paintCurrent, setLbmFrameIndex]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm') return;
    solverRef.current?.updateFluidDensity(lbmFluidDensity);
    paintCurrentRef.current();
  }, [lbmPhysicsMode, lbmFluidDensity]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm') return;
    solverRef.current?.updateWindSpeed(lbmWindSpeed);
    paintCurrentRef.current();
  }, [lbmPhysicsMode, lbmWindSpeed]);

  useEffect(() => {
    paintCurrentRef.current();
  }, [lbmDisplayMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      setCanvasSize({ w, h });
      paintCurrent();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [paintCurrent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);

      if (useSimStore.getState().lbmPhysicsMode !== 'lbm') return;
      if (!lbmPlaying) return;
      if (lbmRunMode === 'prerender' && lbmPrerenderStatus !== 'ready') return;

      if (lastTickRef.current === 0) {
        lastTickRef.current = now;
        return;
      }
      if (now - lastTickRef.current < LBM_FRAME_MS) return;
      lastTickRef.current = now;

      if (lbmRunMode === 'prerender' && prerenderRef.current) {
        const nextFrame = (frameRef.current + 1) % prerenderRef.current.totalFrames;
        frameRef.current = nextFrame;
        setLbmFrameIndex(nextFrame);
        const { lbmDisplayMode, lbmFluidDensity, lbmWindSpeed } = useSimStore.getState();
        paintMetricRef.current(
          getPrerenderFrame(
            prerenderRef.current,
            nextFrame,
            lbmLatticeField(lbmDisplayMode),
            lbmFluidDensity,
            lbmWindSpeed,
          ),
        );
        return;
      }

      const solver = solverRef.current;
      if (!solver) return;

      for (let i = 0; i < renderStep; i++) {
        solver.step();
      }

      const nextFrame = frameRef.current + 1;
      frameRef.current = nextFrame;
      setLbmFrameIndex(nextFrame);
      paintMetricRef.current(solver.getMetric(lbmLatticeField(useSimStore.getState().lbmDisplayMode)));
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTickRef.current = 0;
    };
  }, [
    lbmPlaying,
    lbmRunMode,
    lbmPrerenderStatus,
    renderStep,
    setLbmFrameIndex,
  ]);

  const showSolverPlaceholder =
    !isDragging &&
    !isDrawing &&
    ((lbmPhysicsMode === 'lbm' &&
      lbmRunMode === 'prerender' &&
      lbmPrerenderStatus !== 'ready') ||
      (lbmPhysicsMode === 'euler' && eulerTunnelStatus !== 'ready'));

  const updateBrushPreview = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || useSimStore.getState().lbmInteractionMode !== 'draw') {
        setBrushPreview(null);
        return;
      }

      setBrushPreview(
        brushScreenCircle(
          clientX,
          clientY,
          canvas,
          nx,
          ny,
          useSimStore.getState().lbmBrushRadius,
          lbmResolutionScale,
          fitDrawRect,
        ),
      );
    },
    [lbmResolutionScale, nx, ny],
  );

  useEffect(() => {
    if (lbmInteractionMode !== 'draw') {
      setBrushPreview(null);
    }
  }, [lbmInteractionMode]);

  useEffect(() => {
    setBrushPreview(null);
  }, [lbmBrushRadius, lbmResolutionScale, nx, ny]);

  const applyDragAt = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas) return;

      const grid = screenToGrid(clientX, clientY, canvas, nx, ny, fitDrawRect);
      if (!grid) return;

      const deltaGx = (grid.gx - drag.startGx) / lbmResolutionScale;
      const deltaGy = (grid.gy - drag.startGy) / lbmResolutionScale;
      updateLbmShapePosition(
        drag.shapeId,
        drag.origCx + deltaGx,
        drag.origCy + deltaGy,
      );
      rebuildObstacleVisual();
      updateHoverHighlight(drag.shapeId);
      paintCurrent();
    },
    [
      lbmResolutionScale,
      nx,
      ny,
      paintCurrent,
      rebuildObstacleVisual,
      updateHoverHighlight,
      updateLbmShapePosition,
    ],
  );

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    dragRef.current = null;
    setIsDragging(false);
    commitLbmShapeLayout();
    if (drag.wasPlaying) {
      setLbmPlaying(true);
    }
  }, [commitLbmShapeLayout, setLbmPlaying]);

  const syncDrawStroke = useCallback(
    (draw: NonNullable<typeof drawRef.current>) => {
      if (!draw.shapeId || !draw.stencilKeys) return;
      const { stencilX, stencilY } = stencilArraysFromKeys(draw.stencilKeys);
      updateLbmShapeStencil(draw.shapeId, stencilX, stencilY);
      rebuildObstacleVisual();
      paintCurrent();
    },
    [paintCurrent, rebuildObstacleVisual, updateLbmShapeStencil],
  );

  const applyDrawAt = useCallback(
    (clientX: number, clientY: number, startStroke: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const grid = screenToGrid(clientX, clientY, canvas, nx, ny, fitDrawRect);
      if (!grid) return;

      const lx = grid.gx / lbmResolutionScale;
      const ly = grid.gy / lbmResolutionScale;
      const wasPlaying = useSimStore.getState().lbmPlaying;
      const runMode = useSimStore.getState().lbmRunMode;
      const density = useSimStore.getState().lbmDrawDensity;
      if (runMode !== 'live') {
        setLbmPlaying(false);
      }

      const previousPoint =
        startStroke || !drawRef.current
          ? null
          : { lx: drawRef.current.lastLx, ly: drawRef.current.lastLy };
      const points = strokeLogicalPoints(previousPoint, { lx, ly });

      if (density === 'decrease') {
        for (const point of points) {
          applyLbmEraseBrush(point.lx, point.ly, lbmBrushRadius);
        }
        drawRef.current = {
          mode: 'decrease',
          lastLx: lx,
          lastLy: ly,
          wasPlaying,
        };
        setIsDrawing(true);
        rebuildObstacleVisual();
        paintCurrent();
        return;
      }

      let draw = drawRef.current;
      if (startStroke || !draw?.shapeId || !draw.stencilKeys || draw.cx === undefined || draw.cy === undefined) {
        const cx = Math.round(lx);
        const cy = Math.round(ly);
        const stencilKeys = new Set<string>();
        for (const point of points) {
          addBrushToStencilSet(stencilKeys, cx, cy, point.lx, point.ly, lbmBrushRadius);
        }
        const shapeId = nextLbmShapeId();
        const drawnCount = useSimStore
          .getState()
          .lbmShapes.filter((shape) => shape.customSource === 'drawn').length;

        addLbmShape({
          id: shapeId,
          type: 'custom',
          customSource: 'drawn',
          name: `Drawn ${drawnCount + 1}`,
          cx,
          cy,
          aoa: 0,
          customScale: 1,
          ...stencilArraysFromKeys(stencilKeys),
        });
        setSelectedLbmShapeId(shapeId);
        draw = {
          mode: 'increase',
          shapeId,
          cx,
          cy,
          stencilKeys,
          lastLx: lx,
          lastLy: ly,
          wasPlaying,
        };
        drawRef.current = draw;
        setIsDrawing(true);
      } else {
        for (const point of points) {
          addBrushToStencilSet(draw.stencilKeys, draw.cx, draw.cy, point.lx, point.ly, lbmBrushRadius);
        }
        draw.lastLx = lx;
        draw.lastLy = ly;
      }

      syncDrawStroke(draw);
    },
    [
      addLbmShape,
      applyLbmEraseBrush,
      lbmBrushRadius,
      lbmResolutionScale,
      nx,
      ny,
      setLbmPlaying,
      setSelectedLbmShapeId,
      syncDrawStroke,
      rebuildObstacleVisual,
      paintCurrent,
    ],
  );

  const endDraw = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;

    drawRef.current = null;
    setIsDrawing(false);
    commitLbmShapeLayout();
    if (draw.wasPlaying) {
      setLbmPlaying(true);
    }
  }, [commitLbmShapeLayout, setLbmPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || showSolverPlaceholder) return;

    const onPointerDown = (e: PointerEvent) => {
      const grid = screenToGrid(e.clientX, e.clientY, canvas, nx, ny, fitDrawRect);
      if (!grid) return;

      if (useSimStore.getState().lbmInteractionMode === 'draw') {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        updateBrushPreview(e.clientX, e.clientY);
        applyDrawAt(e.clientX, e.clientY, true);
        return;
      }

      const shape = findShapeAtGrid(
        grid.gx,
        grid.gy,
        nx,
        ny,
        useSimStore.getState().lbmShapes,
        lbmResolutionScale,
      );
      if (!shape) {
        setSelectedLbmShapeId(null);
        canvas.focus();
        return;
      }

      e.preventDefault();
      canvas.focus();
      if (document.activeElement instanceof HTMLElement && document.activeElement !== canvas) {
        document.activeElement.blur();
      }
      canvas.setPointerCapture(e.pointerId);
      setSelectedLbmShapeId(shape.id);
      setHoveredLbmShapeId(shape.id);
      const runMode = useSimStore.getState().lbmRunMode;
      const wasPlaying = useSimStore.getState().lbmPlaying;
      if (runMode !== 'live') {
        setLbmPlaying(false);
      }
      setIsDragging(true);
      dragRef.current = {
        shapeId: shape.id,
        startGx: grid.gx,
        startGy: grid.gy,
        origCx: shape.cx,
        origCy: shape.cy,
        wasPlaying,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (useSimStore.getState().lbmInteractionMode === 'draw') {
        updateBrushPreview(e.clientX, e.clientY);
        if (drawRef.current) {
          applyDrawAt(e.clientX, e.clientY, false);
        }
        return;
      }

      if (drawRef.current) {
        applyDrawAt(e.clientX, e.clientY, false);
        return;
      }

      if (dragRef.current) {
        applyDragAt(e.clientX, e.clientY);
        return;
      }

      const grid = screenToGrid(e.clientX, e.clientY, canvas, nx, ny, fitDrawRect);
      if (!grid) {
        setHoveredLbmShapeId(null);
        return;
      }
      const shape = findShapeAtGrid(
        grid.gx,
        grid.gy,
        nx,
        ny,
        useSimStore.getState().lbmShapes,
        lbmResolutionScale,
      );
      setHoveredLbmShapeId(shape?.id ?? null);
    };

    const onPointerLeave = () => {
      setBrushPreview(null);
      if (!dragRef.current && !drawRef.current) {
        setHoveredLbmShapeId(null);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (drawRef.current) {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
        endDraw();
        return;
      }

      if (!dragRef.current) return;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      endDrag();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [
    applyDragAt,
    applyDrawAt,
    endDrag,
    endDraw,
    updateBrushPreview,
    lbmResolutionScale,
    nx,
    ny,
    setHoveredLbmShapeId,
    setLbmPlaying,
    setSelectedLbmShapeId,
    showSolverPlaceholder,
  ]);

  const prerenderFrame = Math.min(
    totalFrames,
    Math.round(lbmPrerenderProgress * totalFrames),
  );

  return (
    <div className="lbm-container">
      <div className="lbm-title-bar">
        <span>
          Flow Visualiser | {lbmPhysicsModeLabel(lbmPhysicsMode)} | {lbmDisplayModeLabel(lbmDisplayMode)}
          {lbmPhysicsMode === 'euler' && ' · Inviscid Euler — educational'}
          {lbmPhysicsMode === 'lbm' && lbmRunMode === 'live' && <> | Time: {lbmElapsedSec.toFixed(1)}s</>}
          {lbmPhysicsMode === 'lbm' && lbmRunMode === 'prerender' && (
            <>
              {' '}
              | Time: {lbmElapsedSec.toFixed(1)}s / {lbmPlaybackSeconds.toFixed(1)}s
            </>
          )}
        </span>
        <span className="lbm-grid-label">
          {nx} × {ny} grid · {lbmShapes.length} obstacle{lbmShapes.length === 1 ? '' : 's'}
          {lbmPhysicsMode === 'lbm' && <> · {lbmRunModeLabel(lbmRunMode)}</>}
          {lbmPhysicsMode === 'euler' && (
            <> · Ma {lbmEulerMach.toFixed(2)} · {lbmEulerAltitude} m</>
          )}
        </span>
      </div>

      <div className="lbm-stage">
      <div className="lbm-canvas-wrap" style={{ aspectRatio: `${nx} / ${ny}` }}>
        {showSolverPlaceholder && (
          <div className="lbm-placeholder">
            <div className="lbm-placeholder-inner">
              <strong>
                {lbmPhysicsMode === 'euler' ? 'Running Euler solver' : 'Pre-rendering simulation'}
              </strong>
              <p>
                {lbmPhysicsMode === 'euler'
                  ? eulerTunnelStatus === 'error'
                    ? 'Euler solve failed — try a lower Mach or coarser grid.'
                    : 'Computing compressible inviscid flow on the tunnel grid.'
                  : lbmPrerenderStatus === 'error'
                    ? 'Pre-render failed — adjust settings or switch to Live mode.'
                    : prerenderBackend === 'gpu'
                      ? 'Computing all frames on GPU before playback.'
                      : 'Computing all frames before playback.'}
              </p>
              {(lbmPhysicsMode === 'euler'
                ? eulerTunnelStatus !== 'error'
                : lbmPrerenderStatus !== 'error') && (
                <>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${
                          (lbmPhysicsMode === 'euler'
                            ? eulerTunnelProgress
                            : lbmPrerenderProgress) * 100
                        }%`,
                      }}
                    />
                  </div>
                  {lbmPhysicsMode === 'lbm' && (
                    <span>
                      Frame {prerenderFrame} / {totalFrames}
                    </span>
                  )}
                  {lbmPhysicsMode === 'euler' && (
                    <span>{Math.round(eulerTunnelProgress * 100)}%</span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="Flow tunnel canvas"
          className={[
            'lbm-canvas',
            showSolverPlaceholder ? 'lbm-canvas-hidden' : '',
            isDrawing
              ? 'lbm-canvas-drawing'
              : lbmInteractionMode === 'draw'
                ? 'lbm-canvas-draw'
                : isDragging
                  ? 'lbm-canvas-dragging'
                  : hoveredLbmShapeId
                    ? 'lbm-canvas-grab'
                    : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {brushPreview &&
          !showSolverPlaceholder &&
          lbmInteractionMode === 'draw' &&
          canvasSize.w > 0 && (
            <svg
              className="lbm-brush-overlay"
              viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
              aria-hidden
            >
              <circle
                cx={brushPreview.cx}
                cy={brushPreview.cy}
                r={brushPreview.r}
                className={
                  lbmDrawDensity === 'decrease'
                    ? 'lbm-brush-outline erase'
                    : 'lbm-brush-outline'
                }
              />
            </svg>
          )}
      </div>
      </div>
      {lbmPhysicsMode === 'lbm' &&
        lbmRunMode === 'prerender' &&
        lbmPrerenderStatus === 'ready' &&
        !showSolverPlaceholder && (
          <div className="lbm-scrubber">
            <input
              type="range"
              className="lbm-scrubber-input"
              min={0}
              max={Math.max(0, totalFrames - 1)}
              value={Math.min(lbmFrameIndex, Math.max(0, totalFrames - 1))}
              onPointerDown={() => setLbmPlaying(false)}
              onInput={(e) => seekLbmFrame(parseInt(e.currentTarget.value, 10))}
              aria-label="Scrub pre-rendered simulation"
            />
            <div className="lbm-scrubber-meta">
              <span>
                {lbmElapsedSec.toFixed(1)}s / {lbmPlaybackSeconds.toFixed(1)}s
              </span>
              <span>
                Frame {lbmFrameIndex + 1} / {totalFrames}
              </span>
            </div>
          </div>
        )}
      {!showSolverPlaceholder && (
        <LbmColorLegend
          physicsMode={lbmPhysicsMode}
          displayMode={lbmDisplayMode}
          windSpeed={lbmWindSpeed}
          fluidDensity={lbmFluidDensity}
          eulerMach={lbmEulerMach}
          eulerAltitude={lbmEulerAltitude}
          rangeOverride={lbmPhysicsMode === 'euler' ? eulerLegendRange : null}
        />
      )}
      {!showSolverPlaceholder && (
        <p className="lbm-drag-hint">
          {lbmInteractionMode === 'draw'
            ? lbmDrawDensity === 'decrease'
              ? 'Drag on the canvas to erase painted obstacles'
              : 'Click and drag on the canvas to paint obstacles'
            : 'Click and drag shapes to move them'}
        </p>
      )}
    </div>
  );
}
