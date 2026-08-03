import { toIsoString } from '../utils/time';
import type { AppMode, PauseReason, RuntimeState } from '../types';

export type RuntimeEvent =
  | { type: 'prepare-requested' }
  | { type: 'camera-started' }
  | { type: 'camera-ready' }
  | { type: 'ocr-loading' }
  | { type: 'ocr-ready' }
  | { type: 'monitoring-started'; now: number; analysisIntervalMs: number }
  | { type: 'analysis-started' }
  | {
      type: 'analysis-result';
      now: number;
      recognizedText: string;
      matched: boolean;
      matchedKeywords: string[];
      requiredConfirmations: number;
      clearConfirmations: number;
      analysisIntervalMs: number;
      minAlertIntervalMs: number;
    }
  | { type: 'alert-stopped'; now: number; recoveryMs: number }
  | { type: 'resume-requested'; now: number; analysisIntervalMs: number }
  | { type: 'pause-requested'; now: number; reason?: PauseReason }
  | { type: 'camera-stopped' }
  | { type: 'error'; message: string };

export function transitionRuntimeState(state: RuntimeState, event: RuntimeEvent): RuntimeState {
  switch (event.type) {
    case 'prepare-requested':
      return {
        ...state,
        mode: 'requesting-permission',
        statusText: 'Solicitando acesso à câmera traseira...',
        pauseReason: null,
        originMode: null,
        analysisResumeAt: null,
        confirmationCount: 0,
        clearCount: 0,
      };
    case 'camera-started':
      return {
        ...state,
        mode: 'preparing-camera',
        statusText: 'Preparando a câmera...',
        originMode: null,
        analysisResumeAt: null,
      };
    case 'camera-ready':
      return {
        ...state,
        mode: 'camera-ready',
        statusText: 'Câmera pronta. Carregando OCR local...',
        analysisResumeAt: null,
        originMode: null,
      };
    case 'ocr-loading':
      return {
        ...state,
        mode: 'loading-ocr',
        statusText: 'Carregando OCR local...',
        analysisResumeAt: null,
        originMode: null,
      };
    case 'ocr-ready':
      return {
        ...state,
        mode: 'ready-to-monitor',
        statusText: 'Faça os testes e inicie o monitoramento.',
        analysisResumeAt: null,
        originMode: null,
        confirmationCount: 0,
        clearCount: 0,
      };
    case 'monitoring-started':
      return {
        ...state,
        mode: 'monitoring',
        statusText: 'Monitorando.',
        analysisResumeAt: event.now + Math.max(0, event.analysisIntervalMs),
        originMode: null,
        confirmationCount: 0,
        clearCount: 0,
      };
    case 'analysis-started': {
      if (!isAnalyzableMode(state.mode)) {
        return state;
      }

      return {
        ...state,
        mode: 'analyzing',
        statusText: 'Lendo a imagem inteira da câmera...',
        originMode: state.mode,
        analysisResumeAt: null,
      };
    }
    case 'analysis-result': {
      if (state.mode !== 'analyzing' || !state.originMode) {
        return state;
      }

      const analyzedAt = toIsoString(event.now);
      const previousMode = state.originMode;

      if (previousMode === 'waiting-for-clear') {
        if (event.matched) {
          return {
            ...state,
            mode: 'waiting-for-clear',
            statusText: `Aguardando sumir (${state.clearCount}/${event.clearConfirmations})`,
            originMode: null,
            analysisResumeAt: event.now + Math.max(0, event.analysisIntervalMs),
            lastAnalysisAt: analyzedAt,
            lastRecognizedText: event.recognizedText,
            clearCount: 0,
          };
        }

        const nextClearCount = state.clearCount + 1;
        if (nextClearCount >= event.clearConfirmations) {
          return {
            ...state,
            mode: 'monitoring',
            statusText: 'Sumiu. Voltando a monitorar.',
            originMode: null,
            analysisResumeAt: event.now + Math.max(0, event.analysisIntervalMs),
            lastAnalysisAt: analyzedAt,
            lastRecognizedText: event.recognizedText,
            confirmationCount: 0,
            clearCount: 0,
            alertStartedAt: null,
            alertStoppedAt: null,
            alertDurationMs: null,
          };
        }

        return {
          ...state,
          mode: 'waiting-for-clear',
          statusText: `Aguardando sumir (${nextClearCount}/${event.clearConfirmations})`,
          originMode: null,
          analysisResumeAt: event.now + Math.max(0, event.analysisIntervalMs),
          lastAnalysisAt: analyzedAt,
          lastRecognizedText: event.recognizedText,
          confirmationCount: 0,
          clearCount: nextClearCount,
        };
      }

      if (event.matched) {
        const nextConfirmationCount = state.confirmationCount + 1;
        const cappedConfirmationCount = Math.min(nextConfirmationCount, event.requiredConfirmations);
        const alertAllowed =
          state.lastAlertFinishedAt === null ||
          event.now - state.lastAlertFinishedAt >= event.minAlertIntervalMs;

        if (nextConfirmationCount >= event.requiredConfirmations && alertAllowed) {
          return {
            ...state,
            mode: 'alerting',
            statusText: 'Alerta ligado.',
            originMode: null,
            analysisResumeAt: null,
            lastAnalysisAt: analyzedAt,
            lastRecognizedText: event.recognizedText,
            confirmationCount: cappedConfirmationCount,
            clearCount: 0,
            alertStartedAt: analyzedAt,
          };
        }

        return {
          ...state,
          mode: 'candidate-detected',
          statusText:
            nextConfirmationCount >= event.requiredConfirmations
            ? 'Encontrado. Aguardando liberar...'
              : `Confirmando (${nextConfirmationCount}/${event.requiredConfirmations}).`,
          originMode: null,
          analysisResumeAt: event.now + Math.max(0, event.analysisIntervalMs),
          lastAnalysisAt: analyzedAt,
          lastRecognizedText: event.recognizedText,
          confirmationCount: cappedConfirmationCount,
          clearCount: 0,
        };
      }

      return {
        ...state,
        mode: 'monitoring',
        statusText: 'Monitorando.',
        originMode: null,
        analysisResumeAt: event.now + Math.max(0, event.analysisIntervalMs),
        lastAnalysisAt: analyzedAt,
        lastRecognizedText: event.recognizedText,
        confirmationCount: 0,
        clearCount: 0,
      };
    }
    case 'alert-stopped': {
      if (state.mode !== 'alerting' && state.mode !== 'analyzing') {
        return state;
      }

      const alertStartedAtMs = state.alertStartedAt ? Date.parse(state.alertStartedAt) : NaN;
      const durationMs = Number.isFinite(alertStartedAtMs) ? Math.max(0, event.now - alertStartedAtMs) : null;

      return {
        ...state,
        mode: 'waiting-for-clear',
        statusText: 'Aguardando sumir.',
        pauseReason: null,
        originMode: null,
        analysisResumeAt: event.now + Math.max(0, event.recoveryMs),
        confirmationCount: 0,
        clearCount: 0,
        alertStoppedAt: toIsoString(event.now),
        alertDurationMs: durationMs,
        lastAlertFinishedAt: event.now,
      };
    }
    case 'resume-requested':
      return {
        ...state,
        mode: 'monitoring',
        statusText: 'Monitorando.',
        pauseReason: null,
        originMode: null,
        analysisResumeAt: event.now + Math.max(0, event.analysisIntervalMs),
        confirmationCount: 0,
        clearCount: 0,
      };
    case 'pause-requested':
      {
        const alertStartedAtMs = state.alertStartedAt ? Date.parse(state.alertStartedAt) : NaN;
        const alertWasActive =
          state.mode === 'alerting' || state.mode === 'waiting-for-clear' || state.mode === 'analyzing';

        return {
          ...state,
          mode: 'paused',
          statusText:
            event.reason === 'background'
              ? 'Monitoramento pausado pela aba em segundo plano.'
              : 'Monitoramento pausado.',
          pauseReason: event.reason ?? 'manual',
          originMode: null,
          analysisResumeAt: null,
          confirmationCount: 0,
          clearCount: 0,
          alertStartedAt: null,
          alertStoppedAt: alertWasActive && Number.isFinite(alertStartedAtMs) ? toIsoString(event.now) : null,
          alertDurationMs: alertWasActive && Number.isFinite(alertStartedAtMs) ? Math.max(0, event.now - alertStartedAtMs) : null,
          lastAlertFinishedAt: alertWasActive ? event.now : state.lastAlertFinishedAt,
        };
      }
    case 'camera-stopped':
      return {
        ...state,
        mode: 'camera-stopped',
        statusText: 'Câmera encerrada.',
        pauseReason: null,
        originMode: null,
        analysisResumeAt: null,
        confirmationCount: 0,
        clearCount: 0,
        alertStartedAt: null,
        alertStoppedAt: null,
        alertDurationMs: null,
      };
    case 'error':
      return {
        ...state,
        mode: 'error',
        statusText: event.message,
        pauseReason: null,
        originMode: null,
        analysisResumeAt: null,
        alertStartedAt: null,
        alertStoppedAt: null,
        alertDurationMs: null,
      };
    default:
      return state;
  }
}

function isAnalyzableMode(mode: AppMode): boolean {
  return mode === 'monitoring' || mode === 'candidate-detected' || mode === 'waiting-for-clear';
}
