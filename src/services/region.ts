import type { RegionRect } from '../types';

export function clampRegion(region: RegionRect, minSize = 5): RegionRect {
  const width = clamp(region.width, minSize, 100);
  const height = clamp(region.height, minSize, 100);
  const x = clamp(region.x, 0, 100 - width);
  const y = clamp(region.y, 0, 100 - height);

  return {
    x: roundOneDecimal(x),
    y: roundOneDecimal(y),
    width: roundOneDecimal(width),
    height: roundOneDecimal(height),
  };
}

export function createDefaultRegion(): RegionRect {
  return clampRegion({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
