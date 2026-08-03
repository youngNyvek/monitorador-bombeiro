import type { PreprocessSettings } from '../types';
import { applyPreprocessToCanvas } from './preprocess';

export function captureFrameCanvas(video: HTMLVideoElement, preprocess: PreprocessSettings): HTMLCanvasElement {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('video-not-ready');
  }

  const scale = Math.max(1, Number.isFinite(preprocess.scale) ? preprocess.scale : 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('canvas-context-unavailable');
  }

  context.imageSmoothingEnabled = true;
  context.drawImage(video, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  return applyPreprocessToCanvas(canvas, preprocess);
}

export async function captureFrameBlob(video: HTMLVideoElement, preprocess: PreprocessSettings): Promise<Blob> {
  const canvas = captureFrameCanvas(video, preprocess);
  return canvasToBlob(canvas);
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
