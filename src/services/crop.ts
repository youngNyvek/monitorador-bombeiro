import type { PreprocessSettings, RegionRect } from '../types';
import { applyPreprocessToCanvas } from './preprocess';

export function captureRegionCanvas(
  video: HTMLVideoElement,
  region: RegionRect,
  preprocess: PreprocessSettings,
): HTMLCanvasElement {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('video-not-ready');
  }

  const sourceRect = regionToSourceRect(region, sourceWidth, sourceHeight);
  const scale = Math.max(1, Number.isFinite(preprocess.scale) ? preprocess.scale : 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceRect.width * scale));
  canvas.height = Math.max(1, Math.round(sourceRect.height * scale));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('canvas-context-unavailable');
  }

  context.imageSmoothingEnabled = true;
  context.drawImage(
    video,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return applyPreprocessToCanvas(canvas, preprocess);
}

export async function captureRegionBlob(
  video: HTMLVideoElement,
  region: RegionRect,
  preprocess: PreprocessSettings,
): Promise<Blob> {
  const canvas = captureRegionCanvas(video, region, preprocess);
  return canvasToBlob(canvas);
}

function regionToSourceRect(region: RegionRect, sourceWidth: number, sourceHeight: number) {
  const x = clamp(Math.round((region.x / 100) * sourceWidth), 0, sourceWidth - 1);
  const y = clamp(Math.round((region.y / 100) * sourceHeight), 0, sourceHeight - 1);
  const width = clamp(Math.round((region.width / 100) * sourceWidth), 1, sourceWidth - x);
  const height = clamp(Math.round((region.height / 100) * sourceHeight), 1, sourceHeight - y);

  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('canvas-blob-failed'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });
}
