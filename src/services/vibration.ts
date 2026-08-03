export class VibrationService {
  private timerId: number | null = null;

  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  startLoop(): boolean {
    if (!this.supported) {
      return false;
    }

    this.stop();
    navigator.vibrate([250, 120, 250, 120, 400]);
    this.timerId = window.setInterval(() => {
      navigator.vibrate([250, 120, 250, 120, 400]);
    }, 1800);
    return true;
  }

  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }

    if (this.supported) {
      navigator.vibrate(0);
    }
  }
}
