import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSimStore } from '@/store/simStore';
import {
  buildObstacleData,
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
import {
  lbmGridSize,
  lbmTotalFrames,
  LBM_FRAME_MS,
  EULER_FRAME_MS,
  lbmDisplayModeLabel,
  formatLbmLegendValue,
  lbmRunModeLabel,
  lbmPhysicsModeLabel,
  eulerRunModeLabel,
  eulerLiveStepsPerFrame,
  formatEulerElapsedMs,
  formatPhysicalSimTime,
  isLbmLiveRealTimeFromIntervals,
  pushLbmFrameInterval,
  liveSimTimeMsFromFrames,
  eulerFreestreamPressure,
  eulerFreestreamSpeed,
} from '@/physics/lbmConfig';
import { temperatureAtAltitude } from '@/physics/atmosphere';
import { formatDragCoefficient, computeDragFromEulerResult, computeLbmTunnelDrag } from '@/physics/tunnelDrag';
import {
  getEulerTunnelMetric,
  eulerTunnelSizeM,
  type EulerTunnelResult,
} from '@/physics/eulerTunnelSolver';
import {
  getPrerenderFrame,
  type LbmPrerenderResult,
} from '@/physics/lbmPrerender';
import {
  blitLiveFrame,
  createLiveWorker,
  terminateLiveWorker,
  type LiveFrameMessage,
  type LiveProbeMessage,
  type LiveWorkerHandle,
} from '@/physics/liveTunnelWorkers';
import type { LbmDisplayMode, LbmInteractionMode, LbmPhysicsMode } from '@/types';
import {
  fitDrawRect,
  renderTunnelFrame,
  shouldTransferLiveMetric,
} from '@/visualization/tunnelRenderer';
import { LbmColorLegend } from './LbmColorLegend';

function lbmLatticeField(mode: LbmDisplayMode): 'velocity' | 'pressure' {
  return mode === 'pressure' ? 'pressure' : 'velocity';
}

function freestreamPreviewMetric(
  nx: number,
  ny: number,
  displayMode: LbmDisplayMode,
  physicsMode: LbmPhysicsMode,
  windSpeed: number,
  fluidDensity: number,
  eulerMach: number,
  eulerAltitude: number,
): Float32Array {
  const out = new Float32Array(nx * ny);
  if (physicsMode === 'euler') {
    const u0 = eulerFreestreamSpeed(eulerMach, eulerAltitude);
    const p0 = eulerFreestreamPressure(eulerMach, eulerAltitude);
    const t0 = temperatureAtAltitude(eulerAltitude);
    const value =
      displayMode === 'velocity'
        ? u0
        : displayMode === 'mach'
          ? eulerMach
          : displayMode === 'temperature'
            ? t0
            : p0;
    out.fill(value);
  } else {
    out.fill(displayMode === 'pressure' ? fluidDensity / 3 : windSpeed);
  }
  return out;
}

const LIVE_HUD_STORE_MS = 400;

function isBrushToolMode(mode: LbmInteractionMode): boolean {
  return mode === 'draw' || mode === 'erase';
}

export function LbmTunnelView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const prerenderRef = useRef<LbmPrerenderResult | null>(null);
  const prerenderWorkerRef = useRef<Worker | null>(null);
  const prerenderRunIdRef = useRef(0);
  const eulerRunIdRef = useRef(0);
  const liveWorkerRef = useRef<LiveWorkerHandle | null>(null);
  const liveWorkerBusyRef = useRef(false);
  const interactionBusyRef = useRef(false);
  const dragPaintRafRef = useRef(0);
  const lastHudStoreSyncRef = useRef(0);
  const liveHudRef = useRef({
    stepIndex: 0,
    progress: 0,
    timeLabel: '',
  });
  const titleTimeRef = useRef<HTMLSpanElement>(null);
  const titleRealTimeRef = useRef<HTMLSpanElement>(null);
  const titleCdRef = useRef<HTMLSpanElement>(null);
  const [prerenderBackend, setPrerenderBackend] = useState<'gpu' | 'cpu' | null>(null);
  const [eulerBackend, setEulerBackend] = useState<'gpu' | 'wasm' | 'cpu' | null>(null);
  const eulerResultRef = useRef<EulerTunnelResult | null>(null);
  const eulerWorkerRef = useRef<Worker | null>(null);
  const obstacleRef = useRef<Uint8Array | null>(null);
  const obstacleSlipRef = useRef<Uint8Array | null>(null);
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
  const liveWallLastRef = useRef(0);
  const liveWallMsRef = useRef(0);
  const liveSimMsRef = useRef(0);
  const liveSimTimeSRef = useRef(0);
  const liveDisplayTimeLabelRef = useRef('');
  const liveDisplayRealTimeRef = useRef(false);
  const lbmFrameIntervalsRef = useRef<number[]>([]);
  const lbmLastFrameCompleteRef = useRef(0);
  const lastTunnelCdRef = useRef<number | null>(null);
  const hoverMaskRef = useRef<Uint8Array | null>(null);
  const metricRef = useRef<Float32Array | null>(null);
  const hoverGridRef = useRef<{ gx: number; gy: number } | null>(null);
  const hoverReadoutCacheRef = useRef<string | null>(null);

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
    eulerFlowRevision,
    eulerRunMode,
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
    lbmShowTunnelDims,
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
  const [eulerLegendRange, setEulerLegendRange] = useState<{ vmin: number; vmax: number } | null>(
    null,
  );
  const [hoverReadout, setHoverReadout] = useState<string | null>(null);
  const [canvasHoverShapeId, setCanvasHoverShapeId] = useState<string | null>(null);

  const { nx, ny, renderStep } = lbmGridSize(lbmTunnelNx, lbmTunnelNy, lbmResolutionScale);
  const tunnelDims = useMemo(() => eulerTunnelSizeM(nx, ny), [nx, ny]);
  const totalFrames = lbmTotalFrames(lbmPlaybackSeconds);

  const resetLiveTiming = useCallback(() => {
    liveWallLastRef.current = 0;
    lastTickRef.current = 0;
    liveWallMsRef.current = 0;
    liveSimMsRef.current = 0;
    liveSimTimeSRef.current = 0;
    liveDisplayTimeLabelRef.current = '';
    liveDisplayRealTimeRef.current = false;
    lbmFrameIntervalsRef.current = [];
    lbmLastFrameCompleteRef.current = 0;
    liveHudRef.current = { stepIndex: 0, progress: 0, timeLabel: '' };
    lastHudStoreSyncRef.current = 0;
    if (titleTimeRef.current) titleTimeRef.current.textContent = '';
    if (titleRealTimeRef.current) titleRealTimeRef.current.hidden = true;
    if (titleCdRef.current) titleCdRef.current.textContent = '';
    setEulerTunnelState({ cd: null });
  }, [setEulerTunnelState]);

  const updateTitleCd = useCallback((cd: number | null) => {
    if (!titleCdRef.current) return;
    titleCdRef.current.textContent =
      cd === null ? '—' : formatDragCoefficient(cd);
  }, []);

  const reportTunnelCd = useCallback(
    (cd: number | null) => {
      lastTunnelCdRef.current = cd;
      updateTitleCd(cd);
      setEulerTunnelState({ cd });
    },
    [setEulerTunnelState, updateTitleCd],
  );

  useEffect(() => {
    updateTitleCd(lastTunnelCdRef.current);
  }, [updateTitleCd]);

  const refreshLbmCdFromPrerender = useCallback(
    (frameIndex: number) => {
      const obstacle = obstacleRef.current;
      const prerender = prerenderRef.current;
      if (!obstacle || !prerender) return;
      const { lbmWindSpeed, lbmFluidDensity } = useSimStore.getState();
      const pressure = getPrerenderFrame(
        prerender,
        frameIndex,
        'pressure',
        lbmFluidDensity,
        lbmWindSpeed,
      );
      const drag = computeLbmTunnelDrag(
        pressure,
        obstacle,
        nx,
        ny,
        lbmWindSpeed,
        lbmFluidDensity,
      );
      reportTunnelCd(drag?.cd ?? null);
    },
    [nx, ny, reportTunnelCd],
  );

  const updateLiveTimeDisplay = useCallback(() => {
    const state = useSimStore.getState();
    const isEulerLive = state.lbmPhysicsMode === 'euler' && state.eulerRunMode === 'live';

    let timeValue: string;
    let realTime = false;
    if (isEulerLive) {
      timeValue = formatPhysicalSimTime(liveSimTimeSRef.current);
    } else {
      const displayMs = liveSimMsRef.current;
      timeValue = formatEulerElapsedMs(Math.round(displayMs));
      realTime = isLbmLiveRealTimeFromIntervals(
        lbmFrameIntervalsRef.current,
        liveDisplayRealTimeRef.current,
      );
    }
    if (
      timeValue === liveDisplayTimeLabelRef.current &&
      realTime === liveDisplayRealTimeRef.current
    ) {
      return;
    }

    liveDisplayTimeLabelRef.current = timeValue;
    liveDisplayRealTimeRef.current = realTime;
    liveHudRef.current.timeLabel = realTime ? `${timeValue} · real time` : timeValue;

    if (titleTimeRef.current) {
      titleTimeRef.current.textContent = timeValue;
    }
    if (titleRealTimeRef.current) {
      titleRealTimeRef.current.hidden = !realTime;
    }
  }, []);

  const syncLiveHudToStore = useCallback(
    (force = false) => {
      const now = performance.now();
      if (!force && now - lastHudStoreSyncRef.current < LIVE_HUD_STORE_MS) return;
      lastHudStoreSyncRef.current = now;
      const hud = liveHudRef.current;
      setEulerTunnelState({
        status: 'running',
        progress: hud.progress,
        cd: lastTunnelCdRef.current,
      });
      setLbmFrameIndex(hud.stepIndex);
    },
    [setEulerTunnelState, setLbmFrameIndex],
  );

  const pendingObstacleRef = useRef<Uint8Array | null>(null);
  const obstacleDirtyRef = useRef(false);
  const flowParamsDirtyRef = useRef(false);
  const displayModeDirtyRef = useRef(false);
  const fluidDensityDirtyRef = useRef(false);
  const windSpeedDirtyRef = useRef(false);

  const postDisplayModeToLiveWorker = useCallback(() => {
    const worker = liveWorkerRef.current;
    if (!worker || !displayModeDirtyRef.current) return;
    if (liveWorkerBusyRef.current) return;

    const { lbmDisplayMode } = useSimStore.getState();
    liveWorkerBusyRef.current = true;
    displayModeDirtyRef.current = false;
    worker.worker.postMessage({ type: 'setDisplayMode', displayMode: lbmDisplayMode });
  }, []);

  const postFluidDensityToLiveWorker = useCallback(() => {
    const worker = liveWorkerRef.current;
    if (!worker || worker.kind !== 'lbm' || !fluidDensityDirtyRef.current) return;
    if (liveWorkerBusyRef.current) return;

    const { lbmFluidDensity } = useSimStore.getState();
    liveWorkerBusyRef.current = true;
    fluidDensityDirtyRef.current = false;
    worker.worker.postMessage({ type: 'updateFluidDensity', fluidDensity: lbmFluidDensity });
  }, []);

  const postWindSpeedToLiveWorker = useCallback(() => {
    const worker = liveWorkerRef.current;
    if (!worker || worker.kind !== 'lbm' || !windSpeedDirtyRef.current) return;
    if (liveWorkerBusyRef.current) return;

    const { lbmWindSpeed } = useSimStore.getState();
    liveWorkerBusyRef.current = true;
    windSpeedDirtyRef.current = false;
    worker.worker.postMessage({ type: 'updateWindSpeed', windSpeed: lbmWindSpeed });
  }, []);

  const postFlowParamsToLiveWorker = useCallback(() => {
    const worker = liveWorkerRef.current;
    if (!worker || worker.kind !== 'euler' || !flowParamsDirtyRef.current) return;

    if (liveWorkerBusyRef.current) return;

    const { lbmEulerMach, lbmEulerAltitude } = useSimStore.getState();
    liveWorkerBusyRef.current = true;
    flowParamsDirtyRef.current = false;
    worker.worker.postMessage({
      type: 'updateFlowParams',
      mach: lbmEulerMach,
      altitude: lbmEulerAltitude,
    });
  }, []);

  const postObstacleToLiveWorker = useCallback((obstacle: Uint8Array, obstacleSlip: Uint8Array | null) => {
    const worker = liveWorkerRef.current;
    if (!worker) return;

    if (liveWorkerBusyRef.current) {
      pendingObstacleRef.current = new Uint8Array(obstacle);
      if (obstacleSlip) obstacleSlipRef.current = new Uint8Array(obstacleSlip);
      return;
    }

    liveWorkerBusyRef.current = true;
    const obstacleCopy = new Uint8Array(obstacle);
    const slipCopy = obstacleSlip ? new Uint8Array(obstacleSlip) : new Uint8Array(obstacleCopy.length);
    worker.worker.postMessage(
      { type: 'updateObstacle', obstacle: obstacleCopy.buffer, obstacleSlip: slipCopy.buffer },
      [obstacleCopy.buffer, slipCopy.buffer],
    );
  }, []);

  const flushPendingObstacle = useCallback(() => {
    const pending = pendingObstacleRef.current;
    if (!pending) return;
    pendingObstacleRef.current = null;
    postObstacleToLiveWorker(pending, obstacleSlipRef.current);
  }, [postObstacleToLiveWorker]);

  const requestLiveStep = useCallback(
    (payload: { count?: number; renderStep?: number }) => {
      const worker = liveWorkerRef.current;
      if (!worker || liveWorkerBusyRef.current) return false;

      liveWorkerBusyRef.current = true;
      const message: Record<string, unknown> = { type: 'step', ...payload };
      const transfers: Transferable[] = [];

      if (obstacleDirtyRef.current && obstacleRef.current) {
        const copy = new Uint8Array(obstacleRef.current);
        const slipCopy = obstacleSlipRef.current
          ? new Uint8Array(obstacleSlipRef.current)
          : new Uint8Array(copy.length);
        message.obstacle = copy.buffer;
        message.obstacleSlip = slipCopy.buffer;
        transfers.push(copy.buffer, slipCopy.buffer);
        obstacleDirtyRef.current = false;
      }

      if (worker.kind === 'euler' && flowParamsDirtyRef.current) {
        const { lbmEulerMach, lbmEulerAltitude } = useSimStore.getState();
        message.mach = lbmEulerMach;
        message.altitude = lbmEulerAltitude;
        flowParamsDirtyRef.current = false;
      }

      if (displayModeDirtyRef.current) {
        message.displayMode = useSimStore.getState().lbmDisplayMode;
        displayModeDirtyRef.current = false;
      }

      if (worker.kind === 'lbm') {
        const state = useSimStore.getState();
        if (fluidDensityDirtyRef.current) {
          message.fluidDensity = state.lbmFluidDensity;
          fluidDensityDirtyRef.current = false;
        }
        if (windSpeedDirtyRef.current) {
          message.windSpeed = state.lbmWindSpeed;
          windSpeedDirtyRef.current = false;
        }
      }

      if (transfers.length > 0) {
        worker.worker.postMessage(message, { transfer: transfers });
      } else {
        worker.worker.postMessage(message);
      }
      return true;
    },
    [],
  );

  const cancelLiveWorker = useCallback(() => {
    pendingObstacleRef.current = null;
    flowParamsDirtyRef.current = false;
    displayModeDirtyRef.current = false;
    fluidDensityDirtyRef.current = false;
    windSpeedDirtyRef.current = false;
    liveWorkerBusyRef.current = false;
    if (liveWorkerRef.current) {
      terminateLiveWorker(liveWorkerRef.current);
      liveWorkerRef.current = null;
    }
  }, []);

  const applyLiveFrame = useCallback(
    (msg: LiveFrameMessage) => {
      const canvas = canvasRef.current;
      const obstacle = obstacleRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !obstacle || !ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const viewW = canvas.clientWidth;
      const viewH = canvas.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      blitLiveFrame(ctx, msg, nx, ny, viewW, viewH);

      if (msg.metric) {
        metricRef.current = msg.metric;
        syncHoverReadoutRef.current();
      }

      if (msg.tunnelCd !== undefined) {
        reportTunnelCd(msg.tunnelCd);
      }

      const state = useSimStore.getState();
      if (state.lbmPhysicsMode === 'euler') {
        setEulerLegendRange({ vmin: msg.vmin, vmax: msg.vmax });
        if (typeof msg.stepIndex === 'number') {
          liveHudRef.current.stepIndex = msg.stepIndex;
          frameRef.current = msg.stepIndex;
        }
        if (typeof msg.progress === 'number') {
          liveHudRef.current.progress = msg.progress;
        }
        if (typeof msg.simTimeS === 'number') {
          liveSimTimeSRef.current = msg.simTimeS;
          updateLiveTimeDisplay();
        }
        syncLiveHudToStore();
      } else if (state.lbmPhysicsMode === 'lbm' && state.lbmRunMode === 'live' && msg.didStep) {
        const now = performance.now();
        if (lbmLastFrameCompleteRef.current > 0) {
          lbmFrameIntervalsRef.current = pushLbmFrameInterval(
            lbmFrameIntervalsRef.current,
            now - lbmLastFrameCompleteRef.current,
          );
        }
        lbmLastFrameCompleteRef.current = now;

        frameRef.current += 1;
        liveSimMsRef.current = liveSimTimeMsFromFrames(frameRef.current);
        liveHudRef.current.stepIndex = frameRef.current;
        updateLiveTimeDisplay();
        syncLiveHudToStore();
      } else if (msg.tunnelCd !== undefined) {
        syncLiveHudToStore();
      }

      flushPendingObstacleRef.current();
      postFlowParamsToLiveWorkerRef.current();
      postDisplayModeToLiveWorkerRef.current();
      postFluidDensityToLiveWorkerRef.current();
      postWindSpeedToLiveWorkerRef.current();
    },
    [nx, ny, syncLiveHudToStore, updateLiveTimeDisplay, reportTunnelCd],
  );

  const flushPendingObstacleRef = useRef(flushPendingObstacle);
  flushPendingObstacleRef.current = flushPendingObstacle;
  const postFlowParamsToLiveWorkerRef = useRef(postFlowParamsToLiveWorker);
  postFlowParamsToLiveWorkerRef.current = postFlowParamsToLiveWorker;
  const postDisplayModeToLiveWorkerRef = useRef(postDisplayModeToLiveWorker);
  postDisplayModeToLiveWorkerRef.current = postDisplayModeToLiveWorker;
  const postFluidDensityToLiveWorkerRef = useRef(postFluidDensityToLiveWorker);
  postFluidDensityToLiveWorkerRef.current = postFluidDensityToLiveWorker;
  const postWindSpeedToLiveWorkerRef = useRef(postWindSpeedToLiveWorker);
  postWindSpeedToLiveWorkerRef.current = postWindSpeedToLiveWorker;

  const scheduleInteractionPaint = useCallback(() => {
    if (dragPaintRafRef.current) return;
    dragPaintRafRef.current = requestAnimationFrame(() => {
      dragPaintRafRef.current = 0;
      paintCurrentRef.current();
      const worker = liveWorkerRef.current;
      if (!worker || liveWorkerBusyRef.current) return;
      const { lbmPhysicsMode, eulerRunMode, lbmRunMode } = useSimStore.getState();
      const isLive =
        (lbmPhysicsMode === 'lbm' && lbmRunMode === 'live') ||
        (lbmPhysicsMode === 'euler' && eulerRunMode === 'live');
      if (!isLive) return;
      liveWorkerBusyRef.current = true;
      worker.worker.postMessage({ type: 'paint' });
    });
  }, []);

  const accumulateLiveWallMs = useCallback((now: number): boolean => {
    if (liveWallLastRef.current === 0) {
      liveWallLastRef.current = now;
      return false;
    }
    const dt = Math.min(now - liveWallLastRef.current, 100);
    liveWallLastRef.current = now;
    liveWallMsRef.current += dt;
    return true;
  }, []);

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
    return buildObstacleData(nx, ny, specs);
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

      const range = renderTunnelFrame(
        ctx,
        {
          metric,
          obstacle,
          nx,
          ny,
          displayMode: lbmDisplayMode,
          physicsMode: lbmPhysicsMode,
          windSpeed: lbmWindSpeed,
          fluidDensity: lbmFluidDensity,
          eulerMach: lbmEulerMach,
          eulerAltitude: lbmEulerAltitude,
          highlightMask: hoverMaskRef.current,
        },
        viewW,
        viewH,
        getOffscreen(),
      );
      if (lbmPhysicsMode === 'euler') {
        setEulerLegendRange(range);
      }

      metricRef.current = metric;
      syncHoverReadoutRef.current();
    },
    [nx, ny, getOffscreen],
  );

  const syncHoverReadout = useCallback(() => {
    const grid = hoverGridRef.current;
    const metric = metricRef.current;
    const obstacle = obstacleRef.current;
    const { lbmDisplayMode, lbmPhysicsMode } = useSimStore.getState();
    const label = lbmDisplayModeLabel(lbmDisplayMode);
    if (!grid || !metric || !obstacle) {
      // Keep the last stable readout while a fresh metric frame is pending.
      return;
    }

    const idx = grid.gx * ny + grid.gy;
    if (idx < 0 || idx >= metric.length) {
      return;
    }

    if (obstacle[idx]) {
      const obstacleText = `${label}: Obstacle`;
      if (obstacleText !== hoverReadoutCacheRef.current) {
        hoverReadoutCacheRef.current = obstacleText;
        setHoverReadout(obstacleText);
      }
      return;
    }

    const value = metric[idx];
    if (!Number.isFinite(value)) {
      // Skip transient invalid samples instead of replacing with misleading placeholders.
      return;
    }

    const next = `${label}: ${formatLbmLegendValue(lbmDisplayMode, value, lbmPhysicsMode)} · (${grid.gx}, ${grid.gy})`;

    if (next === hoverReadoutCacheRef.current) return;
    hoverReadoutCacheRef.current = next;
    setHoverReadout(next);
  }, [ny]);

  const syncHoverReadoutRef = useRef(syncHoverReadout);
  syncHoverReadoutRef.current = syncHoverReadout;

  const applyHoverProbe = useCallback(
    (msg: LiveProbeMessage) => {
      const grid = hoverGridRef.current;
      if (!grid || grid.gx !== msg.gx || grid.gy !== msg.gy) return;

      const { lbmDisplayMode, lbmPhysicsMode } = useSimStore.getState();
      const label = lbmDisplayModeLabel(lbmDisplayMode);

      if (msg.obstacle) {
        const obstacleText = `${label}: Obstacle`;
        if (obstacleText === hoverReadoutCacheRef.current) return;
        hoverReadoutCacheRef.current = obstacleText;
        setHoverReadout(obstacleText);
        return;
      }

      if (typeof msg.value !== 'number' || !Number.isFinite(msg.value)) return;

      const next = `${label}: ${formatLbmLegendValue(lbmDisplayMode, msg.value, lbmPhysicsMode)} · (${msg.gx}, ${msg.gy})`;
      if (next === hoverReadoutCacheRef.current) return;
      hoverReadoutCacheRef.current = next;
      setHoverReadout(next);
    },
    [],
  );

  const applyHoverProbeRef = useRef(applyHoverProbe);
  applyHoverProbeRef.current = applyHoverProbe;

  const requestHoverProbe = useCallback((gx: number, gy: number) => {
    const worker = liveWorkerRef.current?.worker;
    if (!worker) return;
    worker.postMessage({ type: 'probe', gx, gy });
  }, []);

  const updateHoverProbe = useCallback(
    (clientX: number, clientY: number) => {
      const surface = wrapRef.current;
      if (!surface) return;
      const grid = screenToGrid(clientX, clientY, surface, nx, ny, fitDrawRect);
      if (!grid) {
        hoverGridRef.current = null;
        if (hoverReadoutCacheRef.current !== null) {
          hoverReadoutCacheRef.current = null;
          setHoverReadout(null);
        }
        return;
      }
      hoverGridRef.current = grid;

      const obstacle = obstacleRef.current;
      const idx = grid.gx * ny + grid.gy;
      if (obstacle && idx >= 0 && idx < obstacle.length && obstacle[idx]) {
        syncHoverReadout();
        return;
      }

      const state = useSimStore.getState();
      const isLive =
        (state.lbmPhysicsMode === 'lbm' && state.lbmRunMode === 'live') ||
        (state.lbmPhysicsMode === 'euler' && state.eulerRunMode === 'live');

      if (isLive && !shouldTransferLiveMetric(nx, ny)) {
        requestHoverProbe(grid.gx, grid.gy);
        return;
      }

      syncHoverReadout();
    },
    [nx, ny, requestHoverProbe, syncHoverReadout],
  );

  const clearHoverProbe = useCallback(() => {
    hoverGridRef.current = null;
    if (hoverReadoutCacheRef.current !== null) {
      hoverReadoutCacheRef.current = null;
      setHoverReadout(null);
    }
  }, []);

  const paintMetricRef = useRef(paintMetric);
  paintMetricRef.current = paintMetric;

  const paintImmediatePreview = useCallback(() => {
    const obstacle = obstacleRef.current;
    if (!obstacle) return;

    const state = useSimStore.getState();
    let metric = metricRef.current;
    if (!metric || metric.length !== obstacle.length) {
      if (state.lbmPhysicsMode === 'euler' && eulerResultRef.current) {
        metric = getEulerTunnelMetric(eulerResultRef.current, state.lbmDisplayMode);
      } else if (
        state.lbmPhysicsMode === 'lbm' &&
        state.lbmRunMode === 'prerender' &&
        prerenderRef.current
      ) {
        metric = getPrerenderFrame(
          prerenderRef.current,
          frameRef.current,
          lbmLatticeField(state.lbmDisplayMode),
          state.lbmFluidDensity,
          state.lbmWindSpeed,
        );
      } else {
        metric = freestreamPreviewMetric(
          nx,
          ny,
          state.lbmDisplayMode,
          state.lbmPhysicsMode,
          state.lbmWindSpeed,
          state.lbmFluidDensity,
          state.lbmEulerMach,
          state.lbmEulerAltitude,
        );
      }
    }
    paintMetric(metric);
  }, [nx, ny, paintMetric]);

  const paintImmediatePreviewRef = useRef(paintImmediatePreview);
  paintImmediatePreviewRef.current = paintImmediatePreview;

  const paintCurrent = useCallback(() => {
    const {
      lbmPhysicsMode,
      lbmRunMode,
      lbmDisplayMode,
      lbmFluidDensity,
      lbmWindSpeed,
    } = useSimStore.getState();

    if (lbmPhysicsMode === 'euler') {
      const { eulerRunMode } = useSimStore.getState();
      if (eulerRunMode === 'live') {
        // Keep interaction responsive even while the live worker is busy:
        // redraw immediately with the latest available metric + updated obstacle.
        if (metricRef.current) {
          paintMetric(metricRef.current);
        }
        displayModeDirtyRef.current = true;
        postDisplayModeToLiveWorker();
        return;
      }
      const result = eulerResultRef.current;
      if (!result) return;
      paintMetric(getEulerTunnelMetric(result, lbmDisplayMode));
      const obstacle = obstacleRef.current;
      if (obstacle) {
        reportTunnelCd(computeDragFromEulerResult(result, obstacle)?.cd ?? null);
      }
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
      refreshLbmCdFromPrerender(frameRef.current);
      return;
    }

    const worker = liveWorkerRef.current;
    if (worker && lbmRunMode === 'live') {
      // Keep interaction responsive even while the live worker is busy:
      // redraw immediately with the latest available metric + updated obstacle.
      if (metricRef.current) {
        paintMetric(metricRef.current);
      }
      displayModeDirtyRef.current = true;
      postDisplayModeToLiveWorker();
      return;
    }
  }, [paintMetric, postDisplayModeToLiveWorker, refreshLbmCdFromPrerender, reportTunnelCd]);

  const paintCurrentRef = useRef(paintCurrent);
  paintCurrentRef.current = paintCurrent;

  useEffect(() => {
    syncHoverReadout();
  }, [lbmDisplayMode, syncHoverReadout]);

  useEffect(() => {
    if (!lbmPlaying) {
      liveWallLastRef.current = 0;
      lastTickRef.current = 0;
    }
  }, [lbmPlaying]);

  const rebuildObstacleVisual = useCallback(() => {
    const { obstacle: newMask, obstacleSlip: newSlip } = buildObstacle();
    let obstacle = obstacleRef.current;
    if (!obstacle || obstacle.length !== newMask.length) {
      obstacle = new Uint8Array(newMask);
      obstacleRef.current = obstacle;
    } else {
      obstacle.set(newMask);
    }
    let obstacleSlip = obstacleSlipRef.current;
    if (!obstacleSlip || obstacleSlip.length !== newSlip.length) {
      obstacleSlip = new Uint8Array(newSlip);
      obstacleSlipRef.current = obstacleSlip;
    } else {
      obstacleSlip.set(newSlip);
    }

    const worker = liveWorkerRef.current;
    const { lbmPhysicsMode, eulerRunMode, lbmRunMode } = useSimStore.getState();
    const isLive =
      (lbmPhysicsMode === 'euler' && eulerRunMode === 'live') ||
      (lbmPhysicsMode === 'lbm' && lbmRunMode === 'live' && worker);
    if (isLive) {
      if (dragRef.current || drawRef.current) {
        obstacleDirtyRef.current = true;
      } else {
        postObstacleToLiveWorker(obstacle, obstacleSlip);
      }
    }

    paintImmediatePreviewRef.current();

    return obstacle;
  }, [buildObstacle, postObstacleToLiveWorker]);

  const attachLiveWorker = useCallback(
    (kind: 'lbm' | 'euler', worker: Worker, generation: number) => {
      worker.onmessage = (e: MessageEvent) => {
        const handle = liveWorkerRef.current;
        if (!handle || handle.generation !== generation) return;

        if (e.data.type === 'probe') {
          applyHoverProbeRef.current(e.data as LiveProbeMessage);
          return;
        }

        liveWorkerBusyRef.current = false;

        if (e.data.type === 'frame') {
          applyLiveFrame(e.data as LiveFrameMessage);
        }
      };
      worker.onerror = (err) => {
        liveWorkerBusyRef.current = false;
        console.error('Live simulation worker failed:', err);
      };
      liveWorkerRef.current = { kind, worker, busy: false, generation };
    },
    [applyLiveFrame],
  );

  const resetLiveSimulation = useCallback(() => {
    cancelLiveWorker();
    const shapes = useSimStore.getState().lbmShapes;
    const specs = scaleShapeSpecs(
      shapes.map(lbmInputToSpec),
      lbmResolutionScale,
    );
    const obstacle = buildObstacleMask(nx, ny, specs);
    obstacleRef.current = obstacle;
    obstacleSlipRef.current = new Uint8Array(obstacle.length);
    const obstacleCopy = obstacle.slice();
    const state = useSimStore.getState();
    const generation = Date.now();
    const worker = createLiveWorker('lbm');
    attachLiveWorker('lbm', worker, generation);
    liveWorkerBusyRef.current = true;
    frameRef.current = 0;
    resetLiveTiming();
    setLbmFrameIndex(0);
    worker.postMessage(
      {
        type: 'init',
        nx,
        ny,
        renderStep,
        displayMode: state.lbmDisplayMode,
        windSpeed: state.lbmWindSpeed,
        fluidDensity: state.lbmFluidDensity,
        obstacle: obstacleCopy.buffer,
      },
      [obstacleCopy.buffer],
    );
  }, [
    attachLiveWorker,
    cancelLiveWorker,
    nx,
    ny,
    lbmResolutionScale,
    renderStep,
    resetLiveTiming,
    setLbmFrameIndex,
  ]);

  const cancelEulerRun = useCallback(() => {
    eulerRunIdRef.current += 1;
    if (eulerWorkerRef.current) {
      eulerWorkerRef.current.postMessage({ type: 'cancel' });
      eulerWorkerRef.current.terminate();
      eulerWorkerRef.current = null;
    }
  }, []);

  const startEulerRun = useCallback(() => {
    cancelEulerRun();

    const runId = ++eulerRunIdRef.current;
    const { obstacle, obstacleSlip } = buildObstacle();
    obstacleRef.current = obstacle;
    obstacleSlipRef.current = obstacleSlip;
    const obstacleCopy = new Uint8Array(obstacle);
    const obstacleSlipCopy = new Uint8Array(obstacleSlip);
    const {
      lbmEulerMach,
      lbmEulerAltitude,
      eulerSolverScheme,
      eulerSpatialOrder,
      eulerWallMode,
    } = useSimStore.getState();

    setEulerTunnelState({ status: 'running', progress: 0, cd: null });
    reportTunnelCd(null);
    setEulerBackend(null);

    const worker = new Worker(
      new URL('../workers/eulerTunnel.worker.ts', import.meta.url),
      { type: 'module' },
    );
    eulerWorkerRef.current = worker;

    const isCurrentRun = () => runId === eulerRunIdRef.current;

    worker.onmessage = (e: MessageEvent) => {
      if (!isCurrentRun()) return;
      const data = e.data;
      if (data.type === 'progress') {
        setEulerTunnelState({ progress: data.progress });
        if (data.backend) setEulerBackend(data.backend);
      } else if (data.type === 'complete') {
        eulerResultRef.current = {
          nx: data.nx,
          ny: data.ny,
          mach: data.mach,
          altitude: data.altitude,
          velocity: data.velocity,
          machField: data.machField,
          pressure: data.pressure,
          temperature: data.temperature,
        };
        const obstacle = obstacleRef.current;
        const drag =
          obstacle && eulerResultRef.current
            ? computeDragFromEulerResult(eulerResultRef.current, obstacle)
            : null;
        lastTunnelCdRef.current = drag?.cd ?? null;
        reportTunnelCd(lastTunnelCdRef.current);
        setEulerTunnelState({ status: 'ready', progress: 1, cd: drag?.cd ?? null });
        if (data.backend) setEulerBackend(data.backend);
        paintMetricRef.current(
          getEulerTunnelMetric(eulerResultRef.current, useSimStore.getState().lbmDisplayMode),
        );
        worker.terminate();
        if (eulerWorkerRef.current === worker) {
          eulerWorkerRef.current = null;
        }
      } else if (data.type === 'error') {
        console.error('Euler worker error:', data.error);
        setEulerTunnelState({ status: 'error', progress: 0 });
        worker.terminate();
        if (eulerWorkerRef.current === worker) {
          eulerWorkerRef.current = null;
        }
      } else if (data.type === 'cancelled') {
        if (eulerWorkerRef.current === worker) {
          setEulerTunnelState({ status: 'cancelled', progress: 0 });
        }
        worker.terminate();
        if (eulerWorkerRef.current === worker) {
          eulerWorkerRef.current = null;
        }
      }
    };

    worker.onerror = () => {
      if (!isCurrentRun()) return;
      setEulerTunnelState({ status: 'error', progress: 0 });
      worker.terminate();
      if (eulerWorkerRef.current === worker) {
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
        scheme: eulerSolverScheme,
        spatialOrder: eulerSpatialOrder,
        wallMode: eulerWallMode,
        obstacle: obstacleCopy.buffer,
        obstacleSlip: obstacleSlipCopy.buffer,
      },
      [obstacleCopy.buffer, obstacleSlipCopy.buffer],
    );
  }, [buildObstacle, cancelEulerRun, nx, ny, setEulerTunnelState]);

  const initEulerLive = useCallback(() => {
    cancelEulerRun();
    cancelLiveWorker();
    const { obstacle, obstacleSlip } = buildObstacle();
    obstacleRef.current = obstacle;
    obstacleSlipRef.current = obstacleSlip;
    const obstacleCopy = obstacle.slice();
    const obstacleSlipCopy = obstacleSlip.slice();
    const state = useSimStore.getState();
    const generation = Date.now();
    const worker = createLiveWorker('euler');
    attachLiveWorker('euler', worker, generation);
    liveWorkerBusyRef.current = true;
    frameRef.current = 0;
    resetLiveTiming();
    setLbmFrameIndex(0);
    setEulerTunnelState({ status: 'running', progress: 0, cd: null });
    reportTunnelCd(null);
    setLbmPlaying(true);
    worker.postMessage(
      {
        type: 'init',
        nx,
        ny,
        mach: state.lbmEulerMach,
        altitude: state.lbmEulerAltitude,
        scheme: state.eulerSolverScheme,
        spatialOrder: state.eulerSpatialOrder,
        wallMode: state.eulerWallMode,
        displayMode: state.lbmDisplayMode,
        windSpeed: state.lbmWindSpeed,
        fluidDensity: state.lbmFluidDensity,
        obstacle: obstacleCopy.buffer,
        obstacleSlip: obstacleSlipCopy.buffer,
      },
      [obstacleCopy.buffer, obstacleSlipCopy.buffer],
    );
  }, [
    attachLiveWorker,
    buildObstacle,
    cancelEulerRun,
    cancelLiveWorker,
    nx,
    ny,
    resetLiveTiming,
    setEulerTunnelState,
    setLbmFrameIndex,
    setLbmPlaying,
  ]);

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
    const { obstacle, obstacleSlip } = buildObstacle();
    obstacleRef.current = obstacle;
    obstacleSlipRef.current = obstacleSlip;
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
  const initEulerLiveRef = useRef(initEulerLive);
  initEulerLiveRef.current = initEulerLive;
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
    if (lbmPhysicsMode !== 'euler' || eulerRunMode !== 'live') return;
    flowParamsDirtyRef.current = true;
    postFlowParamsToLiveWorker();
    syncLiveHudToStore(true);
  }, [eulerFlowRevision, lbmPhysicsMode, eulerRunMode, postFlowParamsToLiveWorker, syncLiveHudToStore]);

  useEffect(() => {
    const state = useSimStore.getState();
    const isLive =
      (state.lbmPhysicsMode === 'lbm' && state.lbmRunMode === 'live') ||
      (state.lbmPhysicsMode === 'euler' && state.eulerRunMode === 'live');
    if (isLive) {
      displayModeDirtyRef.current = true;
      postDisplayModeToLiveWorker();
      return;
    }
    paintCurrentRef.current();
  }, [lbmDisplayMode, postDisplayModeToLiveWorker]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm' || lbmRunMode !== 'live') return;
    fluidDensityDirtyRef.current = true;
    postFluidDensityToLiveWorker();
  }, [lbmFluidDensity, lbmPhysicsMode, lbmRunMode, postFluidDensityToLiveWorker]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm' || lbmRunMode !== 'live') return;
    windSpeedDirtyRef.current = true;
    postWindSpeedToLiveWorker();
  }, [lbmWindSpeed, lbmPhysicsMode, lbmRunMode, postWindSpeedToLiveWorker]);

  useEffect(() => () => cancelLiveWorker(), [cancelLiveWorker]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm' || lbmRunMode === 'prerender') return;
    resetLiveSimulation();
    setLbmPlaying(true);
  }, [lbmPhysicsMode, lbmRunMode, lbmSeed, resetLiveSimulation, setLbmPlaying, lbmTunnelNx, lbmTunnelNy]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'euler') return;
    if (eulerRunMode === 'steady') {
      startEulerRunRef.current();
      return () => cancelEulerRun();
    }
    initEulerLiveRef.current();
    return () => {
      cancelLiveWorker();
    };
  }, [
    lbmPhysicsMode,
    eulerRunMode,
    eulerTunnelSeed,
    lbmResolutionScale,
    lbmTunnelNx,
    lbmTunnelNy,
    nx,
    ny,
    cancelEulerRun,
    cancelLiveWorker,
  ]);

  useEffect(() => {
    updateHoverHighlight(hoveredLbmShapeId);
    rebuildObstacleVisual();
    scheduleInteractionPaint();
  }, [hoveredLbmShapeId, lbmShapes, lbmResolutionScale, updateHoverHighlight, rebuildObstacleVisual, scheduleInteractionPaint]);

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
      refreshLbmCdFromPrerender(lbmFrameIndex);
    }
  }, [
    lbmFrameIndex,
    lbmPhysicsMode,
    lbmRunMode,
    lbmPrerenderStatus,
    lbmPlaying,
    lbmFluidDensity,
    lbmWindSpeed,
    refreshLbmCdFromPrerender,
  ]);

  useEffect(() => {
    if (lbmPhysicsMode !== 'lbm' || lbmRunMode !== 'prerender' || lbmPrerenderStatus !== 'ready' || !prerenderRef.current) return;
    frameRef.current = 0;
    setLbmFrameIndex(0);
    paintCurrent();
  }, [lbmPhysicsMode, lbmRewind, lbmRunMode, lbmPrerenderStatus, paintCurrent, setLbmFrameIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = wrapRef.current;
    if (!canvas || !parent) return;

    const resize = () => {
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
      paintCurrent();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [paintCurrent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);

      const state = useSimStore.getState();
      if (state.lbmPhysicsMode === 'euler' && state.eulerRunMode === 'live') {
        if (!state.lbmPlaying) return;
        if (!accumulateLiveWallMs(now)) return;

        updateLiveTimeDisplay();

        if (interactionBusyRef.current || liveWorkerBusyRef.current) return;

        if (now - lastTickRef.current < EULER_FRAME_MS) {
          updateLiveTimeDisplay();
          return;
        }
        lastTickRef.current = now;

        requestLiveStep({ count: eulerLiveStepsPerFrame(nx, ny) });
        return;
      }

      if (state.lbmPhysicsMode !== 'lbm') return;
      if (!state.lbmPlaying) return;
      if (lbmRunMode === 'prerender' && lbmPrerenderStatus !== 'ready') return;

      if (lbmRunMode === 'live') {
        if (!accumulateLiveWallMs(now)) return;

        if (now - lastTickRef.current < LBM_FRAME_MS) {
          updateLiveTimeDisplay();
          return;
        }
        lastTickRef.current = now;

        if (interactionBusyRef.current || liveWorkerBusyRef.current) {
          updateLiveTimeDisplay();
          return;
        }

        requestLiveStep({ renderStep });
        return;
      }

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
    nx,
    ny,
    setLbmFrameIndex,
    accumulateLiveWallMs,
    updateLiveTimeDisplay,
    syncLiveHudToStore,
    requestLiveStep,
  ]);

  const showSolverPlaceholder =
    !isDragging &&
    !isDrawing &&
    ((lbmPhysicsMode === 'lbm' &&
      lbmRunMode === 'prerender' &&
      lbmPrerenderStatus !== 'ready') ||
      (lbmPhysicsMode === 'euler' &&
        eulerRunMode === 'steady' &&
        eulerTunnelStatus !== 'ready'));

  const updateBrushPreview = useCallback(
    (clientX: number, clientY: number) => {
      const surface = wrapRef.current;
      if (!surface || !isBrushToolMode(useSimStore.getState().lbmInteractionMode)) {
        setBrushPreview(null);
        return;
      }

      setBrushPreview(
        brushScreenCircle(
          clientX,
          clientY,
          surface,
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
    if (!isBrushToolMode(lbmInteractionMode)) {
      setBrushPreview(null);
    }
  }, [lbmInteractionMode]);

  useEffect(() => {
    setBrushPreview(null);
  }, [lbmBrushRadius, lbmResolutionScale, nx, ny]);

  const applyDragAt = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      const surface = wrapRef.current;
      if (!drag || !surface) return;

      const grid = screenToGrid(clientX, clientY, surface, nx, ny, fitDrawRect);
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
      paintImmediatePreviewRef.current();
    },
    [
      lbmResolutionScale,
      nx,
      ny,
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
    if (obstacleDirtyRef.current && obstacleRef.current) {
      postObstacleToLiveWorker(obstacleRef.current, obstacleSlipRef.current);
    }
    if (drag.wasPlaying) {
      setLbmPlaying(true);
    }
  }, [commitLbmShapeLayout, postObstacleToLiveWorker, setLbmPlaying]);

  const syncDrawStroke = useCallback(
    (draw: NonNullable<typeof drawRef.current>) => {
      if (!draw.shapeId || !draw.stencilKeys) return;
      const { stencilX, stencilY } = stencilArraysFromKeys(draw.stencilKeys);
      updateLbmShapeStencil(draw.shapeId, stencilX, stencilY);
      rebuildObstacleVisual();
    },
    [rebuildObstacleVisual, updateLbmShapeStencil],
  );

  const applyDrawAt = useCallback(
    (clientX: number, clientY: number, startStroke: boolean) => {
      const surface = wrapRef.current;
      const canvas = canvasRef.current;
      if (!surface || !canvas) return;

      const grid = screenToGrid(clientX, clientY, surface, nx, ny, fitDrawRect);
      if (!grid) return;

      const lx = grid.gx / lbmResolutionScale;
      const ly = grid.gy / lbmResolutionScale;
      const wasPlaying = useSimStore.getState().lbmPlaying;
      const runMode = useSimStore.getState().lbmRunMode;
      const interactionMode = useSimStore.getState().lbmInteractionMode;
      const isErasing = interactionMode === 'erase';
      if (runMode !== 'live') {
        setLbmPlaying(false);
      }

      const previousPoint =
        startStroke || !drawRef.current
          ? null
          : { lx: drawRef.current.lastLx, ly: drawRef.current.lastLy };
      const points = strokeLogicalPoints(previousPoint, { lx, ly });

      if (isErasing) {
        drawRef.current = {
          mode: 'decrease',
          lastLx: lx,
          lastLy: ly,
          wasPlaying,
        };
        setIsDrawing(true);
        for (const point of points) {
          applyLbmEraseBrush(point.lx, point.ly, lbmBrushRadius);
        }
        rebuildObstacleVisual();
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

        addLbmShape({
          id: shapeId,
          type: 'custom',
          customSource: 'drawn',
          name: `Drawn ${drawnCount + 1}`,
          cx,
          cy,
          aoa: 0,
          slipWall: false,
          customScale: 1,
          ...stencilArraysFromKeys(stencilKeys),
        });
        setSelectedLbmShapeId(shapeId);
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
    ],
  );

  const endDraw = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;

    drawRef.current = null;
    setIsDrawing(false);
    commitLbmShapeLayout();
    if (obstacleDirtyRef.current && obstacleRef.current) {
      postObstacleToLiveWorker(obstacleRef.current, obstacleSlipRef.current);
      obstacleDirtyRef.current = false;
    }
    if (draw.wasPlaying) {
      setLbmPlaying(true);
    }
  }, [commitLbmShapeLayout, postObstacleToLiveWorker, setLbmPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = wrapRef.current;
    if (!canvas || !surface || showSolverPlaceholder) return;

    const onPointerDown = (e: PointerEvent) => {
      const grid = screenToGrid(e.clientX, e.clientY, surface, nx, ny, fitDrawRect);
      if (!grid) return;

      if (isBrushToolMode(useSimStore.getState().lbmInteractionMode)) {
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
      if (isBrushToolMode(useSimStore.getState().lbmInteractionMode)) {
        updateBrushPreview(e.clientX, e.clientY);
        updateHoverProbe(e.clientX, e.clientY);
        if (drawRef.current) {
          applyDrawAt(e.clientX, e.clientY, false);
        }
        return;
      }

      if (dragRef.current) {
        updateHoverProbe(e.clientX, e.clientY);
        applyDragAt(e.clientX, e.clientY);
        return;
      }

      updateHoverProbe(e.clientX, e.clientY);

      const grid = screenToGrid(e.clientX, e.clientY, surface, nx, ny, fitDrawRect);
      if (!grid) {
        setCanvasHoverShapeId(null);
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
      setCanvasHoverShapeId(shape?.id ?? null);
    };

    const onPointerLeave = () => {
      setBrushPreview(null);
      if (!dragRef.current && !drawRef.current) {
        setCanvasHoverShapeId(null);
        clearHoverProbe();
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
    updateHoverProbe,
    clearHoverProbe,
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
        <div className="lbm-title-primary">
          <span>
            Flow Visualiser | {lbmPhysicsModeLabel(lbmPhysicsMode)} |{' '}
            {lbmDisplayModeLabel(lbmDisplayMode)}
            {lbmPhysicsMode === 'euler' && ' · Inviscid Euler — educational'}
          </span>
          <span className="lbm-title-metric" title="Drag coefficient from simulated surface pressure">
            Cd <span ref={titleCdRef} className="lbm-title-cd" />
          </span>
          {((lbmPhysicsMode === 'lbm' && lbmRunMode === 'live') ||
            (lbmPhysicsMode === 'euler' && eulerRunMode === 'live')) && (
            <span className="lbm-title-metric">
              Sim time:{' '}
              <span className="lbm-title-time-wrap">
                <span ref={titleTimeRef} className="lbm-title-time" />
                <span ref={titleRealTimeRef} className="lbm-title-realtime" hidden>
                  {' '}
                  · real time
                </span>
              </span>
            </span>
          )}
          {lbmPhysicsMode === 'lbm' && lbmRunMode === 'prerender' && (
            <span className="lbm-title-metric">
              Time: {lbmElapsedSec.toFixed(1)}s / {lbmPlaybackSeconds.toFixed(1)}s
            </span>
          )}
        </div>
        <span className="lbm-grid-label">
          {nx} × {ny} grid · {lbmShapes.length} obstacle{lbmShapes.length === 1 ? '' : 's'}
          {lbmPhysicsMode === 'lbm' && <> · {lbmRunModeLabel(lbmRunMode)}</>}
          {lbmPhysicsMode === 'euler' && (
            <> · {eulerRunModeLabel(eulerRunMode)} · Ma {lbmEulerMach.toFixed(2)} · {lbmEulerAltitude} m</>
          )}
        </span>
      </div>

      <div className="lbm-stage">
      <div
        ref={wrapRef}
        className="lbm-canvas-wrap"
        style={{ aspectRatio: `${nx} / ${ny}` }}
      >
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
                    : eulerBackend === 'gpu'
                      ? 'Computing inviscid flow on GPU (WebGPU).'
                      : eulerBackend === 'wasm'
                        ? 'Computing inviscid flow with WASM SIMD.'
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
        {lbmShowTunnelDims && !showSolverPlaceholder && (
          <>
            <span className="lbm-tunnel-dim lbm-tunnel-dim-length" aria-hidden>
              <span className="lbm-tunnel-dim-value">← {tunnelDims.lengthM.toFixed(1)} m →</span>
              <span className="lbm-tunnel-dim-axis">length</span>
            </span>
            <span className="lbm-tunnel-dim lbm-tunnel-dim-height" aria-hidden>
              <span className="lbm-tunnel-dim-height-stack">
                <span className="lbm-tunnel-dim-arrow">↑</span>
                <span className="lbm-tunnel-dim-value lbm-tunnel-dim-value-vertical">
                  {tunnelDims.heightM.toFixed(1)} m
                </span>
                <span className="lbm-tunnel-dim-arrow">↓</span>
              </span>
              <span className="lbm-tunnel-dim-axis lbm-tunnel-dim-axis-vertical">height</span>
            </span>
          </>
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
              : lbmInteractionMode === 'erase'
                ? 'lbm-canvas-erase'
                : lbmInteractionMode === 'draw'
                  ? 'lbm-canvas-draw'
                  : isDragging
                  ? 'lbm-canvas-dragging'
                  : canvasHoverShapeId
                    ? 'lbm-canvas-grab'
                    : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {brushPreview && !showSolverPlaceholder && isBrushToolMode(lbmInteractionMode) && (
          <div className="lbm-brush-overlay" aria-hidden>
            <div
              className={
                lbmInteractionMode === 'erase'
                  ? 'lbm-brush-circle erase'
                  : 'lbm-brush-circle'
              }
              style={{
                left: `${brushPreview.cx - brushPreview.r}px`,
                top: `${brushPreview.cy - brushPreview.r}px`,
                width: `${brushPreview.r * 2}px`,
                height: `${brushPreview.r * 2}px`,
              }}
            />
          </div>
        )}
      </div>
      </div>
      {!showSolverPlaceholder && (
        <p className="lbm-hover-readout" aria-live="polite">
          {hoverReadout ?? '\u00a0'}
        </p>
      )}
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
          {lbmInteractionMode === 'erase'
            ? 'Drag on the canvas to erase painted obstacles'
            : lbmInteractionMode === 'draw'
              ? 'Click and drag on the canvas to paint obstacles'
              : 'Click and drag shapes to move them'}
        </p>
      )}
    </div>
  );
}
