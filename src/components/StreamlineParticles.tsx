import { useMemo } from 'react';
import * as THREE from 'three';
import type { FlowParams, PlacedShape } from '@/types';
import { useSimStore } from '@/store/simStore';
import { createFlowField, isPointInsideAnyShape } from '@/physics/flowField';

const TUNNEL_X = 12;
const TUNNEL_Y = 4;
const TUNNEL_Z = 4;
const MIN_MACH = 0.05;
const SEEDS_Y = 9;
const SEEDS_Z = 5;
const MAX_STEPS = 52;
const STEP = 0.2;

function inTunnel(x: number, y: number, z: number): boolean {
  return (
    x <= TUNNEL_X / 2 &&
    x >= -TUNNEL_X / 2 - 0.3 &&
    Math.abs(y) <= TUNNEL_Y / 2 * 0.92 &&
    Math.abs(z) <= TUNNEL_Z / 2 * 0.92
  );
}

function traceStreamline(
  start: THREE.Vector3,
  field: ReturnType<typeof createFlowField>,
  shapes: PlacedShape[],
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [start.clone()];
  let p = start.clone();

  for (let step = 0; step < MAX_STEPS; step++) {
    if (isPointInsideAnyShape(p.x, p.y, p.z, shapes)) break;

    const v = field.sampleVelocity(p.x, p.y, p.z);
    const speed = v.length();
    if (speed < 1e-6) break;

    const dir = v.multiplyScalar(1 / speed);
    const mid = p.clone().add(dir.clone().multiplyScalar(STEP * 0.5));
    const vMid = field.sampleVelocity(mid.x, mid.y, mid.z);
    const midSpeed = vMid.length();
    if (midSpeed < 1e-6) break;

    const stepDir = vMid.multiplyScalar(1 / midSpeed);
    const next = p.clone().add(stepDir.multiplyScalar(STEP));

    if (!inTunnel(next.x, next.y, next.z)) break;
    if (isPointInsideAnyShape(next.x, next.y, next.z, shapes)) break;

    points.push(next.clone());
    p.copy(next);
  }

  return points.length >= 2 ? points : [];
}

function buildStreamlineGeometry(
  flowParams: FlowParams,
  shapes: PlacedShape[],
): THREE.BufferGeometry | null {
  const field = createFlowField(flowParams, shapes);
  const positions: number[] = [];

  for (let iy = 0; iy < SEEDS_Y; iy++) {
    for (let iz = 0; iz < SEEDS_Z; iz++) {
      const y = (iy / (SEEDS_Y - 1) - 0.5) * TUNNEL_Y * 0.88;
      const z = (iz / (SEEDS_Z - 1) - 0.5) * TUNNEL_Z * 0.88;
      const start = new THREE.Vector3(-TUNNEL_X / 2 + 0.12, y, z);
      const pts = traceStreamline(start, field, shapes);

      for (let i = 0; i < pts.length - 1; i++) {
        positions.push(pts[i].x, pts[i].y, pts[i].z);
        positions.push(pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      }
    }
  }

  if (positions.length < 6) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export function StreamlineParticles() {
  const { flowParams, shapes, showStreamlines } = useSimStore();
  const mach = flowParams.mach;

  const geometry = useMemo(() => {
    if (mach < MIN_MACH) return null;
    return buildStreamlineGeometry(flowParams, shapes);
  }, [
    mach,
    flowParams.angleOfAttack,
    flowParams.sideslip,
    flowParams.altitude,
    flowParams.freeStreamTemp,
    shapes,
  ]);

  if (!showStreamlines || mach < MIN_MACH || !geometry) return null;

  return (
    <lineSegments geometry={geometry} renderOrder={0}>
      <lineBasicMaterial
        color="#7ec8ff"
        transparent
        opacity={0.42}
        depthWrite={false}
        depthTest
      />
    </lineSegments>
  );
}
