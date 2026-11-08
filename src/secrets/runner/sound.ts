// Sound for the rooftop runner, synthesized with Web Audio (no audio files): footsteps, jumps,
// landings, the scrape of a wall run, and wind that rises with speed. Browsers only allow audio after
// the visitor presses a key or taps, so the audio context is created on the first jump press.

export type Surface = 'roof' | 'metal' | 'train';

export interface RunnerSound {
	/** Call from a key or pointer handler: starts audio the first time. */
	wake(): void;
	footstep(surface: Surface, loudness?: number): void;
	/** kind: a normal jump, a wall kick, or an air-vent launch. */
	jump(kind?: 'jump' | 'kick' | 'vent'): void;
	/** strength 0..1, from how fast you came down. */
	land(strength: number): void;
	/** 0..1; eased, so call it every frame. */
	setWind(level: number): void;
	setScrape(on: boolean): void;
	/** The double clunk of a train's wheels crossing a rail joint; loudness 0..1. */
	trainClunk(loudness: number): void;
	/** A train's low rumble, 0..1; eased, so call it every frame. */
	setRumble(level: number): void;
	setMuted(muted: boolean): void;
	close(): void;
}

export function createRunnerSound(muted: boolean): RunnerSound {
	let ac: AudioContext | null = null;
	let master: GainNode | null = null;
	let noise: AudioBuffer | null = null;
	let windGain: GainNode | null = null;
	let windFilter: BiquadFilterNode | null = null;
	let scrapeGain: GainNode | null = null;
	let rumbleGain: GainNode | null = null;
	let isMuted = muted;

	function loop(filterType: BiquadFilterType, freq: number, q: number) {
		const src = ac!.createBufferSource();
		src.buffer = noise;
		src.loop = true;
		const filter = ac!.createBiquadFilter();
		filter.type = filterType;
		filter.frequency.value = freq;
		filter.Q.value = q;
		const gain = ac!.createGain();
		gain.gain.value = 0;
		src.connect(filter).connect(gain).connect(master!);
		src.start();
		return { filter, gain };
	}

	function ready(): AudioContext | null {
		if (!ac) return null;
		if (ac.state === 'suspended') void ac.resume();
		return ac.state === 'running' ? ac : null;
	}

	function wake() {
		if (!ac) {
			try {
				ac = new AudioContext();
			} catch {
				return;
			}
			master = ac.createGain();
			master.gain.value = isMuted ? 0 : 0.6;
			master.connect(ac.destination);
			noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
			const data = noise.getChannelData(0);
			for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
			const wind = loop('bandpass', 400, 0.7);
			windGain = wind.gain;
			windFilter = wind.filter;
			scrapeGain = loop('highpass', 3200, 0.5).gain;
			rumbleGain = loop('lowpass', 140, 0.9).gain;
		}
		ready();
	}

	/** A short burst of filtered noise. */
	function burst(t: number, dur: number, type: BiquadFilterType, freq: number, gain: number, freqEnd?: number) {
		const src = ac!.createBufferSource();
		src.buffer = noise;
		const filter = ac!.createBiquadFilter();
		filter.type = type;
		filter.frequency.setValueAtTime(freq, t);
		if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
		const g = ac!.createGain();
		g.gain.setValueAtTime(gain, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(filter).connect(g).connect(master!);
		src.start(t, Math.random() * 0.5);
		src.stop(t + dur + 0.02);
	}

	/** A short decaying tone. */
	function tone(t: number, dur: number, type: OscillatorType, freq: number, gain: number, freqEnd?: number) {
		const osc = ac!.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t);
		if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
		const g = ac!.createGain();
		g.gain.setValueAtTime(gain, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(g).connect(master!);
		osc.start(t);
		osc.stop(t + dur + 0.02);
	}

	return {
		wake,
		footstep(surface, loudness = 1) {
			const a = ready();
			if (!a) return;
			const t = a.currentTime;
			// Overall footstep level, with a little variation step to step.
			const v = (0.5 + Math.random() * 0.15) * 1.4;
			if (surface === 'roof') {
				burst(t, 0.06, 'lowpass', 700 + Math.random() * 200, 0.22 * loudness * v);
				tone(t, 0.07, 'sine', 95 + Math.random() * 15, 0.12 * loudness * v, 60);
			} else if (surface === 'metal') {
				burst(t, 0.05, 'bandpass', 2600 + Math.random() * 500, 0.16 * loudness * v);
				tone(t, 0.12, 'triangle', 560 + Math.random() * 80, 0.04 * loudness * v, 480);
			} else {
				// On a train roof: kept soft so the train's own clunks and rumble come through.
				burst(t, 0.07, 'bandpass', 1200, 0.07 * loudness * v);
				tone(t, 0.16, 'square', 180 + Math.random() * 20, 0.01 * loudness * v, 150);
			}
		},
		jump(kind = 'jump') {
			const a = ready();
			if (!a) return;
			const t = a.currentTime;
			if (kind === 'vent') {
				burst(t, 0.45, 'bandpass', 300, 0.35, 2400);
				tone(t, 0.3, 'sine', 160, 0.08, 520);
			} else if (kind === 'kick') {
				burst(t, 0.06, 'bandpass', 1800, 0.2);
				burst(t, 0.16, 'highpass', 900, 0.14, 2600);
			} else {
				burst(t, 0.16, 'highpass', 600, 0.14, 2200);
				tone(t, 0.08, 'sine', 210, 0.05, 330);
			}
		},
		land(strength) {
			const a = ready();
			if (!a || strength <= 0) return;
			const t = a.currentTime;
			const s = Math.min(1, strength);
			tone(t, 0.14, 'sine', 80, 0.25 * s, 45);
			burst(t, 0.1, 'lowpass', 500, 0.25 * s);
		},
		setWind(level) {
			const a = ready();
			if (!a || !windGain || !windFilter) return;
			const l = Math.max(0, Math.min(1, level));
			windGain.gain.setTargetAtTime(l * 0.22, a.currentTime, 0.15);
			windFilter.frequency.setTargetAtTime(300 + l * 1100, a.currentTime, 0.2);
		},
		setScrape(on) {
			const a = ready();
			if (!a || !scrapeGain) return;
			scrapeGain.gain.setTargetAtTime(on ? 0.05 : 0, a.currentTime, 0.05);
		},
		trainClunk(loudness) {
			const a = ready();
			if (!a || loudness <= 0.02) return;
			const t = a.currentTime;
			// "Ka-chunk": the front and back wheels of a bogie over the same joint, a beat apart.
			for (const [dt, k] of [
				[0, 0.8],
				[0.11, 1],
			]) {
				burst(t + dt, 0.09, 'lowpass', 900, 0.48 * loudness * k);
				tone(t + dt, 0.1, 'square', 70 + Math.random() * 8, 0.085 * loudness * k, 50);
				burst(t + dt, 0.04, 'bandpass', 3000, 0.09 * loudness * k);
			}
		},
		setRumble(level) {
			const a = ready();
			if (!a || !rumbleGain) return;
			rumbleGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.8, a.currentTime, 0.2);
		},
		setMuted(m) {
			isMuted = m;
			if (ac && master) master.gain.setTargetAtTime(m ? 0 : 0.6, ac.currentTime, 0.03);
		},
		close() {
			void ac?.close();
			ac = null;
		},
	};
}
