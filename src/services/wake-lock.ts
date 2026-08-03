export class WakeLockService {
  private sentinel: WakeLockSentinel | null = null;

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  get active(): boolean {
    return this.sentinel !== null;
  }

  async request(): Promise<{ ok: boolean; supported: boolean }> {
    if (!this.supported) {
      return { ok: false, supported: false };
    }

    try {
      const sentinel = await navigator.wakeLock.request('screen');
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) {
          this.sentinel = null;
        }
      });
      return { ok: true, supported: true };
    } catch {
      this.sentinel = null;
      return { ok: false, supported: true };
    }
  }

  async release(): Promise<void> {
    if (!this.sentinel) {
      return;
    }

    const sentinel = this.sentinel;
    this.sentinel = null;
    try {
      await sentinel.release();
    } catch {
      // Ignore release failures.
    }
  }
}
