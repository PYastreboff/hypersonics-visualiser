import * as THREE from 'three';
import type { PlacedShape, ShapeKind, ShapeParams } from '@/types';
import { obliqueShockAngle, bowShockStandoff } from '@/physics/shockRelations';
import { getFlowDirection } from '@/physics/flowDirection';
import {
  aerofoilThicknessAt,
  getAerofoilDimensions,
  getWedgeDimensions,
} from '@/shapes/solidGeometry';

export function shapeMatrix(shape: PlacedShape): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...shape.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...shape.rotation)),
    new THREE.Vector3(...shape.scale),
  );
}

function toWorld(local: THREE.Vector3, matrix: THREE.Matrix4): THREE.Vector3 {
  return local.clone().applyMatrix4(matrix);
}

function localAxis(matrix: THREE.Matrix4, axis: THREE.Vector3): THREE.Vector3 {
  return axis.clone().transformDirection(matrix).normalize();
}

function flowFrame(aoaDeg: number, sideslipDeg: number) {
  const flowDir = getFlowDirection(aoaDeg, sideslipDeg);
  const up = Math.abs(flowDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const perp1 = new THREE.Vector3().crossVectors(flowDir, up).normalize();
  const perp2 = new THREE.Vector3().crossVectors(flowDir, perp1).normalize();
  return { flowDir, perp1, perp2 };
}

export function getLeadingEdgeLocal(
  kind: ShapeKind,
  params: ShapeParams,
  scale: [number, number, number],
): THREE.Vector3 {
  const len = (params.length ?? 2) * scale[0];
  const r = (params.radius ?? 0.5) * Math.max(scale[1], scale[2]);

  switch (kind) {
    case 'sphere':
    case 'custom':
      return new THREE.Vector3(-r, 0, 0);
    case 'cone':
    case 'ogive':
    case 'biconic':
    case 'aerofoil':
      return new THREE.Vector3(0, 0, 0);
    case 'wedge':
      return new THREE.Vector3(-len / 2, 0, 0);
    case 'cylinder':
    case 'flatPlate':
      return new THREE.Vector3(-len / 2, 0, 0);
    default:
      return new THREE.Vector3(0, 0, 0);
  }
}

function getBodyHalfAngle(shape: PlacedShape, aoaDeg = 0): number {
  const p = shape.params;
  const s = shape.scale;

  switch (shape.kind) {
    case 'wedge':
      return ((p.wedgeAngle ?? 10) * Math.PI) / 180;
    case 'flatPlate': {
      const len = (p.length ?? 2) * s[0];
      const ht = 0.05 * s[1];
      const aoaRad = Math.abs((aoaDeg * Math.PI) / 180);
      return Math.max(aoaRad, Math.atan2(ht * 0.5, len * 0.08), 0.025);
    }
    case 'cone': {
      const r = (p.radius ?? 0.4) * Math.max(s[1], s[2]);
      const h = (p.length ?? 2) * s[0];
      return Math.atan(r / h);
    }
    case 'biconic': {
      const r = (p.radius ?? 0.35) * Math.max(s[1], s[2]);
      const h = (p.length ?? 2.5) * s[0];
      return Math.atan(r / h);
    }
    case 'aerofoil': {
      const { thicknessRatio } = getAerofoilDimensions(p, s);
      const aoaRad = Math.abs((aoaDeg * Math.PI) / 180);
      return Math.max(Math.atan(1.5 * thicknessRatio), aoaRad * 0.5, 0.04);
    }
    case 'ogive': {
      const r = (p.radius ?? 0.4) * Math.max(s[1], s[2]);
      const nr = (p.noseRadius ?? 0.15) * Math.max(s[1], s[2]);
      return nr > 0.05
        ? Math.atan(nr / ((p.length ?? 2) * s[0] * 0.15))
        : Math.atan(r / ((p.length ?? 2) * s[0]));
    }
    default:
      return ((p.halfAngle ?? 15) * Math.PI) / 180;
  }
}

function getBluntRadius(shape: PlacedShape): number {
  const p = shape.params;
  const s = shape.scale;
  switch (shape.kind) {
    case 'sphere':
    case 'custom':
      return (p.radius ?? 0.5) * Math.max(...s);
    case 'cylinder':
      return (p.radius ?? 0.3) * Math.max(s[1], s[2]);
    case 'ogive':
      return (p.noseRadius ?? 0.15) * Math.max(s[1], s[2]);
    default:
      return (p.radius ?? 0.5) * Math.max(s[1], s[2]);
  }
}

function orientShockConeLikeBody(
  geom: THREE.BufferGeometry,
  kind: ShapeKind,
  flowDir: THREE.Vector3,
  apex: THREE.Vector3,
  height: number,
) {
  // Match solid mesh frame in geometry.ts: tip at origin, surface runs downstream (+X local)
  if (kind === 'biconic') {
    geom.rotateZ(-Math.PI / 2);
  } else {
    geom.rotateZ(Math.PI / 2);
  }
  geom.translate(height / 2, 0, 0);

  const flowQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(1, 0, 0),
    flowDir.clone().normalize(),
  );
  geom.applyQuaternion(flowQuat);
  geom.translate(apex.x, apex.y, apex.z);
}

/** Closed 3D shock slab spanning edgeA→edgeB at leading edge, extending downstream. */
function createShockSlab3D(
  edgeA: THREE.Vector3,
  edgeB: THREE.Vector3,
  shockDir: THREE.Vector3,
  shockLength: number,
): THREE.BufferGeometry {
  const span = edgeB.clone().sub(edgeA);
  const normal = new THREE.Vector3().crossVectors(span, shockDir).normalize();
  const thickness = Math.max(span.length() * 0.04, 0.015);
  const off = normal.clone().multiplyScalar(thickness / 2);

  const a0 = edgeA.clone().sub(off);
  const a1 = edgeA.clone().add(off);
  const b0 = edgeB.clone().sub(off);
  const b1 = edgeB.clone().add(off);
  const a0f = a0.clone().add(shockDir.clone().multiplyScalar(shockLength));
  const a1f = a1.clone().add(shockDir.clone().multiplyScalar(shockLength));
  const b0f = b0.clone().add(shockDir.clone().multiplyScalar(shockLength));
  const b1f = b1.clone().add(shockDir.clone().multiplyScalar(shockLength));

  const v = [a0, a1, b1, b0, a0f, a1f, b1f, b0f];
  const positions = v.flatMap((p) => [p.x, p.y, p.z]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function shockDirFromBeta(
  flowDir: THREE.Vector3,
  deflectAxis: THREE.Vector3,
  spanAxis: THREE.Vector3,
  beta: number,
  sideSign: 1 | -1,
): THREE.Vector3 {
  let flowPlane = flowDir
    .clone()
    .sub(spanAxis.clone().multiplyScalar(flowDir.dot(spanAxis)));
  if (flowPlane.lengthSq() < 1e-8) flowPlane = deflectAxis.clone();
  flowPlane.normalize();

  return flowPlane
    .clone()
    .multiplyScalar(Math.cos(beta))
    .add(deflectAxis.clone().multiplyScalar(sideSign * Math.sin(beta)))
    .normalize();
}

function createWedgeShocks(
  shape: PlacedShape,
  mach: number,
  aoaDeg: number,
  sideslipDeg: number,
): THREE.BufferGeometry[] {
  const halfAngle = getBodyHalfAngle(shape, aoaDeg);
  const beta = obliqueShockAngle(halfAngle, mach);
  if (beta === null) return [];

  const { len, depth } = getWedgeDimensions(shape.params, shape.scale);
  const matrix = shapeMatrix(shape);
  const { flowDir } = flowFrame(aoaDeg, sideslipDeg);
  const spanAxis = localAxis(matrix, new THREE.Vector3(0, 0, 1));
  const deflectAxis = localAxis(matrix, new THREE.Vector3(0, 1, 0));

  const leCenter = toWorld(getLeadingEdgeLocal('wedge', shape.params, shape.scale), matrix);
  const halfSpan = depth / 2;
  const edgeA = leCenter.clone().add(spanAxis.clone().multiplyScalar(-halfSpan));
  const edgeB = leCenter.clone().add(spanAxis.clone().multiplyScalar(halfSpan));

  return ([1, -1] as const).map((sign) => {
    const dir = shockDirFromBeta(flowDir, deflectAxis, spanAxis, beta, sign);
    return createShockSlab3D(edgeA, edgeB, dir, len);
  });
}

function createFlatPlateShocks(
  shape: PlacedShape,
  mach: number,
  aoaDeg: number,
  sideslipDeg: number,
): THREE.BufferGeometry[] {
  const halfAngle = getBodyHalfAngle(shape, aoaDeg);
  const beta = obliqueShockAngle(halfAngle, mach);
  if (beta === null) return [];

  const len = (shape.params.length ?? 2) * shape.scale[0];
  const depth = 0.5 * shape.scale[2];
  const matrix = shapeMatrix(shape);
  const { flowDir } = flowFrame(aoaDeg, sideslipDeg);
  const spanAxis = localAxis(matrix, new THREE.Vector3(0, 0, 1));
  const deflectAxis = localAxis(matrix, new THREE.Vector3(0, 1, 0));

  const leCenter = toWorld(getLeadingEdgeLocal('flatPlate', shape.params, shape.scale), matrix);
  const halfSpan = depth / 2;
  const edgeA = leCenter.clone().add(spanAxis.clone().multiplyScalar(-halfSpan));
  const edgeB = leCenter.clone().add(spanAxis.clone().multiplyScalar(halfSpan));

  return ([1, -1] as const).map((sign) => {
    const dir = shockDirFromBeta(flowDir, deflectAxis, spanAxis, beta, sign);
    return createShockSlab3D(edgeA, edgeB, dir, len * 1.2);
  });
}

function createConicalShock(
  shape: PlacedShape,
  mach: number,
  aoaDeg: number,
  sideslipDeg: number,
): THREE.BufferGeometry | null {
  const halfAngle = getBodyHalfAngle(shape, aoaDeg);
  const beta = obliqueShockAngle(halfAngle, mach);
  if (beta === null) return null;

  const p = shape.params;
  const s = shape.scale;
  const h =
    shape.kind === 'biconic'
      ? (p.length ?? 2.5) * s[0]
      : (p.length ?? 2) * s[0];

  const matrix = shapeMatrix(shape);
  const { flowDir } = flowFrame(aoaDeg, sideslipDeg);
  const apex = toWorld(getLeadingEdgeLocal(shape.kind, p, s), matrix);
  const baseRadius = h * Math.tan(beta);

  const geom = new THREE.ConeGeometry(baseRadius, h, 32, 1, true);
  orientShockConeLikeBody(geom, shape.kind, flowDir, apex, h);
  return geom;
}

function getAerofoilShockHalfAngle(thicknessRatio: number, aoaDeg: number): number {
  const aoaRad = Math.abs((aoaDeg * Math.PI) / 180);
  return Math.max(Math.atan(1.5 * thicknessRatio), aoaRad * 0.5, 0.04);
}

function createBowShock(
  shape: PlacedShape,
  mach: number,
  aoaDeg: number,
  sideslipDeg: number,
): THREE.BufferGeometry | null {
  const radius = getBluntRadius(shape);
  const standoff = bowShockStandoff(radius, mach);
  const matrix = shapeMatrix(shape);
  const { flowDir, perp1, perp2 } = flowFrame(aoaDeg, sideslipDeg);

  let stagnation: THREE.Vector3;
  if (shape.kind === 'cylinder') {
    const len = (shape.params.length ?? 2) * shape.scale[0];
    stagnation = toWorld(new THREE.Vector3(-len / 2, 0, 0), matrix);
  } else {
    stagnation = toWorld(getLeadingEdgeLocal('sphere', shape.params, shape.scale), matrix);
  }

  // Cap anchored at stagnation; rings expand downstream and outward with polar angle φ
  const shockReach = radius + standoff;
  const phiMax = Math.PI * 0.52;
  const segments = 40;
  const rings = 20;
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * phiMax;
    const ringR = shockReach * Math.sin(phi);
    const ax = standoff * (1 - Math.cos(phi));

    for (let j = 0; j <= segments; j++) {
      const az = (j / segments) * Math.PI * 2;
      const pt = stagnation
        .clone()
        .add(flowDir.clone().multiplyScalar(ax))
        .add(perp1.clone().multiplyScalar(ringR * Math.cos(az)))
        .add(perp2.clone().multiplyScalar(ringR * Math.sin(az)));
      vertices.push(pt.x, pt.y, pt.z);
    }
  }

  const cols = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = (i + 1) * cols + j + 1;
      const d = i * cols + j + 1;
      indices.push(a, d, b, b, d, c);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function createAerofoilShocks(
  shape: PlacedShape,
  mach: number,
  aoaDeg: number,
  sideslipDeg: number,
): THREE.BufferGeometry[] {
  const { chord, thicknessRatio, span } = getAerofoilDimensions(shape.params, shape.scale);
  const halfAngle = getAerofoilShockHalfAngle(thicknessRatio, aoaDeg);
  const beta = obliqueShockAngle(halfAngle, mach);
  if (beta === null) return [];

  const yLe = aerofoilThicknessAt(0.002, thicknessRatio, chord);
  const s2 = span / 2;
  const matrix = shapeMatrix(shape);
  const { flowDir } = flowFrame(aoaDeg, sideslipDeg);
  const spanAxis = localAxis(matrix, new THREE.Vector3(0, 0, 1));
  const deflectAxis = localAxis(matrix, new THREE.Vector3(0, 1, 0));

  return ([1, -1] as const)
    .map((sign) => {
      const edgeA = toWorld(new THREE.Vector3(0, sign * yLe, -s2), matrix);
      const edgeB = toWorld(new THREE.Vector3(0, sign * yLe, s2), matrix);
      const dir = shockDirFromBeta(flowDir, deflectAxis, spanAxis, beta, sign);
      return createShockSlab3D(edgeA, edgeB, dir, chord * 1.1);
    });
}

export function getShockMeshesForShape(
  shape: PlacedShape,
  mach: number,
  aoaDeg: number,
  sideslipDeg: number,
): { type: 'oblique' | 'bow' | 'conical'; geometry: THREE.BufferGeometry }[] {
  if (mach <= 1) return [];

  const result: { type: 'oblique' | 'bow' | 'conical'; geometry: THREE.BufferGeometry }[] = [];

  switch (shape.kind) {
    case 'wedge':
      createWedgeShocks(shape, mach, aoaDeg, sideslipDeg).forEach((geometry) =>
        result.push({ type: 'oblique', geometry }),
      );
      break;
    case 'flatPlate':
      createFlatPlateShocks(shape, mach, aoaDeg, sideslipDeg).forEach((geometry) =>
        result.push({ type: 'oblique', geometry }),
      );
      break;
    case 'cone':
    case 'biconic': {
      const geom = createConicalShock(shape, mach, aoaDeg, sideslipDeg);
      if (geom) result.push({ type: 'conical', geometry: geom });
      break;
    }
    case 'aerofoil': {
      createAerofoilShocks(shape, mach, aoaDeg, sideslipDeg).forEach((geometry) =>
        result.push({ type: 'oblique', geometry }),
      );
      break;
    }
    case 'ogive': {
      const noseR = (shape.params.noseRadius ?? 0.15) * Math.max(shape.scale[1], shape.scale[2]);
      const bodyR = (shape.params.radius ?? 0.4) * Math.max(shape.scale[1], shape.scale[2]);
      if (noseR / bodyR > 0.25) {
        const geom = createBowShock(shape, mach, aoaDeg, sideslipDeg);
        if (geom) result.push({ type: 'bow', geometry: geom });
      } else {
        const geom = createConicalShock(shape, mach, aoaDeg, sideslipDeg);
        if (geom) result.push({ type: 'conical', geometry: geom });
      }
      break;
    }
    case 'sphere':
    case 'custom':
    case 'cylinder': {
      const geom = createBowShock(shape, mach, aoaDeg, sideslipDeg);
      if (geom) result.push({ type: 'bow', geometry: geom });
      break;
    }
    default:
      break;
  }

  return result;
}

export function createObliqueShockMesh(
  shape: PlacedShape,
  mach: number,
  aoaDeg: number,
  sideslipDeg: number,
): THREE.BufferGeometry | null {
  return createWedgeShocks(shape, mach, aoaDeg, sideslipDeg)[0] ?? null;
}

export function createBowShockMesh(
  shape: PlacedShape,
  mach: number,
  aoaDeg: number,
  sideslipDeg: number,
): THREE.BufferGeometry | null {
  return createBowShock(shape, mach, aoaDeg, sideslipDeg);
}
