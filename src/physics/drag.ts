import type { PlacedShape, ShapeMetrics } from '@/types';
import { RECOVERY_LAMINAR, RECOVERY_TURBULENT } from './constants';
import {
  adiabaticWallTemp,
  densityAtAltitude,
  dynamicPressure,
  reynoldsNumber,
  stagnationTemperature,
  temperatureAtAltitude,
  velocityFromMach,
} from './atmosphere';
import { detectRegime } from './regimes';
import { modifiedNewtonianCp } from './newtonian';
import { getShapeDefinition } from '@/shapes/definitions';
import { transitionState } from './transition';

function skinFrictionCf(re: number, state: 'laminar' | 'turbulent'): number {
  if (state === 'laminar') return 1.328 / Math.sqrt(Math.max(re, 1));
  return 0.074 / Math.pow(Math.max(re, 1), 0.2);
}

function estimateShapeCoeffs(
  shape: PlacedShape,
  mach: number,
  altitude: number,
  aoaDeg: number,
  tempK: number,
): { cdPressure: number; cdFriction: number; cl: number; cm: number; maxWallTemp: number } {
  const def = getShapeDefinition(shape.kind);
  const refArea = def.referenceArea(shape.params, shape.scale);
  const length = def.lengthScale(shape.params, shape.scale);
  const wetted = def.wettedArea(shape.params, shape.scale);
  const re = reynoldsNumber(mach, altitude, length, tempK);
  const regime = detectRegime(mach);
  const aoaRad = (aoaDeg * Math.PI) / 180;

  let cdPressure = 0;
  let cl = 0;
  let cm = 0;

  switch (shape.kind) {
    case 'sphere': {
      if (regime === 'subsonic') cdPressure = 0.44;
      else if (regime === 'transonic') cdPressure = 0.5 + 0.3 * (mach - 0.7);
      else if (regime === 'supersonic') cdPressure = 0.9 + 0.05 * (mach - 1.3);
      else cdPressure = 1.8 / Math.sqrt(mach);
      break;
    }
    case 'cone': {
      const halfAngle = ((shape.params.halfAngle ?? 15) * Math.PI) / 180;
      if (mach > 1) {
        const cp = modifiedNewtonianCp(halfAngle + aoaRad, mach);
        cdPressure = cp * Math.cos(halfAngle) + 0.1;
        cl = cp * Math.sin(aoaRad) * 0.5;
      } else {
        cdPressure = 0.15 + 0.3 * halfAngle;
        cl = 2 * aoaRad;
      }
      break;
    }
    case 'wedge': {
      const wedgeAngle = ((shape.params.wedgeAngle ?? 10) * Math.PI) / 180;
      if (mach > 1) {
        const cp = modifiedNewtonianCp(wedgeAngle, mach);
        cdPressure = cp * 2 * Math.sin(wedgeAngle);
        cl = cp * Math.sin(aoaRad);
      } else {
        cdPressure = 0.02 + wedgeAngle * 2;
        cl = Math.PI * aoaRad;
      }
      break;
    }
    case 'cylinder': {
      cdPressure = regime === 'subsonic' ? 1.2 : 1.4;
      cl = 1.2 * aoaRad;
      break;
    }
    case 'flatPlate': {
      cdPressure = regime === 'subsonic' ? 0.01 : 0.02 * mach;
      cl = 0;
      break;
    }
    case 'biconic':
    case 'ogive': {
      const halfAngle = ((shape.params.halfAngle ?? 12) * Math.PI) / 180;
      if (mach > 1) {
        const cp = modifiedNewtonianCp(halfAngle + aoaRad * 0.5, mach);
        cdPressure = cp * 0.8;
        cl = cp * Math.sin(aoaRad) * 0.4;
      } else {
        cdPressure = 0.2;
        cl = 1.5 * aoaRad;
      }
      break;
    }
    case 'aerofoil': {
      if (regime === 'subsonic') {
        cdPressure = 0.008 + 0.015 * Math.abs(aoaDeg);
        cl = 2 * Math.PI * aoaRad;
      } else if (mach > 1) {
        const cp = modifiedNewtonianCp(aoaRad, mach);
        cdPressure = 0.05 + cp * 0.3;
        cl = cp * Math.sin(aoaRad);
      } else {
        cdPressure = 0.05 + 0.1 * (mach - 0.7);
        cl = Math.PI * aoaRad;
      }
      break;
    }
    case 'custom': {
      cdPressure = regime === 'subsonic' ? 0.5 : 1.2;
      cl = aoaRad;
      break;
    }
  }

  const trans = transitionState(re);
  const cf = skinFrictionCf(re, trans === 'turbulent' ? 'turbulent' : 'laminar');
  const cdFriction = (cf * wetted) / refArea;

  const recovery = trans === 'turbulent' ? RECOVERY_TURBULENT : RECOVERY_LAMINAR;
  const maxWallTemp = adiabaticWallTemp(tempK, mach, recovery);

  cm = cl * 0.1;
  return { cdPressure, cdFriction, cl, cm, maxWallTemp };
}

export function computeShapeMetrics(
  shape: PlacedShape,
  mach: number,
  altitude: number,
  aoaDeg: number,
  freeStreamTemp: number | null,
): ShapeMetrics {
  const tempK = freeStreamTemp ?? temperatureAtAltitude(altitude);
  const def = getShapeDefinition(shape.kind);
  const refArea = def.referenceArea(shape.params, shape.scale);
  const coeffs = estimateShapeCoeffs(shape, mach, altitude, aoaDeg, tempK);
  const stagTemp = stagnationTemperature(tempK, mach);

  return {
    shapeId: shape.id,
    name: shape.name,
    cd: coeffs.cdPressure + coeffs.cdFriction,
    cl: coeffs.cl,
    cm: coeffs.cm,
    pressureDrag: coeffs.cdPressure,
    frictionDrag: coeffs.cdFriction,
    maxWallTemp: coeffs.maxWallTemp,
    stagnationTemp: stagTemp,
    referenceArea: refArea,
  };
}

export function computeInterferenceFactor(shapes: PlacedShape[]): number {
  if (shapes.length < 2) return 1;
  let minDist = Infinity;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i].position;
      const b = shapes[j].position;
      const d = Math.sqrt(
        (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
      );
      minDist = Math.min(minDist, d);
    }
  }
  const def = getShapeDefinition(shapes[0].kind);
  const charLen = def.lengthScale(shapes[0].params, shapes[0].scale);
  const ratio = minDist / Math.max(charLen, 0.1);
  if (ratio < 1.5) return 0.6 + 0.2 * ratio;
  if (ratio < 3) return 0.85 + 0.05 * ratio;
  return 1;
}

export function computeAllMetrics(
  shapes: PlacedShape[],
  mach: number,
  altitude: number,
  aoaDeg: number,
  freeStreamTemp: number | null,
) {
  const tempK = freeStreamTemp ?? temperatureAtAltitude(altitude);
  const interference = computeInterferenceFactor(shapes);
  const shapeMetrics = shapes.map((s) =>
    computeShapeMetrics(s, mach, altitude, aoaDeg, freeStreamTemp),
  );

  const totalCd =
    shapeMetrics.reduce((sum, m) => sum + m.cd, 0) * interference;
  const totalCl =
    shapeMetrics.reduce((sum, m) => sum + m.cl, 0) * interference;

  const avgLen =
    shapes.length > 0
      ? shapes.reduce(
          (s, sh) => s + getShapeDefinition(sh.kind).lengthScale(sh.params, sh.scale),
          0,
        ) / shapes.length
      : 1;

  return {
    regime: detectRegime(mach),
    reynolds: reynoldsNumber(mach, altitude, avgLen, tempK),
    dynamicPressure: dynamicPressure(mach, altitude, tempK),
    mach,
    stagnationTemp: stagnationTemperature(tempK, mach),
    shapes: shapeMetrics,
    totalCd,
    totalCl,
    interferenceFactor: interference,
  };
}

export function dragForce(cd: number, mach: number, altitude: number, refArea: number, tempK?: number): number {
  const q = dynamicPressure(mach, altitude, tempK);
  return cd * q * refArea;
}

export function freeStreamDensity(altitude: number): number {
  return densityAtAltitude(altitude);
}

export function freeStreamVelocity(mach: number, tempK: number): number {
  return velocityFromMach(mach, tempK);
}
