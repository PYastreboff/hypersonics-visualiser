import type { Euler, Vector3 } from 'three';

export type FlowRegime = 'subsonic' | 'transonic' | 'supersonic' | 'hypersonic';

export type ShapeKind =
  | 'sphere'
  | 'cone'
  | 'wedge'
  | 'cylinder'
  | 'flatPlate'
  | 'biconic'
  | 'ogive'
  | 'aerofoil'
  | 'custom';

export type WallThermalBC = 'adiabatic' | 'isothermal';

export type SimMode = 'preview' | 'highFidelity';

export type ViewMode = '3d' | 'lbm';

export type LbmDisplayMode = 'velocity' | 'pressure' | 'mach' | 'temperature';

export type LbmPhysicsMode = 'lbm' | 'euler';

export type LbmRunMode = 'live' | 'prerender';

export type LbmPrerenderStatus = 'idle' | 'running' | 'ready' | 'error' | 'cancelled';

export type EulerRunMode = 'live' | 'steady';
export type EulerSolverScheme =
  | 'rusanov'
  | 'hll'
  | 'hllc'
  | 'roe'
  | 'ausmplus'
  | 'kt';

export type EulerSpatialOrder = 'first' | 'muscl';
export type EulerWallMode = 'reflective' | 'open';

export type EulerTunnelStatus = 'idle' | 'running' | 'ready' | 'error' | 'cancelled';

export type LbmShapeType = 'airfoil' | 'square' | 'circle' | 'doubleWedge' | 'flatPlate' | 'custom';

export type LbmInteractionMode = 'select' | 'draw' | 'erase';

export type LbmDrawDensity = 'increase' | 'decrease';

export type LbmCustomSource = 'drawn' | 'imported';

export interface LbmShapeInput {
  id: string;
  type: LbmShapeType;
  cx: number;
  cy: number;
  aoa: number;
  /** Euler-only: treat obstacle as inviscid slip wall. */
  slipWall?: boolean;
  chord?: number;
  naca?: string;
  width?: number;
  height?: number;
  radius?: number;
  name?: string;
  customSource?: LbmCustomSource;
  customScale?: number;
  stencilX?: number[];
  stencilY?: number[];
}

export type SlicePlane = 'xy' | 'xz' | 'yz';

export type TransitionState = 'laminar' | 'transitional' | 'turbulent';

export interface FlowParams {
  mach: number;
  altitude: number;
  angleOfAttack: number;
  sideslip: number;
  freeStreamTemp: number | null;
  wallThermalBC: WallThermalBC;
  wallTemp: number;
}

export interface PlacedShape {
  id: string;
  kind: ShapeKind;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  params: ShapeParams;
  customGeometryUrl?: string;
}

export interface ShapeParams {
  radius?: number;
  length?: number;
  halfAngle?: number;
  wedgeAngle?: number;
  noseRadius?: number;
  rearRadius?: number;
  thickness?: number;
}

export interface ShapeMetrics {
  shapeId: string;
  name: string;
  cd: number;
  cl: number;
  cm: number;
  pressureDrag: number;
  frictionDrag: number;
  maxWallTemp: number;
  stagnationTemp: number;
  referenceArea: number;
}

export interface CombinedMetrics {
  regime: FlowRegime;
  reynolds: number;
  dynamicPressure: number;
  mach: number;
  stagnationTemp: number;
  shapes: ShapeMetrics[];
  totalCd: number;
  totalCl: number;
  interferenceFactor: number;
}

export interface FlowSample {
  velocity: Vector3;
  density: number;
  pressure: number;
  temperature: number;
  machLocal: number;
}

export interface HFRunState {
  status: 'idle' | 'running' | 'complete' | 'error' | 'cancelled';
  progress: number;
  slicePlane: SlicePlane;
  gridNx: number;
  gridNy: number;
  density?: Float32Array;
  pressure?: Float32Array;
  mach?: Float32Array;
  temperature?: Float32Array;
  error?: string;
}

export interface ShapeDefinition {
  kind: ShapeKind;
  label: string;
  defaultParams: ShapeParams;
  referenceArea: (params: ShapeParams, scale: [number, number, number]) => number;
  lengthScale: (params: ShapeParams, scale: [number, number, number]) => number;
  wettedArea: (params: ShapeParams, scale: [number, number, number]) => number;
  isBlunt: boolean;
}

export type Transform = {
  position: Vector3 | [number, number, number];
  rotation: Euler | [number, number, number];
  scale: [number, number, number];
};
