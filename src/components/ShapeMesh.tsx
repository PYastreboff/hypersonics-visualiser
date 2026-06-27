import { useMemo, useRef, useEffect, useState, useLayoutEffect, useCallback } from 'react';
import { TransformControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlacedShape } from '@/types';
import { useSimStore } from '@/store/simStore';
import { useShapeGeometry, computeSurfaceCpColors } from '@/shapes/geometry';
import { modifiedNewtonianCp } from '@/physics/newtonian';
import { detectRegime } from '@/physics/regimes';
import { computeTransitionVertexColors } from '@/visualization/transitionSurface';

interface ShapeMeshProps {
  shape: PlacedShape;
  isSelected: boolean;
}

function CustomSTLMesh({ url, shape, isSelected }: { url: string; shape: PlacedShape; isSelected: boolean }) {
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    import('three-stdlib').then(({ STLLoader }) => {
      const loader = new STLLoader();
      loader.load(url, (geom) => {
        geom.computeVertexNormals();
        geomRef.current = geom;
        setGeometry(geom);
      });
    });
    return () => {
      if (geomRef.current) geomRef.current.dispose();
    };
  }, [url]);

  if (!geometry) return null;
  return <ShapeMeshInner shape={shape} geometry={geometry} isSelected={isSelected} />;
}

function ShapeMeshInner({
  shape,
  geometry,
  isSelected,
}: {
  shape: PlacedShape;
  geometry: THREE.BufferGeometry;
  isSelected: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const gizmoTargetRef = useRef<THREE.Object3D>(null);
  const isDraggingRef = useRef(false);
  const [gizmoReady, setGizmoReady] = useState(false);
  const flowParams = useSimStore((s) => s.flowParams);
  const showTransition = useSimStore((s) => s.showTransition);
  const updateShapeTransform = useSimStore((s) => s.updateShapeTransform);
  const selectShape = useSimStore((s) => s.selectShape);
  const regime = detectRegime(flowParams.mach);

  const bindGroup = useCallback((node: THREE.Group | null) => {
    groupRef.current = node;
    setGizmoReady(node !== null && gizmoTargetRef.current !== null);
  }, []);

  const bindGizmoTarget = useCallback((node: THREE.Object3D | null) => {
    gizmoTargetRef.current = node;
    setGizmoReady(node !== null && groupRef.current !== null);
  }, []);

  const syncGizmoTargetFromShape = useCallback(() => {
    const g = groupRef.current;
    const target = gizmoTargetRef.current;
    if (!g || !target) return;
    g.updateMatrixWorld(true);
    g.getWorldPosition(target.position);
    target.quaternion.identity();
    target.scale.set(1, 1, 1);
    target.updateMatrixWorld(true);
  }, []);

  useLayoutEffect(() => {
    if (isDraggingRef.current) return;
    const g = groupRef.current;
    if (!g) return;
    g.position.set(...shape.position);
    g.rotation.set(...shape.rotation);
    g.scale.set(...shape.scale);
    syncGizmoTargetFromShape();
  }, [shape.position, shape.rotation, shape.scale, syncGizmoTargetFromShape]);

  useFrame(() => {
    if (!isSelected || isDraggingRef.current) return;
    const target = gizmoTargetRef.current;
    if (!target) return;
    target.quaternion.identity();
    target.scale.set(1, 1, 1);
  });

  const syncTransform = useCallback(
    (recompute: boolean) => {
      const g = groupRef.current;
      const target = gizmoTargetRef.current;
      if (!g || !target) return;
      g.position.copy(target.position);
      g.updateMatrixWorld(true);
      updateShapeTransform(
        shape.id,
        [g.position.x, g.position.y, g.position.z],
        [g.rotation.x, g.rotation.y, g.rotation.z],
        [g.scale.x, g.scale.y, g.scale.z],
        recompute,
      );
    },
    [shape.id, updateShapeTransform],
  );

  const coloredGeom = useMemo(() => {
    const geom = geometry.clone();
    const cpColors = computeSurfaceCpColors(geom, (nx, ny) => {
      const angle = Math.acos(Math.min(1, Math.abs(nx)));
      if (regime === 'hypersonic' || regime === 'supersonic') {
        return modifiedNewtonianCp(angle, flowParams.mach);
      }
      return 1 - Math.abs(ny);
    });

    if (showTransition) {
      const transColors = computeTransitionVertexColors(
        geom,
        shape,
        flowParams.mach,
        flowParams.altitude,
        flowParams.angleOfAttack,
        flowParams.sideslip,
        flowParams.freeStreamTemp,
      );
      for (let i = 0; i < cpColors.length / 3; i++) {
        const blend = 0.45;
        cpColors[i * 3] = cpColors[i * 3] * (1 - blend) + transColors[i * 3] * blend;
        cpColors[i * 3 + 1] = cpColors[i * 3 + 1] * (1 - blend) + transColors[i * 3 + 1] * blend;
        cpColors[i * 3 + 2] = cpColors[i * 3 + 2] * (1 - blend) + transColors[i * 3 + 2] * blend;
      }
    }

    geom.setAttribute('color', new THREE.BufferAttribute(cpColors, 3));
    return geom;
  }, [geometry, flowParams, regime, showTransition, shape]);

  return (
    <>
      <group
        ref={bindGroup}
        onClick={(e) => {
          e.stopPropagation();
          selectShape(shape.id);
        }}
      >
        <mesh geometry={coloredGeom} castShadow receiveShadow>
          <meshStandardMaterial vertexColors side={THREE.FrontSide} metalness={0.3} roughness={0.5} />
        </mesh>
      </group>
      <object3D ref={bindGizmoTarget} visible={false} />
      {isSelected && gizmoReady && gizmoTargetRef.current && (
        <TransformControls
          object={gizmoTargetRef.current}
          mode="translate"
          space="world"
          showX
          showY
          showZ
          onMouseDown={() => {
            isDraggingRef.current = true;
          }}
          onObjectChange={() => {
            if (!isDraggingRef.current) return;
            syncTransform(false);
          }}
          onMouseUp={() => {
            isDraggingRef.current = false;
            syncTransform(true);
          }}
        />
      )}
    </>
  );
}

export function ShapeMesh({ shape, isSelected }: ShapeMeshProps) {
  const defaultGeom = useShapeGeometry(shape.kind, shape.params, shape.scale);

  if (shape.kind === 'custom' && shape.customGeometryUrl) {
    return <CustomSTLMesh url={shape.customGeometryUrl} shape={shape} isSelected={isSelected} />;
  }

  return <ShapeMeshInner shape={shape} geometry={defaultGeom} isSelected={isSelected} />;
}

export function BoundaryLayerShell({ shape }: { shape: PlacedShape }) {
  const groupRef = useRef<THREE.Group>(null);
  const showBoundaryLayer = useSimStore((s) => s.showBoundaryLayer);
  const geometry = useShapeGeometry(shape.kind, shape.params, shape.scale);

  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.position.set(...shape.position);
    g.rotation.set(...shape.rotation);
    g.scale.set(...shape.scale);
    g.updateMatrixWorld(true);
  }, [shape.position, shape.rotation, shape.scale]);

  const shellGeom = useMemo(() => {
    if (!showBoundaryLayer) return null;
    return geometry.clone().scale(1.02, 1.02, 1.02);
  }, [showBoundaryLayer, geometry]);

  if (!shellGeom) return null;

  return (
    <group ref={groupRef}>
      <mesh geometry={shellGeom}>
        <meshBasicMaterial color="#88ccff" wireframe transparent opacity={0.12} />
      </mesh>
    </group>
  );
}
