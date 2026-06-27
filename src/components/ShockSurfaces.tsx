import { useMemo } from 'react';
import * as THREE from 'three';
import { useSimStore } from '@/store/simStore';
import { getShockMeshesForShape } from '@/visualization/shockMeshes';

export function ShockSurfaces() {
  const { shapes, flowParams, showShocks } = useSimStore();

  const shockGroups = useMemo(() => {
    if (!showShocks || flowParams.mach <= 1) return [];
    return shapes.flatMap((shape) =>
      getShockMeshesForShape(
        shape,
        flowParams.mach,
        flowParams.angleOfAttack,
        flowParams.sideslip,
      ).map((s) => ({
        shapeId: shape.id,
        ...s,
      })),
    );
  }, [shapes, flowParams.mach, flowParams.angleOfAttack, flowParams.sideslip, showShocks]);

  if (!showShocks) return null;

  return (
    <group>
      {shockGroups.map((shock, i) => (
        <mesh key={`${shock.shapeId}-${shock.type}-${i}`} geometry={shock.geometry} renderOrder={3}>
          <meshBasicMaterial
            color={
              shock.type === 'bow' ? '#ff5544' : shock.type === 'conical' ? '#ff9933' : '#ffcc44'
            }
            transparent
            opacity={0.58}
            side={THREE.DoubleSide}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
