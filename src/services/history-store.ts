import type { HistoryRecord } from '../types';

const HISTORY_KEY = 'monitorador-bombeiro:history';

export function loadHistoryRecords(): HistoryRecord[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => sanitizeHistoryRecord(item))
      .filter((item): item is HistoryRecord => item !== null)
      .sort(sortByDetectedDesc);
  } catch {
    return [];
  }
}

export function saveHistoryRecords(records: HistoryRecord[]): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
}

export function upsertHistoryRecord(records: HistoryRecord[], record: HistoryRecord): HistoryRecord[] {
  const nextRecords = records.filter((item) => item.id !== record.id);
  nextRecords.unshift(record);
  return nextRecords.sort(sortByDetectedDesc);
}

export function updateHistoryRecord(records: HistoryRecord[], id: string, patch: Partial<HistoryRecord>): HistoryRecord[] {
  return records
    .map((record) => (record.id === id ? { ...record, ...patch } : record))
    .sort(sortByDetectedDesc);
}

export function deleteHistoryRecord(records: HistoryRecord[], id: string): HistoryRecord[] {
  return records.filter((record) => record.id !== id);
}

function sanitizeHistoryRecord(value: unknown): HistoryRecord | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const id = sanitizeString(value.id);
  const detectedAt = sanitizeString(value.detectedAt);
  const date = sanitizeString(value.date);
  const time = sanitizeString(value.time);

  if (!id || !detectedAt || !date || !time) {
    return null;
  }

  const finalState = sanitizeFinalState(value.finalState);

  return {
    id,
    detectedAt,
    date,
    time,
    recognizedText: sanitizeString(value.recognizedText),
    foundKeywords: Array.isArray(value.foundKeywords) ? value.foundKeywords.map((item) => sanitizeString(item)).filter(Boolean) : [],
    confirmations: clampInteger(value.confirmations, 0, 20, 0),
    alertStoppedAt: value.alertStoppedAt == null ? null : sanitizeString(value.alertStoppedAt),
    alertDurationMs: value.alertDurationMs == null ? null : clampInteger(value.alertDurationMs, 0, 24 * 60 * 60 * 1000, 0),
    finalState,
    cropId: typeof value.cropId === 'string' && value.cropId.trim().length > 0 ? value.cropId : undefined,
  };
}

function sortByDetectedDesc(left: HistoryRecord, right: HistoryRecord): number {
  return Date.parse(right.detectedAt) - Date.parse(left.detectedAt);
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const rounded = Math.round(number);
  return Math.min(max, Math.max(min, rounded));
}

function sanitizeFinalState(value: unknown): HistoryRecord['finalState'] {
  switch (value) {
    case 'alerting':
    case 'waiting-for-clear':
    case 'monitoring':
    case 'paused':
    case 'camera-stopped':
    case 'error':
      return value;
    default:
      return 'monitoring';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
