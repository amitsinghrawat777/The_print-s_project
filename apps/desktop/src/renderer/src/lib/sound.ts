let ctx: AudioContext | null = null;

/** A short two-note chime for a new order, made in code so there is no audio file to ship. */
export function playChime() {
  try {
    ctx ??= new AudioContext();
    const start = ctx.currentTime + 0.01;
    [880, 1320].forEach((freq, i) => {
      const t = start + i * 0.16;
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  } catch (error) {
    console.warn('chime failed', error);
  }
}
