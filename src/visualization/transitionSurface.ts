import * as THREE from 'three';
import type { PlacedShape } from '@/types';
import {
  getLeadingEdgeLocal,
  shapeMatrix,
} from '@/visualization/shockMeshes';
import {
  densityAtAltitude,
  dynamicViscosity,
  speedOfSound,
  temperatureAtAltitude,
} from '@/physics/atmosphere';
import { getFlowDirection } from '@/physics/flowDirection';
import { transitionState } from '@/physics/transition';

function parseTransitionColor(state: ReturnType<typeof transitionState>): [number, number, number] {
  switch (state) {
    case 'laminar':
      return [0.29, 0.62, 1];
    case 'transitional':
      return [1, 0.84, 0.29];
    case 'turbulent':
      return [1, 0.42, 0.29];
    default:
      return [0.5, 0.5, 0.5];
  }
}

export { getLeadingEdgeLocal };

export function computeTransitionVertexColors(
  geometry: THREE.BufferGeometry,
  shape: PlacedShape,
  mach: number,
  altitude: number,
  aoaDeg: number,
  sideslipDeg: number,
  freeStreamTemp: number | null,
): Float32Array {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);

  const tempK = freeStreamTemp ?? temperatureAtAltitude(altitude);
  const rho = densityAtAltitude(altitude);
  const mu = dynamicViscosity(tempK);
  const a = speedOfSound(tempK);
  const V = mach * a;
  const flowDir = getFlowDirection(aoaDeg, sideslipDeg);

  const groupMatrix = shapeMatrix(shape);
  const leadingLocal = getLeadingEdgeLocal(shape.kind, shape.params, shape.scale);
  const leadingWorld = leadingLocal.clone().applyMatrix4(groupMatrix);
  const flowDotLeading = leadingWorld.dot(flowDir);

  for (let i = 0; i < pos.count; i++) {
    const local = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const world = local.clone().applyMatrix4(groupMatrix);
    const streamwise = Math.max(0, world.dot(flowDir) - flowDotLeading);
    const reX = (rho * V * streamwise) / mu;
    const state = transitionState(reX);
    const [r, g, b] = parseTransitionColor(state);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  return colors;
}
