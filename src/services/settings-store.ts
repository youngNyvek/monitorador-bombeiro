import { DEFAULT_SETTINGS } from '../state/defaults';
import { clampRegion } from './region';
import type { AppSettings, KeywordMode, PreprocessSettings } from '../types';

const SETTINGS_KEY = 'monitorador-bombeiro:settings';

export function loadSettings(): AppSettings {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    return sanitizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function sanitizeSettings(value: unknown): AppSettings {
  const input = isPlainObject(value) ? value : {};
  const preprocessInput = isPlainObject(input.preprocess) ? input.preprocess : {};

  return {
    region: clampRegion(sanitizeRegion(input.region)),
    expectedText: sanitizeString(input.expectedText),
    keywordsText: sanitizeString(input.keywordsText),
    keywordMode: input.keywordMode === 'any' ? 'any' : 'all',
    analysisIntervalMs: clampInteger(input.analysisIntervalMs, 500, 30000, DEFAULT_SETTINGS.analysisIntervalMs),
    requiredConfirmations: clampInteger(input.requiredConfirmations, 1, 10, DEFAULT_SETTINGS.requiredConfirmations),
    clearConfirmations: clampInteger(input.clearConfirmations, 1, 10, DEFAULT_SETTINGS.clearConfirmations),
    minAlertIntervalMs: clampInteger(input.minAlertIntervalMs, 1000, 600000, DEFAULT_SETTINGS.minAlertIntervalMs),
    vibrationEnabled: input.vibrationEnabled !== false,
    soundEnabled: input.soundEnabled !== false,
    saveCropImages: input.saveCropImages === true,
    preprocess: sanitizePreprocess(preprocessInput),
  };
}

export function updateSettings(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return sanitizeSettings({
    ...current,
    ...patch,
    preprocess: {
      ...current.preprocess,
      ...(patch.preprocess ?? {}),
    },
  });
}

function sanitizePreprocess(value: unknown): PreprocessSettings {
  const input = isPlainObject(value) ? value : {};

  return {
    scale: clampInteger(input.scale, 1, 4, DEFAULT_SETTINGS.preprocess.scale),
    grayscale: input.grayscale !== false,
    invert: input.invert === true,
    threshold: clampInteger(input.threshold, 0, 255, DEFAULT_SETTINGS.preprocess.threshold),
  };
}

function sanitizeRegion(value: unknown) {
  if (!isPlainObject(value)) {
    return DEFAULT_SETTINGS.region;
  }

  return {
    x: toNumber(value.x, DEFAULT_SETTINGS.region.x),
    y: toNumber(value.y, DEFAULT_SETTINGS.region.y),
    width: toNumber(value.width, DEFAULT_SETTINGS.region.width),
    height: toNumber(value.height, DEFAULT_SETTINGS.region.height),
  };
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = toNumber(value, fallback);
  const rounded = Math.round(number);
  return Math.min(max, Math.max(min, rounded));
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
