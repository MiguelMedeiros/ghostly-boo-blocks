/**
 * Sounds synthesized with Web Audio: no audio file, nobody's recording. The AudioContext is made on the first click,
 * tap or key (browsers start sound only after one), and every sound is a short burst of filtered noise or a tone.
 */
import type { BlockKind } from "./blocks.ts";

type Material = BlockKind["sound"];

export class Sound {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Called from a user gesture: makes (or resumes) the AudioContext. */
  wake(): void {
    if (!this.enabled) return;
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.context ??= new Context();
      if (this.context.state === "suspended") void this.context.resume();
      if (!this.noise) {
        const length = Math.floor(this.context.sampleRate * 0.4);
        this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        // A seeded generator: the same noise every time, like everything else here.
        let seed = 0x2545f491;
        for (let i = 0; i < length; i++) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
        }
      }
    } catch {
      this.context = null;
    }
  }

  private burst(filter: BiquadFilterType, frequency: number, q: number, duration: number, volume: number): void {
    const c = this.context;
    if (!c || !this.noise || !this.enabled || c.state !== "running") return;
    const source = c.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const shape = c.createBiquadFilter();
    shape.type = filter;
    shape.frequency.value = frequency * (0.9 + Math.random() * 0.2);
    shape.Q.value = q;
    const gain = c.createGain();
    const t = c.currentTime;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(shape).connect(gain).connect(c.destination);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  private tone(frequency: number, to: number, duration: number, volume: number, type: OscillatorType = "sine"): void {
    const c = this.context;
    if (!c || !this.enabled || c.state !== "running") return;
    const osc = c.createOscillator();
    osc.type = type;
    const gain = c.createGain();
    const t = c.currentTime;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  breakBlock(material: Material): void {
    switch (material) {
      case "stone":
        this.burst("bandpass", 1800, 1.2, 0.16, 0.5);
        this.burst("lowpass", 500, 0.7, 0.12, 0.35);
        break;
      case "wood":
        this.burst("bandpass", 700, 2.5, 0.14, 0.55);
        this.tone(220, 140, 0.08, 0.12, "triangle");
        break;
      case "glass":
        this.burst("highpass", 4000, 0.8, 0.22, 0.35);
        this.tone(2400, 1800, 0.18, 0.06);
        this.tone(3100, 2600, 0.14, 0.04);
        break;
      case "sand":
        this.burst("lowpass", 2400, 0.5, 0.2, 0.4);
        break;
      case "water":
        this.burst("lowpass", 900, 3, 0.25, 0.4);
        this.tone(500, 900, 0.12, 0.05);
        break;
      default:
        this.burst("lowpass", 1200, 0.8, 0.14, 0.45);
    }
  }

  place(material: Material): void {
    if (material === "water") return this.breakBlock("water");
    this.burst("lowpass", material === "stone" ? 900 : material === "glass" ? 3000 : 600, 1, 0.08, 0.5);
    this.tone(material === "wood" ? 180 : 140, 90, 0.07, 0.15, "triangle");
  }

  step(material: Material | undefined): void {
    this.burst(material === "stone" ? "bandpass" : "lowpass", material === "stone" ? 1400 : 700, 0.8, 0.07, 0.12);
  }

  /** The contact came in. */
  hello(): void {
    this.tone(660, 990, 0.12, 0.08);
    setTimeout(() => this.tone(990, 1320, 0.14, 0.07), 110);
  }
}
