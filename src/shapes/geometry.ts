import { useMemo } from 'react';
import type { ShapeKind, ShapeParams } from '@/types';
import * as THREE from 'three';
import {
  buildAerofoilSolid,
  buildWedgeSolid,
  getAerofoilDimensions,
  getWedgeDimensions,
} from './solidGeometry';

export function useShapeGeometry(
  kind: ShapeKind,
  params: ShapeParams,
  scale: [number, number, number],
): THREE.BufferGeometry {
  return useMemo(() => {
    let geom: THREE.BufferGeometry;

    switch (kind) {
      case 'sphere': {
        const r = (params.radius ?? 0.5) * Math.max(...scale);
        geom = new THREE.SphereGeometry(r, 48, 32);
        break;
      }
      case 'cone': {
        const r = (params.radius ?? 0.4) * Math.max(scale[1], scale[2]);
        const h = (params.length ?? 2) * scale[0];
        geom = new THREE.ConeGeometry(r, h, 32);
        // Tip at origin, body extends downstream (+X) into the wind from -X
        geom.rotateZ(Math.PI / 2);
        geom.translate(h / 2, 0, 0);
        break;
      }
      case 'wedge': {
        const { len, halfHeight, depth } = getWedgeDimensions(params, scale);
        geom = buildWedgeSolid(len, halfHeight, depth);
        break;
      }
      case 'cylinder': {
        const r = (params.radius ?? 0.3) * Math.max(scale[1], scale[2]);
        const h = (params.length ?? 2) * scale[0];
        geom = new THREE.CylinderGeometry(r, r, h, 32);
        geom.rotateZ(Math.PI / 2);
        break;
      }
      case 'flatPlate': {
        const w = (params.length ?? 2) * scale[0];
        const ht = 0.05 * scale[1];
        const d = 0.5 * scale[2];
        geom = new THREE.BoxGeometry(w, ht, d);
        break;
      }
      case 'biconic': {
        const r1 = (params.radius ?? 0.35) * Math.max(scale[1], scale[2]);
        const r2 = (params.rearRadius ?? 0.2) * Math.max(scale[1], scale[2]);
        const h = (params.length ?? 2.5) * scale[0];
        geom = new THREE.CylinderGeometry(r2, r1, h, 32);
        geom.rotateZ(-Math.PI / 2);
        geom.translate(h / 2, 0, 0);
        break;
      }
      case 'ogive': {
        const r = (params.radius ?? 0.4) * Math.max(scale[1], scale[2]);
        const h = (params.length ?? 2) * scale[0];
        const nr = (params.noseRadius ?? 0.15) * Math.max(scale[1], scale[2]);
        const points: THREE.Vector2[] = [];
        for (let i = 0; i <= 32; i++) {
          const t = i / 32;
          const x = t * h;
          const y = r * Math.sqrt(1 - Math.pow(1 - t, 2)) * (1 - nr / r) + nr;
          points.push(new THREE.Vector2(x - h / 2, y));
        }
        for (let i = 32; i >= 0; i--) {
          const t = i / 32;
          const x = t * h;
          const y = -(r * Math.sqrt(1 - Math.pow(1 - t, 2)) * (1 - nr / r) + nr);
          points.push(new THREE.Vector2(x - h / 2, y));
        }
        geom = new THREE.LatheGeometry(
          points.slice(0, 33).map((p) => new THREE.Vector2(p.x + h / 2, Math.abs(p.y))),
          32,
        );
        geom.rotateZ(-Math.PI / 2);
        geom.translate(h / 2, 0, 0);
        break;
      }
      case 'aerofoil': {
        const { chord, thicknessRatio, span } = getAerofoilDimensions(params, scale);
        geom = buildAerofoilSolid(chord, thicknessRatio, span);
        break;
      }
      default:
        geom = new THREE.SphereGeometry(0.5, 32, 24);
    }

    geom.computeVertexNormals();
    return geom;
  }, [kind, params, scale]);
}

export function applySurfaceColors(
  geometry: THREE.BufferGeometry,
  colors: Float32Array,
): void {
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function computeSurfaceCpColors(
  geometry: THREE.BufferGeometry,
  cpFn: (nx: number, ny: number, nz: number) => number,
): Float32Array {
  const pos = geometry.getAttribute('position');
  const norm = geometry.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);
    const cp = cpFn(nx, ny, nz);
    const t = Math.max(0, Math.min(1, (cp + 0.5) / 2));
    colors[i * 3] = t;
    colors[i * 3 + 1] = 0.2 + 0.3 * (1 - t);
    colors[i * 3 + 2] = 1 - t;
  }

  return colors;
}
