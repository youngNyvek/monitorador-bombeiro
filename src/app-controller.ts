import { attachStreamToVideo, isCameraSupported, startRearCamera, stopStream } from './services/camera';
import { captureFrameCanvas } from './services/crop';
import { saveCropBlob, clearCropBlobs, deleteCropBlob, isIndexedDbSupported, getCropBlob } from './services/indexeddb';
import {
  compareRecognitionText,
  parseKeywordsInput,
} from './services/text-compare';
import { AlertAudioService } from './services/audio';
import { VibrationService } from './services/vibration';
import { WakeLockService } from './services/wake-lock';
import { loadSettings, saveSettings, updateSettings } from './services/settings-store';
import {
  clearHistoryRecords as clearHistoryStoreRecords,
  deleteHistoryRecord,
  loadHistoryRecords,
  saveHistoryRecords,
  upsertHistoryRecord,
  updateHistoryRecord,
} from './services/history-store';
import { loadOcrWorker, recognizeCanvas, terminateOcrWorker } from './services/ocr';
import { DEFAULT_SETTINGS, createInitialRuntimeState } from './state/defaults';
import { transitionRuntimeState, type RuntimeEvent } from './state/machine';
import { formatDateKey, formatDateTimeDisplay, formatDurationMs, formatTimeKey, toIsoString } from './utils/time';
import type {
  AppMode,
  AppSettings,
  BannerMessage,
  BannerTone,
  HistoryFinalState,
  HistoryRecord,
  KeywordMode,
  PauseReason,
  RuntimeState,
} from './types';

const ALERT_RECOVERY_MS = 2500;

const HERO_VISIBLE_MODES = new Set<AppMode>(['idle', 'camera-stopped', 'error']);
const STATUS_VISIBLE_MODES = new Set<AppMode>([
  'monitoring',
  'analyzing',
  'candidate-detected',
  'waiting-for-clear',
  'paused',
]);
const CAMERA_PANEL_MODES = new Set<AppMode>([
  'preparing-camera',
  'camera-ready',
  'loading-ocr',
  'ready-to-monitor',
  'monitoring',
  'analyzing',
  'candidate-detected',
  'waiting-for-clear',
  'paused',
]);
const PRE_MONITORING_MODES = new Set<AppMode>([
  'requesting-permission',
  'preparing-camera',
  'camera-ready',
  'loading-ocr',
  'ready-to-monitor',
]);
const MONITORING_CONTROL_MODES = new Set<AppMode>(['monitoring', 'analyzing', 'candidate-detected', 'waiting-for-clear', 'paused']);
const ANALYZABLE_MODES = new Set<AppMode>(['monitoring', 'candidate-detected', 'waiting-for-clear']);

interface AppState {
  runtime: RuntimeState;
  settings: AppSettings;
  history: HistoryRecord[];
  banner: BannerMessage | null;
  historyOpen: boolean;
  historyFilterDate: string;
  preflightChecks: {
    previewTested: boolean;
    alertTested: boolean;
  };
}

interface AppElements {
  root: HTMLElement;
  heroPanel: HTMLElement;
  prepareButton: HTMLButtonElement;
  heroHistoryButton: HTMLButtonElement;
  compatibilityNote: HTMLElement;
  bannerPanel: HTMLElement;
  bannerMessage: HTMLElement;
  statusPanel: HTMLElement;
  modeChip: HTMLElement;
  statusText: HTMLElement;
  lastAnalysisText: HTMLElement;
  lastRecognizedText: HTMLElement;
  confirmationCountText: HTMLElement;
  clearCountText: HTMLElement;
  cameraPanel: HTMLElement;
  cameraResolutionText: HTMLElement;
  videoFrame: HTMLElement;
  cameraVideo: HTMLVideoElement;
  capturePreviewButton: HTMLButtonElement;
  startMonitoringButton: HTMLButtonElement;
  monitoringActions: HTMLElement;
  pauseButton: HTMLButtonElement;
  resumeButton: HTMLButtonElement;
  stopCameraButton: HTMLButtonElement;
  historyToggleButton: HTMLButtonElement;
  previewCanvas: HTMLCanvasElement;
  preflightPanel: HTMLElement;
  preflightPreviewTag: HTMLElement;
  preflightAlertTag: HTMLElement;
  settingsPanel: HTMLElement;
  expectedTextInput: HTMLInputElement;
  keywordsInput: HTMLTextAreaElement;
  keywordModeSelect: HTMLSelectElement;
  analysisIntervalInput: HTMLInputElement;
  requiredConfirmationsInput: HTMLInputElement;
  clearConfirmationsInput: HTMLInputElement;
  minAlertIntervalInput: HTMLInputElement;
  vibrationToggle: HTMLInputElement;
  soundToggle: HTMLInputElement;
  saveCropsToggle: HTMLInputElement;
  preprocessScaleSelect: HTMLSelectElement;
  preprocessGrayscaleToggle: HTMLInputElement;
  preprocessInvertToggle: HTMLInputElement;
  preprocessThresholdInput: HTMLInputElement;
  preprocessThresholdValue: HTMLElement;
  testAlertButton: HTMLButtonElement;
  stopTestAlertButton: HTMLButtonElement;
  historyPanel: HTMLElement;
  historyTotalCount: HTMLElement;
  historyDateFilter: HTMLInputElement;
  clearHistoryButton: HTMLButtonElement;
  historyList: HTMLElement;
  alertShell: HTMLElement;
  alertTitle: HTMLElement;
  alertTimeText: HTMLElement;
  stopAlertButton: HTMLButtonElement;
}

export class AppController {
  private state: AppState;
  private readonly elements: AppElements;
  private readonly audio = new AlertAudioService();
  private readonly vibration = new VibrationService();
  private readonly wakeLock = new WakeLockService();
  private readonly previewContext: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private cameraCleanup: (() => void) | null = null;
  private analysisTimerId: number | null = null;
  private analysisGeneration = 0;
  private startupGeneration = 0;
  private currentAlertRecordId: string | null = null;
  private testAlertActive = false;
  private bannerTimeoutId: number | null = null;
  private cropPreviewUrls = new Set<string>();
  private historyDirty = true;
  private canPrepare = true;
  private cameraStopRequested = false;

  constructor(root: HTMLElement) {
    this.elements = this.queryElements(root);
    this.previewContext = this.elements.previewCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    if (!this.previewContext) {
      throw new Error('preview-canvas-context-unavailable');
    }

    this.state = {
      runtime: createInitialRuntimeState(),
      settings: loadSettings(),
      history: loadHistoryRecords(),
      banner: null,
      historyOpen: false,
      historyFilterDate: '',
      preflightChecks: {
        previewTested: false,
        alertTested: false,
      },
    };

    if (this.state.settings.saveCropImages && !isIndexedDbSupported()) {
      this.state.settings = updateSettings(this.state.settings, { saveCropImages: false });
      this.state.banner = {
        tone: 'warning',
        message: 'O aparelho não conseguiu salvar as imagens do alerta.',
      };
      this.persistSettings();
    }

    this.applyCompatibilityChecks();
    this.bindEvents();
  }

  async start(): Promise<void> {
    this.render();
  }

  private queryElements(root: HTMLElement): AppElements {
    return {
      root,
      heroPanel: this.getElement(root, '#hero-panel'),
      prepareButton: this.getElement(root, '#prepare-button'),
      heroHistoryButton: this.getElement(root, '#hero-history-button'),
      compatibilityNote: this.getElement(root, '#compatibility-note'),
      bannerPanel: this.getElement(root, '#banner-panel'),
      bannerMessage: this.getElement(root, '#banner-message'),
      statusPanel: this.getElement(root, '#status-panel'),
      modeChip: this.getElement(root, '#mode-chip'),
      statusText: this.getElement(root, '#status-text'),
      lastAnalysisText: this.getElement(root, '#last-analysis-text'),
      lastRecognizedText: this.getElement(root, '#last-recognized-text'),
      confirmationCountText: this.getElement(root, '#confirmation-count-text'),
      clearCountText: this.getElement(root, '#clear-count-text'),
      cameraPanel: this.getElement(root, '#camera-panel'),
      cameraResolutionText: this.getElement(root, '#camera-resolution-text'),
      videoFrame: this.getElement(root, '#video-frame'),
      cameraVideo: this.getElement(root, '#camera-video'),
      capturePreviewButton: this.getElement(root, '#capture-preview-button'),
      startMonitoringButton: this.getElement(root, '#start-monitoring-button'),
      monitoringActions: this.getElement(root, '#monitoring-actions'),
      pauseButton: this.getElement(root, '#pause-button'),
      resumeButton: this.getElement(root, '#resume-button'),
      stopCameraButton: this.getElement(root, '#stop-camera-button'),
      historyToggleButton: this.getElement(root, '#history-toggle-button'),
      previewCanvas: this.getElement(root, '#preview-canvas'),
      preflightPanel: this.getElement(root, '#preflight-panel'),
      preflightPreviewTag: this.getElement(root, '#preflight-preview-tag'),
      preflightAlertTag: this.getElement(root, '#preflight-alert-tag'),
      settingsPanel: this.getElement(root, '#settings-panel'),
      expectedTextInput: this.getElement(root, '#expected-text-input'),
      keywordsInput: this.getElement(root, '#keywords-input'),
      keywordModeSelect: this.getElement(root, '#keyword-mode-select'),
      analysisIntervalInput: this.getElement(root, '#analysis-interval-input'),
      requiredConfirmationsInput: this.getElement(root, '#required-confirmations-input'),
      clearConfirmationsInput: this.getElement(root, '#clear-confirmations-input'),
      minAlertIntervalInput: this.getElement(root, '#min-alert-interval-input'),
      vibrationToggle: this.getElement(root, '#vibration-toggle'),
      soundToggle: this.getElement(root, '#sound-toggle'),
      saveCropsToggle: this.getElement(root, '#save-crops-toggle'),
      preprocessScaleSelect: this.getElement(root, '#preprocess-scale-select'),
      preprocessGrayscaleToggle: this.getElement(root, '#preprocess-grayscale-toggle'),
      preprocessInvertToggle: this.getElement(root, '#preprocess-invert-toggle'),
      preprocessThresholdInput: this.getElement(root, '#preprocess-threshold-input'),
      preprocessThresholdValue: this.getElement(root, '#preprocess-threshold-value'),
      testAlertButton: this.getElement(root, '#test-alert-button'),
      stopTestAlertButton: this.getElement(root, '#stop-test-alert-button'),
      historyPanel: this.getElement(root, '#history-panel'),
      historyTotalCount: this.getElement(root, '#history-total-count'),
      historyDateFilter: this.getElement(root, '#history-date-filter'),
      clearHistoryButton: this.getElement(root, '#clear-history-button'),
      historyList: this.getElement(root, '#history-list'),
      alertShell: this.getElement(root, '#alert-shell'),
      alertTitle: this.getElement(root, '#alert-title'),
      alertTimeText: this.getElement(root, '#alert-time-text'),
      stopAlertButton: this.getElement(root, '#stop-alert-button'),
    };
  }

  private getElement<T extends HTMLElement>(root: HTMLElement, selector: string): T {
    const element = root.querySelector(selector);
    if (!element) {
      throw new Error(`Missing element: ${selector}`);
    }

    return element as T;
  }

  private bindEvents(): void {
    this.elements.prepareButton.addEventListener('click', () => {
      void this.prepareMonitoring();
    });

    this.elements.heroHistoryButton.addEventListener('click', () => {
      this.toggleHistoryPanel();
    });

    this.elements.historyToggleButton.addEventListener('click', () => {
      this.toggleHistoryPanel();
    });

    this.elements.capturePreviewButton.addEventListener('click', () => {
      void this.capturePreview();
    });

    this.elements.startMonitoringButton.addEventListener('click', () => {
      void this.startMonitoring();
    });

    this.elements.pauseButton.addEventListener('click', () => {
      void this.pauseMonitoring('manual');
    });

    this.elements.resumeButton.addEventListener('click', () => {
      void this.resumeMonitoring();
    });

    this.elements.stopCameraButton.addEventListener('click', () => {
      void this.stopCamera();
    });

    this.elements.testAlertButton.addEventListener('click', () => {
      void this.startTestAlert();
    });

    this.elements.stopTestAlertButton.addEventListener('click', () => {
      this.stopTestAlert();
    });

    this.elements.stopAlertButton.addEventListener('click', () => {
      void this.stopAlert();
    });

    this.elements.clearHistoryButton.addEventListener('click', () => {
      void this.clearHistory();
    });

    this.elements.historyDateFilter.addEventListener('change', () => {
      this.state.historyFilterDate = this.elements.historyDateFilter.value;
      this.historyDirty = true;
      this.render();
    });

    this.elements.expectedTextInput.addEventListener('input', () => {
      this.applySettingsPatch({ expectedText: this.elements.expectedTextInput.value });
    });

    this.elements.keywordsInput.addEventListener('input', () => {
      this.applySettingsPatch({ keywordsText: this.elements.keywordsInput.value });
    });

    this.elements.keywordModeSelect.addEventListener('change', () => {
      const keywordMode = this.elements.keywordModeSelect.value === 'any' ? 'any' : 'all';
      this.applySettingsPatch({ keywordMode });
    });

    this.elements.analysisIntervalInput.addEventListener('input', () => {
      this.applySettingsPatch({ analysisIntervalMs: toInteger(this.elements.analysisIntervalInput.value, DEFAULT_SETTINGS.analysisIntervalMs) });
    });

    this.elements.requiredConfirmationsInput.addEventListener('input', () => {
      this.applySettingsPatch({ requiredConfirmations: toInteger(this.elements.requiredConfirmationsInput.value, DEFAULT_SETTINGS.requiredConfirmations) });
    });

    this.elements.clearConfirmationsInput.addEventListener('input', () => {
      this.applySettingsPatch({ clearConfirmations: toInteger(this.elements.clearConfirmationsInput.value, DEFAULT_SETTINGS.clearConfirmations) });
    });

    this.elements.minAlertIntervalInput.addEventListener('input', () => {
      this.applySettingsPatch({ minAlertIntervalMs: toInteger(this.elements.minAlertIntervalInput.value, DEFAULT_SETTINGS.minAlertIntervalMs) });
    });

    this.elements.vibrationToggle.addEventListener('change', () => {
      this.applySettingsPatch({ vibrationEnabled: this.elements.vibrationToggle.checked });
    });

    this.elements.soundToggle.addEventListener('change', () => {
      this.applySettingsPatch({ soundEnabled: this.elements.soundToggle.checked });
    });

    this.elements.saveCropsToggle.addEventListener('change', () => {
      this.applySettingsPatch({ saveCropImages: this.elements.saveCropsToggle.checked });
    });

    this.elements.preprocessScaleSelect.addEventListener('change', () => {
      this.applySettingsPatch({ preprocess: { ...this.state.settings.preprocess, scale: toInteger(this.elements.preprocessScaleSelect.value, DEFAULT_SETTINGS.preprocess.scale) } });
    });

    this.elements.preprocessGrayscaleToggle.addEventListener('change', () => {
      this.applySettingsPatch({ preprocess: { ...this.state.settings.preprocess, grayscale: this.elements.preprocessGrayscaleToggle.checked } });
    });

    this.elements.preprocessInvertToggle.addEventListener('change', () => {
      this.applySettingsPatch({ preprocess: { ...this.state.settings.preprocess, invert: this.elements.preprocessInvertToggle.checked } });
    });

    this.elements.preprocessThresholdInput.addEventListener('input', () => {
      const threshold = toInteger(this.elements.preprocessThresholdInput.value, DEFAULT_SETTINGS.preprocess.threshold);
      this.applySettingsPatch({ preprocess: { ...this.state.settings.preprocess, threshold } });
    });

    document.addEventListener('visibilitychange', () => {
      void this.handleVisibilityChange();
    });

    window.addEventListener('pagehide', () => {
      void this.cleanupForPageHide();
    });

    window.addEventListener('beforeunload', () => {
      void this.cleanupForPageHide();
    });
  }

  private applyCompatibilityChecks(): void {
    this.canPrepare = window.isSecureContext && isCameraSupported();

    if (!window.isSecureContext) {
      this.state.runtime = transitionRuntimeState(this.state.runtime, {
        type: 'error',
        message: 'Abra a página em conexão segura para usar a câmera.',
      });
      this.state.banner = {
        tone: 'danger',
        message: 'Abra a página em conexão segura para usar a câmera.',
      };
      this.canPrepare = false;
    } else if (!isCameraSupported()) {
      this.state.runtime = transitionRuntimeState(this.state.runtime, {
        type: 'error',
        message: 'Este navegador não consegue abrir a câmera.',
      });
      this.state.banner = {
        tone: 'danger',
        message: 'Este navegador não consegue abrir a câmera.',
      };
      this.canPrepare = false;
    }
  }

  private applySettingsPatch(patch: Partial<AppSettings>): void {
    this.state.settings = updateSettings(this.state.settings, patch);
    this.resetPreflightChecks();

    if (this.state.settings.saveCropImages && !isIndexedDbSupported()) {
      this.state.settings = updateSettings(this.state.settings, { saveCropImages: false });
      this.setBanner('O aparelho não conseguiu salvar as imagens do alerta.', 'warning');
    }

    this.persistSettings();
    this.render();

    if (this.isAnalyzableMode(this.state.runtime.mode) && this.state.runtime.analysisResumeAt !== null) {
      this.state.runtime.analysisResumeAt = Date.now() + this.state.settings.analysisIntervalMs;
      this.syncAnalysisLoop();
    }
  }

  private persistSettings(): void {
    try {
      saveSettings(this.state.settings);
    } catch {
      this.setBanner('Não foi possível salvar as configurações.', 'warning');
    }
  }

  private persistHistory(): void {
    try {
      saveHistoryRecords(this.state.history);
    } catch {
      this.setBanner('Não foi possível salvar o histórico. Verifique o espaço do aparelho.', 'warning');
    }
  }

  private resetPreflightChecks(): void {
    this.state.preflightChecks.previewTested = false;
    this.state.preflightChecks.alertTested = false;
  }

  private hasCompletedPreflightChecks(): boolean {
    return this.state.preflightChecks.previewTested && this.state.preflightChecks.alertTested;
  }

  private canStartMonitoring(): boolean {
    return this.state.runtime.mode === 'ready-to-monitor' && this.stream !== null && this.hasCompletedPreflightChecks();
  }

  private updateRuntime(event: RuntimeEvent): RuntimeState {
    this.state.runtime = transitionRuntimeState(this.state.runtime, event);
    return this.state.runtime;
  }

  private render(): void {
    const mode = this.state.runtime.mode;
    document.body.dataset.mode = mode;
    this.elements.root.dataset.mode = mode;

    this.elements.heroPanel.hidden = !HERO_VISIBLE_MODES.has(mode);
    this.elements.bannerPanel.hidden = !this.state.banner;
    this.elements.statusPanel.hidden = !STATUS_VISIBLE_MODES.has(mode);
    this.elements.cameraPanel.hidden = !CAMERA_PANEL_MODES.has(mode);
    this.elements.preflightPanel.hidden = mode !== 'ready-to-monitor';
    this.elements.settingsPanel.hidden = !HERO_VISIBLE_MODES.has(mode);
    this.elements.alertShell.hidden = mode !== 'alerting';
    this.elements.historyPanel.hidden = !this.state.historyOpen || mode === 'alerting';

    this.elements.bannerPanel.dataset.tone = this.state.banner?.tone ?? '';
    this.elements.bannerMessage.textContent = this.state.banner?.message ?? '';

    this.elements.prepareButton.textContent = mode === 'error' ? 'Tentar novamente' : 'Preparar câmera';
    this.elements.prepareButton.disabled = !this.canPrepare || mode === 'requesting-permission' || mode === 'preparing-camera' || mode === 'loading-ocr';

    const historyButtonLabel = this.state.historyOpen ? 'Fechar histórico' : 'Histórico';
    this.elements.heroHistoryButton.textContent = historyButtonLabel;
    this.elements.historyToggleButton.textContent = historyButtonLabel;

    this.elements.modeChip.textContent = modeLabel(mode);
    this.elements.modeChip.dataset.mode = mode;
    this.elements.statusText.textContent = this.state.runtime.statusText;
    this.elements.lastAnalysisText.textContent = this.state.runtime.lastAnalysisAt ? formatDateTimeDisplay(this.state.runtime.lastAnalysisAt) : '-';
    this.elements.lastRecognizedText.textContent = this.state.runtime.lastRecognizedText || '-';
    this.elements.confirmationCountText.textContent = `${this.state.runtime.confirmationCount}/${this.state.settings.requiredConfirmations}`;
    this.elements.clearCountText.textContent = `${this.state.runtime.clearCount}/${this.state.settings.clearConfirmations}`;

    this.elements.cameraResolutionText.textContent = this.describeCameraResolution();
    this.elements.capturePreviewButton.hidden = mode !== 'ready-to-monitor';
    this.elements.testAlertButton.hidden = mode !== 'ready-to-monitor';
    this.elements.startMonitoringButton.hidden = mode !== 'ready-to-monitor';
    this.elements.startMonitoringButton.disabled = !this.canStartMonitoring();
    this.elements.monitoringActions.hidden = !MONITORING_CONTROL_MODES.has(mode);
    this.elements.preflightPreviewTag.dataset.state = this.state.preflightChecks.previewTested ? 'done' : 'pending';
    this.elements.preflightPreviewTag.textContent = this.state.preflightChecks.previewTested ? 'Leitura OK' : 'Leitura pendente';
    this.elements.preflightAlertTag.dataset.state = this.state.preflightChecks.alertTested ? 'done' : 'pending';
    this.elements.preflightAlertTag.textContent = this.state.preflightChecks.alertTested ? 'Alarme OK' : 'Alarme pendente';
    this.elements.pauseButton.hidden = !MONITORING_CONTROL_MODES.has(mode) || mode === 'paused';
    this.elements.resumeButton.hidden = mode !== 'paused';
    this.elements.stopCameraButton.hidden = !MONITORING_CONTROL_MODES.has(mode);
    this.elements.historyToggleButton.hidden = !MONITORING_CONTROL_MODES.has(mode);
    this.elements.stopTestAlertButton.hidden = !this.testAlertActive;

    this.syncSettingsForm();
    this.syncAlertPanel();
    this.syncHistoryPanel();

    const noteParts = [
      mode === 'ready-to-monitor'
        ? 'Faça os dois testes abaixo antes de iniciar.'
        : 'A câmera traseira observa a tela inteira e tudo acontece no aparelho.',
      this.canPrepare ? 'Mantenha a tela ligada durante o uso.' : 'Abra a página em conexão segura para usar a câmera.',
    ];
    this.elements.compatibilityNote.textContent = noteParts.join(' ');

    if (this.state.historyOpen && !this.elements.historyPanel.hidden && this.state.history.length === 0) {
      this.historyDirty = true;
      this.renderHistoryList();
    } else if (this.historyDirty && this.state.historyOpen && !this.elements.historyPanel.hidden) {
      this.renderHistoryList();
    }
  }

  private syncSettingsForm(): void {
    const settings = this.state.settings;

    this.elements.expectedTextInput.value = settings.expectedText;
    this.elements.keywordsInput.value = settings.keywordsText;
    this.elements.keywordModeSelect.value = settings.keywordMode;
    this.elements.analysisIntervalInput.value = String(settings.analysisIntervalMs);
    this.elements.requiredConfirmationsInput.value = String(settings.requiredConfirmations);
    this.elements.clearConfirmationsInput.value = String(settings.clearConfirmations);
    this.elements.minAlertIntervalInput.value = String(settings.minAlertIntervalMs);
    this.elements.vibrationToggle.checked = settings.vibrationEnabled;
    this.elements.soundToggle.checked = settings.soundEnabled;
    this.elements.saveCropsToggle.checked = settings.saveCropImages;
    this.elements.preprocessScaleSelect.value = String(settings.preprocess.scale);
    this.elements.preprocessGrayscaleToggle.checked = settings.preprocess.grayscale;
    this.elements.preprocessInvertToggle.checked = settings.preprocess.invert;
    this.elements.preprocessThresholdInput.value = String(settings.preprocess.threshold);
    this.elements.preprocessThresholdValue.textContent = String(settings.preprocess.threshold);

    if (this.state.historyFilterDate !== this.elements.historyDateFilter.value) {
      this.elements.historyDateFilter.value = this.state.historyFilterDate;
    }
  }

  private syncAlertPanel(): void {
    if (this.state.runtime.mode !== 'alerting') {
      return;
    }

    this.elements.alertTitle.textContent = 'Notificação detectada';
    this.elements.alertTimeText.textContent = this.state.runtime.alertStartedAt
      ? `Detectado em ${formatDateTimeDisplay(this.state.runtime.alertStartedAt)}`
      : 'Alerta em andamento.';
  }

  private syncHistoryPanel(): void {
    const totalCount = this.state.history.length;
    const visibleCount = this.getFilteredHistory().length;
    this.elements.historyTotalCount.textContent = totalCount === visibleCount
      ? `${totalCount} detecções`
      : `${visibleCount} de ${totalCount} detecções`;
  }

  private syncAnalysisLoop(): void {
    if (this.analysisTimerId !== null) {
      window.clearTimeout(this.analysisTimerId);
      this.analysisTimerId = null;
    }

    if (!this.isAnalyzableMode(this.state.runtime.mode) || this.state.runtime.analysisResumeAt === null) {
      return;
    }

    const delayMs = Math.max(0, this.state.runtime.analysisResumeAt - Date.now());
    this.analysisTimerId = window.setTimeout(() => {
      void this.runAnalysisCycle();
    }, delayMs);
  }

  private cancelAnalysisLoop(): void {
    this.analysisGeneration += 1;
    if (this.analysisTimerId !== null) {
      window.clearTimeout(this.analysisTimerId);
      this.analysisTimerId = null;
    }
  }

  private async prepareMonitoring(): Promise<void> {
    if (!this.canPrepare) {
      this.setBanner('Não foi possível usar a câmera neste aparelho.', 'warning');
      return;
    }

    this.clearBanner();
    this.cancelAnalysisLoop();
    this.startupGeneration += 1;
    const generation = this.startupGeneration;

    this.audio.stopTone();
    this.testAlertActive = false;
    this.vibration.stop();
    await this.wakeLock.release();

    this.stopCameraResources();

    this.updateRuntime({ type: 'prepare-requested' });
    this.render();

    if (!isCameraSupported()) {
      this.handleFatalError('Este aparelho não consegue abrir a câmera.');
      return;
    }

    try {
      this.updateRuntime({ type: 'camera-started' });
      this.render();

      const stream = await startRearCamera();
      if (generation !== this.startupGeneration) {
        stopStream(stream);
        return;
      }

      this.stream = stream;
      this.attachStreamListeners(stream);

      const metadata = await attachStreamToVideo(this.elements.cameraVideo, stream);
      if (generation !== this.startupGeneration) {
        this.stopCameraResources();
        return;
      }

      this.cameraStopRequested = false;
      this.cameraResolutionText(textForResolution(metadata.width, metadata.height));
      this.elements.videoFrame.style.aspectRatio = `${metadata.width} / ${metadata.height}`;
      this.updateRuntime({ type: 'camera-ready' });
      this.render();

      this.updateRuntime({ type: 'ocr-loading' });
      this.render();

      try {
        await this.audio.prepare();
      } catch {
        this.setBanner('O som do alerta pode não funcionar agora.', 'warning');
      }

      const wakeLockResult = await this.wakeLock.request();
      if (!wakeLockResult.supported) {
        this.setBanner('A tela pode desligar sozinha.', 'warning');
      } else if (!wakeLockResult.ok) {
        this.setBanner('Não foi possível manter a tela ligada.', 'warning');
      }

      await loadOcrWorker();
      if (generation !== this.startupGeneration) {
        return;
      }

      this.resetPreflightChecks();
      this.state.historyOpen = false;
      this.updateRuntime({ type: 'ocr-ready' });
      this.render();
      this.setBanner('Faça a leitura e o alarme de teste antes de iniciar.', 'info', 4000);
    } catch (error) {
      if (generation !== this.startupGeneration) {
        return;
      }

      this.handleFatalError(describeSetupError(error));
    }
  }

  private async startMonitoring(): Promise<void> {
    if (!this.canStartMonitoring()) {
      this.setBanner('Faça os testes de leitura e alarme antes de iniciar.', 'warning');
      return;
    }

    this.clearBanner();
    this.audio.stopTone();
    this.testAlertActive = false;
    this.vibration.stop();
    this.cancelAnalysisLoop();

    const wakeLockResult = await this.wakeLock.request();
    if (!wakeLockResult.supported) {
      this.setBanner('A tela pode desligar sozinha.', 'warning');
    } else if (!wakeLockResult.ok) {
      this.setBanner('Não foi possível manter a tela ligada.', 'warning');
    }

    this.updateRuntime({
      type: 'monitoring-started',
      now: Date.now(),
      analysisIntervalMs: this.state.settings.analysisIntervalMs,
    });
    this.render();
    this.syncAnalysisLoop();
  }

  private async runAnalysisCycle(): Promise<void> {
    if (!this.isAnalyzableMode(this.state.runtime.mode) || !this.stream) {
      return;
    }

    const generation = ++this.analysisGeneration;
    const originMode = this.state.runtime.mode;

    this.updateRuntime({ type: 'analysis-started' });
    this.render();

    try {
      const captureCanvas = captureFrameCanvas(this.elements.cameraVideo, this.state.settings.preprocess);
      const recognizedText = await recognizeCanvas(captureCanvas);

      if (generation !== this.analysisGeneration) {
        return;
      }

      const keywords = parseKeywordsInput(this.state.settings.keywordsText);
      const comparison = compareRecognitionText(recognizedText, {
        expectedText: this.state.settings.expectedText,
        keywords,
        keywordMode: this.state.settings.keywordMode,
      });

      const nextRuntime = this.updateRuntime({
        type: 'analysis-result',
        now: Date.now(),
        recognizedText: recognizedText.trim(),
        matched: comparison.matched,
        matchedKeywords: comparison.matchedKeywords,
        requiredConfirmations: this.state.settings.requiredConfirmations,
        clearConfirmations: this.state.settings.clearConfirmations,
        analysisIntervalMs: this.state.settings.analysisIntervalMs,
        minAlertIntervalMs: this.state.settings.minAlertIntervalMs,
      });

      this.render();

      if (originMode !== 'waiting-for-clear' && nextRuntime.mode === 'alerting') {
        await this.startAlert(captureCanvas, comparison.matchedKeywords);
      } else if (originMode === 'waiting-for-clear' && nextRuntime.mode === 'monitoring') {
        this.finalizeHistoryRecord('monitoring');
      }
    } catch (error) {
      if (generation !== this.analysisGeneration) {
        return;
      }

      await this.handleAnalysisFailure(error);
      return;
    } finally {
      if (generation === this.analysisGeneration) {
        this.syncAnalysisLoop();
      }
    }
  }

  private async startAlert(captureCanvas: HTMLCanvasElement, matchedKeywords: string[]): Promise<void> {
    this.cancelAnalysisLoop();
    const now = Date.now();
    const detectedAt = this.state.runtime.alertStartedAt ?? toIsoString(now);
    const recordId = createDetectionId();
    this.currentAlertRecordId = recordId;

    const historyRecord: HistoryRecord = {
      id: recordId,
      detectedAt,
      date: formatDateKey(new Date(detectedAt)),
      time: formatTimeKey(new Date(detectedAt)),
      recognizedText: this.state.runtime.lastRecognizedText,
      foundKeywords: matchedKeywords,
      confirmations: this.state.runtime.confirmationCount,
      alertStoppedAt: null,
      alertDurationMs: null,
      finalState: 'alerting',
      cropId: undefined,
    };

    if (this.state.settings.saveCropImages) {
      try {
        const blob = await canvasToBlob(captureCanvas);
        await saveCropBlob(recordId, blob);
        historyRecord.cropId = recordId;
      } catch {
      this.setBanner('Não foi possível salvar a imagem do alerta.', 'warning');
        this.state.settings = updateSettings(this.state.settings, { saveCropImages: false });
        this.persistSettings();
      }
    }

    this.state.history = upsertHistoryRecord(this.state.history, historyRecord);
    this.historyDirty = true;
    this.persistHistory();

    this.testAlertActive = false;
    this.audio.stopTone();

    if (this.state.settings.soundEnabled) {
      try {
        await this.audio.playTone();
      } catch {
        this.setBanner('Não foi possível tocar o alerta.', 'warning');
      }
    }

    if (this.state.settings.vibrationEnabled) {
      if (!this.vibration.startLoop()) {
        this.setBanner('A vibração não está disponível.', 'warning');
      }
    }

    this.render();
  }

  private async stopAlert(): Promise<void> {
    if (this.state.runtime.mode !== 'alerting') {
      return;
    }

    this.cancelAnalysisLoop();
    this.audio.stopTone();
    this.vibration.stop();
    this.testAlertActive = false;

    const now = Date.now();
    const previousRuntime = this.state.runtime;
    this.updateRuntime({
      type: 'alert-stopped',
      now,
      recoveryMs: ALERT_RECOVERY_MS,
    });

    this.render();
    this.updateOpenHistoryRecord({
      alertStoppedAt: toIsoString(now),
      alertDurationMs: previousRuntime.alertStartedAt ? Math.max(0, now - Date.parse(previousRuntime.alertStartedAt)) : null,
      finalState: 'waiting-for-clear',
    });
    this.persistHistory();
    this.syncAnalysisLoop();
  }

  private async pauseMonitoring(reason: PauseReason): Promise<void> {
    if (this.state.runtime.mode === 'idle' || this.state.runtime.mode === 'camera-stopped' || this.state.runtime.mode === 'error') {
      return;
    }

    this.startupGeneration += 1;
    const previousRuntime = this.state.runtime;
    this.cancelAnalysisLoop();
    this.audio.stopTone();
    this.vibration.stop();
    this.testAlertActive = false;
    await this.wakeLock.release();

    const now = Date.now();
    const alertWasActive = this.state.runtime.mode === 'alerting' || this.state.runtime.mode === 'waiting-for-clear' || this.state.runtime.mode === 'analyzing';
    this.updateRuntime({
      type: 'pause-requested',
      now,
      reason,
    });

    this.render();
    if (alertWasActive) {
      this.updateOpenHistoryRecord({
        alertStoppedAt: this.findHistoryRecord(this.currentAlertRecordId)?.alertStoppedAt ?? toIsoString(now),
        alertDurationMs: this.findHistoryRecord(this.currentAlertRecordId)?.alertDurationMs ?? (previousRuntime.alertStartedAt ? Math.max(0, now - Date.parse(previousRuntime.alertStartedAt)) : null),
        finalState: 'paused',
      });
      this.persistHistory();
    }

    if (reason === 'background') {
      this.setBanner('O monitoramento foi pausado porque a aba ficou em segundo plano.', 'warning');
    }
  }

  private async resumeMonitoring(): Promise<void> {
    if (this.state.runtime.mode !== 'paused') {
      return;
    }

    if (!this.stream) {
      this.setBanner('A câmera não está disponível. Prepare de novo.', 'warning');
      return;
    }

    this.cancelAnalysisLoop();
    const wakeLockResult = await this.wakeLock.request();
    if (!wakeLockResult.supported) {
      this.setBanner('Não foi possível manter a tela ligada.', 'warning');
    } else if (!wakeLockResult.ok) {
      this.setBanner('Não foi possível manter a tela ligada.', 'warning');
    }

    this.updateRuntime({
      type: 'resume-requested',
      now: Date.now(),
      analysisIntervalMs: this.state.settings.analysisIntervalMs,
    });
    this.render();
    this.syncAnalysisLoop();
  }

  private async stopCamera(): Promise<void> {
    this.startupGeneration += 1;
    this.cancelAnalysisLoop();
    this.audio.stopTone();
    this.vibration.stop();
    this.testAlertActive = false;
    await this.wakeLock.release();

    const now = Date.now();
    const previousRuntime = this.state.runtime;
    this.stopCameraResources();
    this.updateOpenHistoryRecord({
      alertStoppedAt: this.findHistoryRecord(this.currentAlertRecordId)?.alertStoppedAt ?? toIsoString(now),
      alertDurationMs: this.findHistoryRecord(this.currentAlertRecordId)?.alertDurationMs ?? (previousRuntime.alertStartedAt ? Math.max(0, now - Date.parse(previousRuntime.alertStartedAt)) : null),
      finalState: 'camera-stopped',
    });
    this.persistHistory();

    this.updateRuntime({ type: 'camera-stopped' });
    this.render();
    this.setBanner('A câmera foi encerrada.', 'info');
  }

  private stopCameraResources(): void {
    this.cameraStopRequested = true;
    if (this.cameraCleanup) {
      this.cameraCleanup();
      this.cameraCleanup = null;
    }

    if (this.stream) {
      stopStream(this.stream);
      this.stream = null;
    }

    this.elements.cameraVideo.srcObject = null;
    this.cameraResolutionText('Câmera encerrada.');
    this.elements.videoFrame.style.aspectRatio = '4 / 3';
    this.cameraStopRequested = true;
    this.resetPreflightChecks();
  }

  private attachStreamListeners(stream: MediaStream): void {
    const handleEnded = () => {
      if (this.cameraStopRequested) {
        return;
      }

      void this.handleCameraInterrupted();
    };

    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', handleEnded);
      track.addEventListener('mute', handleEnded);
    }

    this.cameraCleanup = () => {
      for (const track of stream.getVideoTracks()) {
        track.removeEventListener('ended', handleEnded);
        track.removeEventListener('mute', handleEnded);
      }
    };
  }

  private async handleCameraInterrupted(): Promise<void> {
    this.startupGeneration += 1;
    this.cancelAnalysisLoop();
    this.audio.stopTone();
    this.vibration.stop();
    this.testAlertActive = false;
    await this.wakeLock.release();

    const now = Date.now();
    const previousRuntime = this.state.runtime;
    this.updateOpenHistoryRecord({
      alertStoppedAt: this.findHistoryRecord(this.currentAlertRecordId)?.alertStoppedAt ?? toIsoString(now),
      alertDurationMs: this.findHistoryRecord(this.currentAlertRecordId)?.alertDurationMs ?? (previousRuntime.alertStartedAt ? Math.max(0, now - Date.parse(previousRuntime.alertStartedAt)) : null),
      finalState: 'camera-stopped',
    });
    this.persistHistory();

    this.stopCameraResources();
    this.updateRuntime({ type: 'camera-stopped' });
    this.render();
    this.setBanner('A câmera foi interrompida. Toque em "Preparar monitoramento" para tentar novamente.', 'warning');
  }

  private async handleFatalError(message: string): Promise<void> {
    this.startupGeneration += 1;
    this.cancelAnalysisLoop();
    this.audio.stopTone();
    this.vibration.stop();
    this.testAlertActive = false;
    await this.wakeLock.release();

    try {
      await terminateOcrWorker();
    } catch {
      // ignore
    }

    const now = Date.now();
    const previousRuntime = this.state.runtime;
    this.updateOpenHistoryRecord({
      alertStoppedAt: this.findHistoryRecord(this.currentAlertRecordId)?.alertStoppedAt ?? toIsoString(now),
      alertDurationMs: this.findHistoryRecord(this.currentAlertRecordId)?.alertDurationMs ?? (previousRuntime.alertStartedAt ? Math.max(0, now - Date.parse(previousRuntime.alertStartedAt)) : null),
      finalState: 'error',
    });
    this.persistHistory();

    this.stopCameraResources();
    this.updateRuntime({ type: 'error', message });
    this.render();
    this.setBanner(message, 'danger');
  }

  private async handleAnalysisFailure(error: unknown): Promise<void> {
    const message = error instanceof Error && error.message.includes('video-not-ready')
      ? 'A câmera ainda não está pronta.'
      : 'Não foi possível ler a imagem da câmera. O monitoramento será encerrado.';

    await this.handleFatalError(message);
  }

  private async startTestAlert(): Promise<void> {
    if (this.state.runtime.mode === 'alerting') {
      return;
    }

    try {
      await this.audio.playTestTone();
      this.testAlertActive = true;
      this.state.preflightChecks.alertTested = true;
      this.setBanner('Teste de alerta tocando. Toque em "Parar teste" quando quiser.', 'info');
      this.render();
    } catch {
      this.setBanner('Não foi possível tocar o teste.', 'warning');
    }
  }

  private stopTestAlert(): void {
    if (!this.testAlertActive) {
      return;
    }

    this.audio.stopTone();
    this.testAlertActive = false;
    this.render();
    this.setBanner('Teste de alerta interrompido.', 'info', 2500);
  }

  private async capturePreview(): Promise<void> {
    if (!this.stream) {
      this.setBanner('A câmera ainda não está pronta.', 'warning');
      return;
    }

    try {
      const canvas = captureFrameCanvas(this.elements.cameraVideo, this.state.settings.preprocess);
      this.previewCanvasResize(canvas.width, canvas.height);
      this.previewContext.clearRect(0, 0, this.elements.previewCanvas.width, this.elements.previewCanvas.height);
      this.previewContext.drawImage(canvas, 0, 0);
      this.state.preflightChecks.previewTested = true;
      this.setBanner('Prévia atualizada.', 'info', 2500);
    } catch {
      this.setBanner('Não foi possível testar a imagem da câmera.', 'warning');
    }
  }

  private previewCanvasResize(width: number, height: number): void {
    this.elements.previewCanvas.width = Math.max(1, width);
    this.elements.previewCanvas.height = Math.max(1, height);
  }

  private toggleHistoryPanel(): void {
    this.state.historyOpen = !this.state.historyOpen;
    this.historyDirty = true;
    this.render();
  }

  private async clearHistory(): Promise<void> {
    const confirmed = window.confirm('Tem certeza de que deseja limpar todo o histórico local?');
    if (!confirmed) {
      return;
    }

    this.state.history = [];
    this.currentAlertRecordId = null;
    this.historyDirty = true;
    this.persistHistory();

    try {
      await clearCropBlobs();
    } catch {
      // ignore crop cleanup failures
    }

    this.render();
      this.setBanner('Histórico limpo.', 'info', 2500);
  }

  private async handleVisibilityChange(): Promise<void> {
    if (document.hidden) {
      if (PRE_MONITORING_MODES.has(this.state.runtime.mode)) {
        await this.stopCamera();
        return;
      }

      if (this.isSessionActive()) {
        await this.pauseMonitoring('background');
      }
      return;
    }

    if (this.state.runtime.mode === 'paused' && this.state.runtime.pauseReason === 'background') {
      this.setBanner('A aba voltou. Toque em "Retomar monitoramento" para continuar.', 'warning');
    }

    if (this.isAnalyzableMode(this.state.runtime.mode)) {
      const wakeLockResult = await this.wakeLock.request();
      if (!wakeLockResult.ok && wakeLockResult.supported) {
      this.setBanner('Não foi possível manter a tela ligada.', 'warning');
      }
    }
  }

  private async cleanupForPageHide(): Promise<void> {
    this.startupGeneration += 1;
    this.cancelAnalysisLoop();
    this.audio.stopTone();
    this.vibration.stop();
    this.testAlertActive = false;
    await this.wakeLock.release();
    if (this.currentAlertRecordId) {
      const now = Date.now();
      const record = this.findHistoryRecord(this.currentAlertRecordId);
      if (record) {
        this.state.history = updateHistoryRecord(this.state.history, record.id, {
          alertStoppedAt: record.alertStoppedAt ?? toIsoString(now),
          alertDurationMs: record.alertDurationMs ?? (record.detectedAt ? Math.max(0, now - Date.parse(record.detectedAt)) : null),
          finalState: 'camera-stopped',
        });
        this.persistHistory();
      }
      this.currentAlertRecordId = null;
    }
    this.stopCameraResources();
  }

  private isAnalyzableMode(mode: AppMode): boolean {
    return ANALYZABLE_MODES.has(mode);
  }

  private isCameraVisibleMode(mode: AppMode): boolean {
    return CAMERA_PANEL_MODES.has(mode);
  }

  private isSessionActive(): boolean {
    return this.state.runtime.mode === 'requesting-permission' || this.state.runtime.mode === 'alerting' || (CAMERA_PANEL_MODES.has(this.state.runtime.mode) && this.state.runtime.mode !== 'paused');
  }

  private describeCameraResolution(): string {
    if (this.state.runtime.mode === 'camera-stopped') {
      return 'Câmera encerrada.';
    }

    if (this.state.runtime.mode === 'ready-to-monitor') {
      return this.cameraResolution ? `Câmera pronta • ${this.cameraResolution.width}×${this.cameraResolution.height}` : 'Pronta para iniciar.';
    }

    if (this.state.runtime.mode === 'requesting-permission') {
      return 'Pedindo acesso à câmera...';
    }

    if (this.state.runtime.mode === 'preparing-camera') {
      return 'Preparando a câmera...';
    }

    if (this.state.runtime.mode === 'camera-ready') {
      return this.cameraResolution ? `Câmera pronta • ${this.cameraResolution.width}×${this.cameraResolution.height}` : 'Câmera pronta.';
    }

    if (this.state.runtime.mode === 'loading-ocr') {
      return 'Carregando a leitura...';
    }

    if (this.cameraResolution) {
      return `Câmera ativa • ${this.cameraResolution.width}×${this.cameraResolution.height}`;
    }

    return 'Aguardando câmera.';
  }

  private cameraResolutionText(message: string): void {
    this.elements.cameraResolutionText.textContent = message;
  }

  private setBanner(message: string, tone: BannerTone = 'info', autoClearMs?: number): void {
    this.state.banner = { message, tone };
    if (this.bannerTimeoutId !== null) {
      window.clearTimeout(this.bannerTimeoutId);
      this.bannerTimeoutId = null;
    }

    if (autoClearMs) {
      this.bannerTimeoutId = window.setTimeout(() => {
        this.state.banner = null;
        this.bannerTimeoutId = null;
        this.render();
      }, autoClearMs);
    }

    this.render();
  }

  private clearBanner(): void {
    if (this.bannerTimeoutId !== null) {
      window.clearTimeout(this.bannerTimeoutId);
      this.bannerTimeoutId = null;
    }

    this.state.banner = null;
    this.render();
  }

  private getFilteredHistory(): HistoryRecord[] {
    const filter = this.state.historyFilterDate;
    const records = this.state.history;
    if (!filter) {
      return records;
    }

    return records.filter((record) => record.date === filter);
  }

  private renderHistoryList(): void {
    this.revokeHistoryPreviewUrls();

    const records = this.getFilteredHistory();
    this.elements.historyList.replaceChildren();

    if (records.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = this.state.historyFilterDate
        ? 'Nenhuma detecção encontrada para a data selecionada.'
        : 'Nenhuma detecção registrada ainda.';
      this.elements.historyList.append(empty);
      this.historyDirty = false;
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const record of records) {
      fragment.append(this.createHistoryEntry(record));
    }

    this.elements.historyList.append(fragment);
    this.historyDirty = false;
  }

  private createHistoryEntry(record: HistoryRecord): HTMLElement {
    const details = document.createElement('details');
    details.className = 'history-entry';

    const summary = document.createElement('summary');
    const summaryMain = document.createElement('div');
    summaryMain.className = 'history-summary-main';

    const summaryTitle = document.createElement('div');
    summaryTitle.className = 'history-summary-title';
    summaryTitle.textContent = `${record.date} • ${record.time}`;

    const summaryMeta = document.createElement('div');
    summaryMeta.className = 'history-tags';
    summaryMeta.append(
      this.createTag(labelForFinalState(record.finalState)),
      this.createTag(`${record.confirmations} confirmações`),
      ...record.foundKeywords.map((keyword) => this.createTag(keyword)),
    );

    summaryMain.append(summaryTitle, summaryMeta);

    const summaryRight = document.createElement('div');
    summaryRight.className = 'tag';
    summaryRight.textContent = formatDurationMs(record.alertDurationMs);

    summary.append(summaryMain, summaryRight);

    const body = document.createElement('div');
    body.className = 'history-body';

    const textBlock = document.createElement('pre');
    textBlock.textContent = record.recognizedText || 'Sem texto reconhecido.';

    const metaBlock = document.createElement('div');
    metaBlock.className = 'history-tags';

    if (record.alertStoppedAt) {
      metaBlock.append(this.createTag(`Parado em ${formatDateTimeDisplay(record.alertStoppedAt)}`));
    }

    metaBlock.append(this.createTag(`Estado final: ${labelForFinalState(record.finalState)}`));

    const imageSlot = document.createElement('div');
    if (record.cropId) {
      imageSlot.textContent = 'Carregando imagem salva...';
      details.addEventListener('toggle', () => {
        if (details.open) {
          void this.loadHistoryCropPreview(record, imageSlot);
        }
      });
    } else {
      imageSlot.className = 'helper-text';
      imageSlot.textContent = 'Nenhuma imagem salva para este registro.';
    }

    const actions = document.createElement('div');
    actions.className = 'history-item-actions';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'ghost-action danger-text';
    deleteButton.textContent = 'Excluir registro';
    deleteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.deleteHistoryItem(record.id);
    });

    actions.append(deleteButton);

    body.append(textBlock, metaBlock, imageSlot, actions);
    details.append(summary, body);
    return details;
  }

  private createTag(text: string): HTMLElement {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = text;
    return tag;
  }

  private async loadHistoryCropPreview(record: HistoryRecord, imageSlot: HTMLElement): Promise<void> {
    if (!record.cropId || imageSlot.dataset.loaded === 'true') {
      return;
    }

    imageSlot.dataset.loaded = 'true';

    try {
      const blob = await getCropBlob(record.cropId);
      if (!blob) {
        imageSlot.textContent = 'Imagem não encontrada.';
        return;
      }

      const url = URL.createObjectURL(blob);
      this.cropPreviewUrls.add(url);

      const image = document.createElement('img');
      image.className = 'history-image';
      image.alt = 'Imagem salva da notificação detectada';
      image.src = url;
      imageSlot.replaceChildren(image);
    } catch {
      imageSlot.textContent = 'Não foi possível carregar a imagem salva.';
    }
  }

  private revokeHistoryPreviewUrls(): void {
    for (const url of this.cropPreviewUrls) {
      URL.revokeObjectURL(url);
    }
    this.cropPreviewUrls.clear();
  }

  private findHistoryRecord(id: string | null): HistoryRecord | undefined {
    if (!id) {
      return undefined;
    }

    return this.state.history.find((record) => record.id === id);
  }

  private updateOpenHistoryRecord(patch: Partial<HistoryRecord>): void {
    if (!this.currentAlertRecordId) {
      return;
    }

    const record = this.findHistoryRecord(this.currentAlertRecordId);
    if (!record) {
      this.currentAlertRecordId = null;
      return;
    }

    this.state.history = updateHistoryRecord(this.state.history, record.id, patch);
    this.historyDirty = true;

    if (patch.finalState === 'monitoring' || patch.finalState === 'camera-stopped' || patch.finalState === 'error') {
      this.currentAlertRecordId = null;
    }
  }

  private finalizeHistoryRecord(finalState: HistoryFinalState): void {
    const record = this.findHistoryRecord(this.currentAlertRecordId);
    if (!record) {
      this.currentAlertRecordId = null;
      return;
    }

    this.state.history = updateHistoryRecord(this.state.history, record.id, { finalState });
    this.historyDirty = true;

    if (finalState === 'monitoring' || finalState === 'camera-stopped' || finalState === 'error') {
      this.currentAlertRecordId = null;
    }
  }

  private async deleteHistoryItem(id: string): Promise<void> {
    const record = this.state.history.find((item) => item.id === id);
    if (!record) {
      return;
    }

    this.state.history = deleteHistoryRecord(this.state.history, id);
    if (this.currentAlertRecordId === id) {
      this.currentAlertRecordId = null;
    }

    this.historyDirty = true;
    this.persistHistory();

    if (record.cropId) {
      try {
        await deleteCropBlob(record.cropId);
      } catch {
        // Ignore crop cleanup failures.
      }
    }

    this.render();
  }
}

function modeLabel(mode: AppMode): string {
  switch (mode) {
    case 'idle':
      return 'Pronto';
    case 'requesting-permission':
      return 'Pedindo acesso';
    case 'preparing-camera':
      return 'Preparando câmera';
    case 'camera-ready':
      return 'Câmera pronta';
    case 'loading-ocr':
      return 'Carregando leitura';
    case 'ready-to-monitor':
      return 'Pré-teste';
    case 'monitoring':
      return 'Monitorando';
    case 'analyzing':
      return 'Analisando';
    case 'candidate-detected':
      return 'Confirmando';
    case 'alerting':
      return 'Alerta ligado';
    case 'waiting-for-clear':
      return 'Aguardando sumir';
    case 'paused':
      return 'Pausado';
    case 'camera-stopped':
      return 'Câmera parada';
    case 'error':
      return 'Erro';
    default:
      return mode;
  }
}

function labelForFinalState(finalState: HistoryFinalState): string {
  switch (finalState) {
    case 'alerting':
      return 'Alerta ligado';
    case 'waiting-for-clear':
      return 'Aguardando sumir';
    case 'monitoring':
      return 'Monitorando';
    case 'paused':
      return 'Pausado';
    case 'camera-stopped':
      return 'Câmera parada';
    case 'error':
      return 'Erro';
    default:
      return finalState;
  }
}

function textForResolution(width: number, height: number): string {
  return `Câmera ativa • ${width}×${height}`;
}

function createDetectionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `det-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.round(parsed);
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('canvas-blob-failed'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });
}

function describeSetupError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Acesso à câmera negado. Autorize e tente de novo.';
      case 'NotFoundError':
        return 'Nenhuma câmera foi encontrada.';
      case 'NotReadableError':
        return 'A câmera está indisponível ou em uso.';
      case 'SecurityError':
        return 'Abra a página em conexão segura para usar a câmera.';
      case 'AbortError':
        return 'A câmera foi interrompida.';
      case 'OverconstrainedError':
        return 'A câmera não pôde ser iniciada.';
      default:
        return 'Não foi possível abrir a câmera.';
    }
  }

  if (error instanceof Error) {
    if (error.message === 'camera-unsupported') {
      return 'Este aparelho não consegue abrir a câmera.';
    }

    if (error.message === 'video-play-failed') {
      return 'Não foi possível iniciar a câmera.';
    }

    return `Não foi possível preparar o monitoramento: ${error.message}`;
  }

  return 'Não foi possível preparar o monitoramento.';
}
