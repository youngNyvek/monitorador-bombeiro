export class AlertAudioService {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  get supported(): boolean {
    return typeof window !== 'undefined' && (Boolean(window.AudioContext) || Boolean(window.webkitAudioContext));
  }

  async prepare(): Promise<void> {
    if (!this.supported) {
      throw new Error('audio-unsupported');
    }

    if (!this.context) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextConstructor();
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  async playTone(): Promise<void> {
    await this.prepare();

    if (!this.context || this.oscillator) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = 'square';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;

    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start();

    this.oscillator = oscillator;
    this.gain = gain;
  }

  async playTestTone(): Promise<void> {
    await this.playTone();
  }

  stopTone(): void {
    if (this.oscillator) {
      try {
        this.oscillator.stop();
      } catch {
        // Ignore stop errors caused by a race with browser audio teardown.
      }

      this.oscillator.disconnect();
      this.oscillator = null;
    }

    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
    }
  }
}
