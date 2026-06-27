import * as THREE from 'three';
import type { ShapeParams } from '@/types';

export function buildWedgeSolid(
  len: number,
  halfHeight: number,
  depth: number,
): THREE.BufferGeometry {
  const d2 = depth / 2;
  const positions = [
    -len / 2, 0, -d2,
    -len / 2, 0, d2,
    len / 2, halfHeight, -d2,
    len / 2, halfHeight, d2,
    len / 2, -halfHeight, -d2,
    len / 2, -halfHeight, d2,
  ];

  const indices = [
    0, 2, 4,
    1, 5, 3,
    0, 1, 3, 0, 3, 2,
    0, 4, 5, 0, 5, 1,
    2, 3, 5, 2, 5, 4,
  ];

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export function aerofoilThicknessAt(xt: number, thicknessRatio: number, chord: number): number {
  return (
    5 *
    thicknessRatio *
    chord *
    (0.2969 * Math.sqrt(xt) -
      0.126 * xt -
      0.3516 * xt ** 2 +
      0.2843 * xt ** 3 -
      0.1015 * xt ** 4)
  );
}

export function buildAerofoilSolid(
  chord: number,
  thicknessRatio: number,
  span: number,
): THREE.BufferGeometry {
  const t = thicknessRatio;
  const steps = 32;
  const s2 = span / 2;

  const ytAt = (xt: number) => aerofoilThicknessAt(xt, t, chord);

  const topFront: THREE.Vector3[] = [];
  const botFront: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const xt = i / steps;
    const x = xt * chord;
    const y = ytAt(xt);
    topFront.push(new THREE.Vector3(x, y, -s2));
    botFront.push(new THREE.Vector3(x, -y, -s2));
  }

  const topBack: THREE.Vector3[] = topFront.map((p) => new THREE.Vector3(p.x, p.y, s2));
  const botBack: THREE.Vector3[] = botFront.map((p) => new THREE.Vector3(p.x, p.y, s2));

  const positions: number[] = [];
  const indices: number[] = [];

  const push = (v: THREE.Vector3) => {
    positions.push(v.x, v.y, v.z);
    return positions.length / 3 - 1;
  };

  const frontTopIdx = topFront.map(push);
  const frontBotIdx = botFront.map(push);
  const backTopIdx = topBack.map(push);
  const backBotIdx = botBack.map(push);

  for (let i = 0; i < steps; i++) {
    const a = frontTopIdx[i];
    const b = frontTopIdx[i + 1];
    const c = frontBotIdx[i + 1];
    const d = frontBotIdx[i];
    indices.push(a, b, c, a, c, d);
  }

  for (let i = 0; i < steps; i++) {
    const a = backTopIdx[i];
    const b = backTopIdx[i + 1];
    const c = backBotIdx[i + 1];
    const d = backBotIdx[i];
    indices.push(a, c, b, a, d, c);
  }

  for (let i = 0; i < steps; i++) {
    indices.push(
      frontTopIdx[i], backTopIdx[i], backTopIdx[i + 1], frontTopIdx[i], backTopIdx[i + 1], frontTopIdx[i + 1],
      frontBotIdx[i], backBotIdx[i + 1], backBotIdx[i], frontBotIdx[i], frontBotIdx[i + 1], backBotIdx[i + 1],
    );
  }

  indices.push(frontTopIdx[0], frontBotIdx[0], backBotIdx[0], frontTopIdx[0], backBotIdx[0], backTopIdx[0]);
  const n = frontTopIdx.length - 1;
  indices.push(
    frontTopIdx[n], backTopIdx[n], backBotIdx[n], frontTopIdx[n], backBotIdx[n], frontBotIdx[n],
  );

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export function getWedgeDimensions(params: ShapeParams, scale: [number, number, number]) {
  const len = (params.length ?? 2) * scale[0];
  const halfHeight = (params.wedgeAngle ?? 10) * 0.02 * scale[1];
  const depth = Math.max(0.6 * scale[2], 0.45);
  return { len, halfHeight, depth };
}

export function getAerofoilDimensions(params: ShapeParams, scale: [number, number, number]) {
  const chord = (params.length ?? 3.5) * scale[0];
  const thicknessRatio = (params.thickness ?? 15) / 100;
  const span = Math.max(0.55 * scale[2], 0.45);
  return { chord, thicknessRatio, span };
}
