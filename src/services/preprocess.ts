import type { PreprocessSettings } from '../types';

export function applyPreprocessToCanvas(canvas: HTMLCanvasElement, settings: PreprocessSettings): HTMLCanvasElement {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('canvas-context-unavailable');
  }

  if (!settings.grayscale && !settings.invert && settings.threshold <= 0) {
    return canvas;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);

    if (settings.threshold > 0) {
      const binary = luminance >= settings.threshold ? 255 : 0;
      const adjusted = settings.invert ? 255 - binary : binary;
      data[index] = adjusted;
      data[index + 1] = adjusted;
      data[index + 2] = adjusted;
      data[index + 3] = 255;
      continue;
    }

    if (settings.grayscale) {
      const adjusted = settings.invert ? 255 - luminance : luminance;
      data[index] = adjusted;
      data[index + 1] = adjusted;
      data[index + 2] = adjusted;
      data[index + 3] = 255;
      continue;
    }

    if (settings.invert) {
      data[index] = 255 - red;
      data[index + 1] = 255 - green;
      data[index + 2] = 255 - blue;
      data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}
