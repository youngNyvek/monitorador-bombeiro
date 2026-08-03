import { createWorker, type LoggerMessage, type Worker } from 'tesseract.js';

type ProgressHandler = (message: LoggerMessage) => void;

let workerPromise: Promise<Worker> | null = null;
let workerInstance: Worker | null = null;

export function isOcrSupported(): boolean {
  return typeof window !== 'undefined';
}

export async function loadOcrWorker(progressHandler?: ProgressHandler): Promise<Worker> {
  if (workerInstance) {
    return workerInstance;
  }

  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        const worker = await createWorker('eng', 1, {
          logger: progressHandler,
        });

        workerInstance = worker;
        return worker;
      } catch (error) {
        workerInstance = null;
        workerPromise = null;
        throw error;
      }
    })();
  }

  try {
    workerInstance = await workerPromise;
    return workerInstance;
  } catch (error) {
    workerInstance = null;
    workerPromise = null;
    throw error;
  }
}

export async function recognizeCanvas(canvas: HTMLCanvasElement, progressHandler?: ProgressHandler): Promise<string> {
  const worker = await loadOcrWorker(progressHandler);
  const result = await worker.recognize(canvas);
  return result.data.text ?? '';
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerInstance) {
    return;
  }

  const worker = workerInstance;
  workerInstance = null;
  workerPromise = null;

  try {
    await worker.terminate();
  } catch {
    // Ignore termination failures during page teardown.
  }
}
