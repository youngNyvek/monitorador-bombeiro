export type KeywordMode = 'all' | 'any';

export type AppMode =
  | 'idle'
  | 'requesting-permission'
  | 'preparing-camera'
  | 'camera-ready'
  | 'loading-ocr'
  | 'ready-to-monitor'
  | 'monitoring'
  | 'analyzing'
  | 'candidate-detected'
  | 'alerting'
  | 'waiting-for-clear'
  | 'paused'
  | 'camera-stopped'
  | 'error';

export type PauseReason = 'manual' | 'background';

export type BannerTone = 'info' | 'warning' | 'danger';

export type HistoryFinalState = 'alerting' | 'waiting-for-clear' | 'monitoring' | 'paused' | 'camera-stopped' | 'error';

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreprocessSettings {
  scale: number;
  grayscale: boolean;
  invert: boolean;
  threshold: number;
}

export interface AppSettings {
  region: RegionRect;
  expectedText: string;
  keywordsText: string;
  keywordMode: KeywordMode;
  analysisIntervalMs: number;
  requiredConfirmations: number;
  clearConfirmations: number;
  minAlertIntervalMs: number;
  vibrationEnabled: boolean;
  soundEnabled: boolean;
  saveCropImages: boolean;
  preprocess: PreprocessSettings;
}

export interface RuntimeState {
  mode: AppMode;
  statusText: string;
  pauseReason: PauseReason | null;
  originMode: Exclude<AppMode, 'analyzing'> | null;
  analysisResumeAt: number | null;
  confirmationCount: number;
  clearCount: number;
  lastAnalysisAt: string | null;
  lastRecognizedText: string;
  alertStartedAt: string | null;
  alertStoppedAt: string | null;
  alertDurationMs: number | null;
  lastAlertFinishedAt: number | null;
}

export interface BannerMessage {
  tone: BannerTone;
  message: string;
}

export interface HistoryRecord {
  id: string;
  detectedAt: string;
  date: string;
  time: string;
  recognizedText: string;
  foundKeywords: string[];
  confirmations: number;
  alertStoppedAt: string | null;
  alertDurationMs: number | null;
  finalState: HistoryFinalState;
  cropId?: string;
}

export interface DetectionComparisonConfig {
  expectedText: string;
  keywords: string[];
  keywordMode: KeywordMode;
}

export interface DetectionComparisonResult {
  matched: boolean;
  mainTextMatched: boolean;
  matchedKeywords: string[];
  missingKeywords: string[];
  normalizedText: string;
  reason: 'matched' | 'config-empty' | 'missing-main-text' | 'missing-keywords';
}
