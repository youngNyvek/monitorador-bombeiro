import { createDefaultRegion } from '../services/region';
import type { AppSettings, RuntimeState } from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
  region: createDefaultRegion(),
  expectedText: '',
  keywordsText: '',
  keywordMode: 'all',
  analysisIntervalMs: 2500,
  requiredConfirmations: 2,
  clearConfirmations: 3,
  minAlertIntervalMs: 10000,
  vibrationEnabled: true,
  soundEnabled: true,
  saveCropImages: false,
  preprocess: {
    scale: 2,
    grayscale: true,
    invert: false,
    threshold: 0,
  },
};

export function createInitialRuntimeState(): RuntimeState {
  return {
    mode: 'idle',
    statusText: 'Pronto.',
    pauseReason: null,
    originMode: null,
    analysisResumeAt: null,
    confirmationCount: 0,
    clearCount: 0,
    lastAnalysisAt: null,
    lastRecognizedText: '',
    alertStartedAt: null,
    alertStoppedAt: null,
    alertDurationMs: null,
    lastAlertFinishedAt: null,
  };
}
