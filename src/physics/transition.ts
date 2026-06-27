import type { TransitionState } from '@/types';
import { RE_CRIT } from './constants';

export function transitionState(reX: number): TransitionState {
  if (reX < RE_CRIT * 0.5) return 'laminar';
  if (reX < RE_CRIT * 1.5) return 'transitional';
  return 'turbulent';
}

export function localReynoldsX(
  x: number,
  mach: number,
  rho: number,
  mu: number,
  a: number,
): number {
  const V = mach * a;
  return (rho * V * Math.abs(x)) / mu;
}

export function blasiusThickness(reX: number): number {
  if (reX <= 0) return 0;
  return (5 * Math.abs(reX)) / Math.sqrt(reX) * 1e-3;
}

export function turbulentThickness(reX: number): number {
  if (reX <= 0) return 0;
  return 0.37 * Math.pow(Math.abs(reX), 0.8) * 1e-3;
}

export function boundaryLayerThickness(reX: number, state: TransitionState): number {
  if (state === 'laminar') return blasiusThickness(reX);
  if (state === 'transitional') {
    const lam = blasiusThickness(reX);
    const turb = turbulentThickness(reX);
    return (lam + turb) / 2;
  }
  return turbulentThickness(reX);
}

export function transitionColor(state: TransitionState): string {
  switch (state) {
    case 'laminar':
      return '#4a9eff';
    case 'transitional':
      return '#ffd54a';
    case 'turbulent':
      return '#ff6b4a';
  }
}
