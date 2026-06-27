import { useMemo } from 'react';
import * as THREE from 'three';
import { useSimStore } from '@/store/simStore';
import { createFlowField } from '@/physics/flowField';
import { densityToColor, machToColor, tempToColor } from '@/visualization/colorMaps';

const SLICE_RES = 64;

export function SlicePlaneView() {
  const { flowParams, shapes, showSlice, slicePlane, sliceField, simMode, hfState } =
    useSimStore();

  const texture = useMemo(() => {
    const data = new Float32Array(SLICE_RES * SLICE_RES);

    if (simMode === 'highFidelity' && hfState.status === 'complete' && hfState.mach) {
      const nx = hfState.gridNx;
      const ny = hfState.gridNy;
      const field =
        sliceField === 'density'
          ? hfState.density!
          : sliceField === 'temperature'
            ? hfState.temperature!
            : hfState.mach!;

      for (let j = 0; j < SLICE_RES; j++) {
        for (let i = 0; i < SLICE_RES; i++) {
          const gi = Math.floor((i / SLICE_RES) * nx);
          const gj = Math.floor((j / SLICE_RES) * ny);
          data[j * SLICE_RES + i] = field[gj * nx + gi] ?? 0;
        }
      }
    } else {
      const field = createFlowField(flowParams, shapes);
      for (let j = 0; j < SLICE_RES; j++) {
        for (let i = 0; i < SLICE_RES; i++) {
          const u = (i / SLICE_RES - 0.5) * 10;
          const v = (j / SLICE_RES - 0.5) * 4;
          let x = 0,
            y = 0,
            z = 0;
          if (slicePlane === 'xz') {
            x = u;
            z = v;
          } else if (slicePlane === 'xy') {
            x = u;
            y = v;
          } else {
            y = u;
            z = v;
          }
          const sample = field.sample(x, y, z);
          if (sliceField === 'density') data[j * SLICE_RES + i] = sample.density;
          else if (sliceField === 'temperature') data[j * SLICE_RES + i] = sample.temperature;
          else data[j * SLICE_RES + i] = sample.machLocal;
        }
      }
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const rgba = new Uint8Array(SLICE_RES * SLICE_RES * 4);

    for (let i = 0; i < data.length; i++) {
      let rgb: [number, number, number];
      if (sliceField === 'temperature') {
        rgb = tempToColor(data[i], min, max);
      } else if (sliceField === 'density') {
        rgb = densityToColor(data[i], min, max);
      } else {
        rgb = machToColor(data[i], Math.max(max, 1));
      }
      rgba[i * 4] = Math.round(rgb[0] * 255);
      rgba[i * 4 + 1] = Math.round(rgb[1] * 255);
      rgba[i * 4 + 2] = Math.round(rgb[2] * 255);
      rgba[i * 4 + 3] = 220;
    }

    const tex = new THREE.DataTexture(rgba, SLICE_RES, SLICE_RES, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }, [flowParams, shapes, showSlice, slicePlane, sliceField, simMode, hfState]);

  if (!showSlice) return null;

  const rotation: [number, number, number] =
    slicePlane === 'xz' ? [-Math.PI / 2, 0, 0] : slicePlane === 'xy' ? [0, 0, 0] : [0, Math.PI / 2, 0];

  return (
    <mesh rotation={rotation} position={[0, 0, 0]}>
      <planeGeometry args={[10, 4]} />
      <meshBasicMaterial map={texture} transparent opacity={0.85} side={THREE.DoubleSide} />
    </mesh>
  );
}
