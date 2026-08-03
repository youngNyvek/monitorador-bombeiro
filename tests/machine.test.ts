import { describe, expect, it } from 'vitest';
import { createInitialRuntimeState } from '../src/state/defaults';
import { transitionRuntimeState } from '../src/state/machine';

function buildMonitoringState() {
  let state = createInitialRuntimeState();
  state = transitionRuntimeState(state, { type: 'prepare-requested' });
  state = transitionRuntimeState(state, { type: 'camera-started' });
  state = transitionRuntimeState(state, { type: 'camera-ready' });
  state = transitionRuntimeState(state, { type: 'ocr-loading' });
  state = transitionRuntimeState(state, { type: 'ocr-ready', now: 1000, analysisIntervalMs: 2000 });
  return state;
}

describe('runtime state machine', () => {
  it('moves from preparation to alert and back to monitoring', () => {
    let state = buildMonitoringState();

    expect(state.mode).toBe('monitoring');
    expect(state.analysisResumeAt).toBe(3000);

    state = transitionRuntimeState(state, { type: 'analysis-started' });
    expect(state.mode).toBe('analyzing');
    expect(state.originMode).toBe('monitoring');

    state = transitionRuntimeState(state, {
      type: 'analysis-result',
      now: 2000,
      recognizedText: 'Alerta urgente',
      matched: true,
      matchedKeywords: ['urgente'],
      requiredConfirmations: 2,
      clearConfirmations: 3,
      analysisIntervalMs: 2000,
      minAlertIntervalMs: 5000,
    });
    expect(state.mode).toBe('candidate-detected');
    expect(state.confirmationCount).toBe(1);

    state = transitionRuntimeState(state, { type: 'analysis-started' });
    state = transitionRuntimeState(state, {
      type: 'analysis-result',
      now: 3000,
      recognizedText: 'Alerta urgente',
      matched: true,
      matchedKeywords: ['urgente'],
      requiredConfirmations: 2,
      clearConfirmations: 3,
      analysisIntervalMs: 2000,
      minAlertIntervalMs: 5000,
    });
    expect(state.mode).toBe('alerting');
    expect(state.alertStartedAt).toBe('1970-01-01T00:00:03.000Z');

    state = transitionRuntimeState(state, { type: 'alert-stopped', now: 5000, recoveryMs: 2500 });
    expect(state.mode).toBe('waiting-for-clear');
    expect(state.alertStoppedAt).toBe('1970-01-01T00:00:05.000Z');
    expect(state.alertDurationMs).toBe(2000);

    state = transitionRuntimeState(state, { type: 'analysis-started' });
    state = transitionRuntimeState(state, {
      type: 'analysis-result',
      now: 8000,
      recognizedText: 'Sem alerta',
      matched: false,
      matchedKeywords: [],
      requiredConfirmations: 2,
      clearConfirmations: 3,
      analysisIntervalMs: 2000,
      minAlertIntervalMs: 5000,
    });
    expect(state.clearCount).toBe(1);

    state = transitionRuntimeState(state, { type: 'analysis-started' });
    state = transitionRuntimeState(state, {
      type: 'analysis-result',
      now: 10000,
      recognizedText: 'Sem alerta',
      matched: false,
      matchedKeywords: [],
      requiredConfirmations: 2,
      clearConfirmations: 3,
      analysisIntervalMs: 2000,
      minAlertIntervalMs: 5000,
    });
    expect(state.clearCount).toBe(2);

    state = transitionRuntimeState(state, { type: 'analysis-started' });
    state = transitionRuntimeState(state, {
      type: 'analysis-result',
      now: 12000,
      recognizedText: 'Sem alerta',
      matched: false,
      matchedKeywords: [],
      requiredConfirmations: 2,
      clearConfirmations: 3,
      analysisIntervalMs: 2000,
      minAlertIntervalMs: 5000,
    });
    expect(state.mode).toBe('monitoring');
    expect(state.alertStartedAt).toBeNull();
    expect(state.alertStoppedAt).toBeNull();
    expect(state.alertDurationMs).toBeNull();
  });

  it('keeps a minimum interval before new alerts', () => {
    let state = buildMonitoringState();

    state = transitionRuntimeState(state, { type: 'analysis-started' });
    state = transitionRuntimeState(state, {
      type: 'analysis-result',
      now: 2000,
      recognizedText: 'Aviso importante',
      matched: true,
      matchedKeywords: ['importante'],
      requiredConfirmations: 1,
      clearConfirmations: 2,
      analysisIntervalMs: 2000,
      minAlertIntervalMs: 10000,
    });
    expect(state.mode).toBe('alerting');

    state = transitionRuntimeState(state, { type: 'alert-stopped', now: 3000, recoveryMs: 0 });
    state = transitionRuntimeState(state, { type: 'resume-requested', now: 4000, analysisIntervalMs: 2000 });

    state = transitionRuntimeState(state, { type: 'analysis-started' });
    state = transitionRuntimeState(state, {
      type: 'analysis-result',
      now: 5000,
      recognizedText: 'Aviso importante',
      matched: true,
      matchedKeywords: ['importante'],
      requiredConfirmations: 1,
      clearConfirmations: 2,
      analysisIntervalMs: 2000,
      minAlertIntervalMs: 10000,
    });

    expect(state.mode).toBe('candidate-detected');

    state = transitionRuntimeState(state, { type: 'analysis-started' });
    state = transitionRuntimeState(state, {
      type: 'analysis-result',
      now: 13000,
      recognizedText: 'Aviso importante',
      matched: true,
      matchedKeywords: ['importante'],
      requiredConfirmations: 1,
      clearConfirmations: 2,
      analysisIntervalMs: 2000,
      minAlertIntervalMs: 10000,
    });

    expect(state.mode).toBe('alerting');
  });

  it('pauses and resumes without carrying stale confirmations', () => {
    let state = buildMonitoringState();

    state.confirmationCount = 2;
    state.clearCount = 1;
    state.analysisResumeAt = 5000;

    state = transitionRuntimeState(state, { type: 'pause-requested', now: 4000, reason: 'manual' });
    expect(state.mode).toBe('paused');
    expect(state.confirmationCount).toBe(0);
    expect(state.clearCount).toBe(0);
    expect(state.analysisResumeAt).toBeNull();

    state = transitionRuntimeState(state, { type: 'resume-requested', now: 7000, analysisIntervalMs: 2000 });
    expect(state.mode).toBe('monitoring');
    expect(state.confirmationCount).toBe(0);
    expect(state.clearCount).toBe(0);
    expect(state.analysisResumeAt).toBe(9000);
  });
});
