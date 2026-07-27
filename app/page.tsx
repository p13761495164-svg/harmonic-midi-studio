"use client";

import { Midi, Track } from "@tonejs/midi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type UiTrack = {
  id: number;
  source: Track;
  displayName: string;
  muted: boolean;
  solo: boolean;
  color: string;
};

type MidiProject = {
  name: string;
  midi: Midi;
  tracks: UiTrack[];
  estimatedKey: KeyEvent;
};

type KeyEvent = {
  key: string;
  scale: "major" | "minor";
  ticks: number;
  estimated?: boolean;
};

type AudioGraph = {
  context: AudioContext;
  master: GainNode;
  reverb: ConvolverNode;
  wet: GainNode;
};

type ActiveVoice = {
  gain: GainNode;
  sources: Set<AudioScheduledSourceNode>;
};

type SynthPreset = {
  wave: OscillatorType;
  second: OscillatorType;
  detune: number;
  filter: number;
  filterEnd: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  level: number;
  wet: number;
  mode: "plucked" | "sustained" | "percussion";
  kalimba: boolean;
  harp?: boolean;
};

type TimbreSettings = Pick<SynthPreset, "attack" | "decay" | "sustain" | "release" | "filter" | "level" | "wet">;

type Toast = {
  text: string;
  action?: { label: string; run: () => void };
};

const TRACK_COLORS = ["#8c74ff", "#4fc8b7", "#f0a95a", "#ef6f8f", "#5da8ff", "#c781ef", "#76c86c", "#e3cb5f"];
const KEYS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const PITCH_CLASS_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const TIMBRE_STORAGE_KEY = "harmonic-midi-saved-timbres-v1";

function textScore(text: string) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const punctuation = (text.match(/[（）《》【】、“”。，：；]/g) ?? []).length;
  const replacements = (text.match(/\ufffd/g) ?? []).length;
  const controls = (text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) ?? []).length;
  return cjk * 6 + punctuation * 2 - replacements * 20 - controls * 8;
}

function repairMidiText(text: string) {
  if (!text || [...text].some((character) => character.codePointAt(0)! > 255)) return text;
  const bytes = Uint8Array.from([...text], (character) => character.charCodeAt(0));
  let best = text;
  let bestScore = textScore(text);
  for (const encoding of ["utf-8", "gb18030", "big5", "shift_jis"]) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/\0/g, "").trim();
      const score = textScore(decoded);
      if (score > bestScore) {
        best = decoded;
        bestScore = score;
      }
    } catch {}
  }
  return best;
}

function utf8ByteString(text: string) {
  const bytes = new TextEncoder().encode(text);
  let result = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    result += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return result;
}

function detectKey(midi: Midi): KeyEvent {
  const histogram = Array(12).fill(0);
  midi.tracks.forEach((track) => track.notes.forEach((note) => {
    histogram[note.midi % 12] += Math.max(0.1, note.durationTicks) * Math.max(0.2, note.velocity);
  }));
  let best = { score: -Infinity, root: 0, scale: "major" as "major" | "minor" };
  for (let root = 0; root < 12; root++) {
    const major = histogram.reduce((sum, value, pitch) => sum + value * MAJOR_PROFILE[(pitch - root + 12) % 12], 0);
    const minor = histogram.reduce((sum, value, pitch) => sum + value * MINOR_PROFILE[(pitch - root + 12) % 12], 0);
    if (major > best.score) best = { score: major, root, scale: "major" };
    if (minor > best.score) best = { score: minor, root, scale: "minor" };
  }
  return { key: PITCH_CLASS_NAMES[best.root], scale: best.scale, ticks: 0, estimated: true };
}

function projectFromMidi(midi: Midi, name: string): MidiProject {
  const playable = midi.tracks.filter((track) => track.notes.length > 0);
  if (!playable.length) throw new Error("这个 MIDI 文件中没有可播放的音符轨道");
  return {
    name,
    midi,
    tracks: playable.map((source, index) => ({
      id: index + 1,
      source,
      displayName: repairMidiText(source.name) || source.instrument.name || `Track ${index + 1}`,
      muted: false,
      solo: false,
      color: TRACK_COLORS[index % TRACK_COLORS.length],
    })),
    estimatedKey: detectKey(midi),
  };
}

function makeDemoProject() {
  const midi = new Midi();
  midi.name = "Midnight Sketch";
  midi.header.tempos.push({ ticks: 0, bpm: 112 });
  midi.header.keySignatures.push({ ticks: 0, key: "C", scale: "minor" });
  const specs = [
    { name: "Grand Piano · Kalimba", program: 0, channel: 0, base: 60, count: 24, step: 480, length: 330 },
    { name: "Warm Bass", program: 38, channel: 1, base: 36, count: 12, step: 960, length: 760 },
    { name: "Soft Drums", program: 0, channel: 9, base: 42, count: 48, step: 240, length: 70 },
    { name: "Air Pad", program: 89, channel: 2, base: 48, count: 8, step: 1440, length: 1320 },
  ];
  specs.forEach((spec, trackIndex) => {
    const track = midi.addTrack();
    track.name = spec.name;
    track.channel = spec.channel;
    track.instrument.number = spec.program;
    for (let index = 0; index < spec.count; index++) {
      track.addNote({
        midi: spec.base + [0, 3, 7, 10, 7, 3][index % 6],
        ticks: index * spec.step + trackIndex * 30,
        durationTicks: spec.length,
        velocity: 0.48 + (index % 4) * 0.1,
      });
    }
    if (trackIndex === 0) {
      track.addCC({ number: 64, ticks: 0, value: 1 });
      track.addCC({ number: 64, ticks: 3840, value: 0 });
    }
  });
  midi.header.update();
  return projectFromMidi(midi, "Midnight Sketch.mid");
}

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function formatKey(event: KeyEvent) {
  return `${event.key} ${event.scale === "minor" ? "Minor" : "Major"}`;
}

function currentTempo(midi: Midi, seconds: number) {
  const ticks = midi.header.secondsToTicks(seconds);
  return [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks).reverse().find((event) => event.ticks <= ticks)?.bpm ?? 120;
}

function currentKey(project: MidiProject, seconds: number): KeyEvent {
  const ticks = project.midi.header.secondsToTicks(seconds);
  const actual = [...project.midi.header.keySignatures]
    .sort((a, b) => a.ticks - b.ticks)
    .reverse()
    .find((event) => event.ticks <= ticks);
  return actual
    ? { key: actual.key, scale: actual.scale as "major" | "minor", ticks: actual.ticks }
    : project.estimatedKey;
}

function makeImpulse(context: AudioContext) {
  const length = Math.floor(context.sampleRate * 1.45);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 2.5);
    }
  }
  return impulse;
}

function makeHarpString(context: AudioContext, frequency: number, seconds: number) {
  const length = Math.ceil(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const period = Math.max(2, Math.round(context.sampleRate / frequency));
  for (let index = 0; index < Math.min(period, length); index++) {
    const pickPosition = index / period;
    const softPick = Math.sin(Math.PI * pickPosition);
    data[index] = (Math.random() * 2 - 1) * softPick;
  }
  for (let index = period; index < length; index++) {
    data[index] = (data[index - period] + data[index - period + 1]) * 0.497;
  }
  return buffer;
}

function presetFor(track: Track): SynthPreset {
  const family = track.instrument.family;
  if (track.instrument.number === 0 && !track.instrument.percussion) {
    return { wave: "sine" as OscillatorType, second: "sine" as OscillatorType, detune: 2, filter: 7600, filterEnd: 1100, attack: 0.0015, decay: 0.18, sustain: 0, release: 1.55, level: 0.105, wet: 0.2, mode: "plucked" as const, kalimba: true };
  }
  if (track.instrument.number === 46 && !track.instrument.percussion) {
    return { wave: "triangle" as OscillatorType, second: "sine" as OscillatorType, detune: 0, filter: 6200, filterEnd: 900, attack: 0.002, decay: 0.12, sustain: 0, release: 2.65, level: 0.17, wet: 0.24, mode: "plucked" as const, kalimba: false, harp: true };
  }
  if (track.instrument.percussion) return { wave: "square" as OscillatorType, second: "sine" as OscillatorType, detune: 0, filter: 2300, filterEnd: 380, attack: 0.002, decay: 0.04, sustain: 0, release: 0.12, level: 0.1, wet: 0.03, mode: "percussion" as const, kalimba: false };
  if (family === "piano" || family === "chromatic percussion") return { wave: "triangle" as OscillatorType, second: "sine" as OscillatorType, detune: 12, filter: 4200, filterEnd: 650, attack: 0.004, decay: 0.16, sustain: 0, release: 1.7, level: 0.09, wet: 0.12, mode: "plucked" as const, kalimba: false };
  if (family === "guitar") return { wave: "triangle" as OscillatorType, second: "sine" as OscillatorType, detune: 7, filter: 2900, filterEnd: 520, attack: 0.003, decay: 0.12, sustain: 0, release: 1.15, level: 0.085, wet: 0.08, mode: "plucked" as const, kalimba: false };
  if (family === "bass") return { wave: "square" as OscillatorType, second: "sine" as OscillatorType, detune: -5, filter: 920, filterEnd: 520, attack: 0.008, decay: 0.18, sustain: 0.7, release: 0.28, level: 0.1, wet: 0.03, mode: "sustained" as const, kalimba: false };
  if (family === "strings" || family === "ensemble" || family === "synth pad") return { wave: "sawtooth" as OscillatorType, second: "triangle" as OscillatorType, detune: 8, filter: 1850, filterEnd: 760, attack: 0.14, decay: 0.38, sustain: 0.82, release: 1.45, level: 0.052, wet: 0.2, mode: "sustained" as const, kalimba: false };
  if (family === "brass" || family === "reed" || family === "pipe") return { wave: "sawtooth" as OscillatorType, second: "square" as OscillatorType, detune: -7, filter: 2200, filterEnd: 900, attack: 0.045, decay: 0.22, sustain: 0.76, release: 0.55, level: 0.055, wet: 0.11, mode: "sustained" as const, kalimba: false };
  if (family === "synth lead") return { wave: "sawtooth" as OscillatorType, second: "square" as OscillatorType, detune: 9, filter: 2900, filterEnd: 1050, attack: 0.01, decay: 0.15, sustain: 0.7, release: 0.35, level: 0.05, wet: 0.12, mode: "sustained" as const, kalimba: false };
  return { wave: "triangle" as OscillatorType, second: "sine" as OscillatorType, detune: 6, filter: 2500, filterEnd: 820, attack: 0.018, decay: 0.2, sustain: 0.72, release: 0.48, level: 0.075, wet: 0.1, mode: "sustained" as const, kalimba: false };
}

function timbreKey(track: Track) {
  return track.instrument.percussion ? "percussion" : `program-${track.instrument.number}`;
}

function editableSettings(preset: SynthPreset): TimbreSettings {
  return {
    attack: preset.attack,
    decay: preset.decay,
    sustain: preset.sustain,
    release: preset.release,
    filter: preset.filter,
    level: preset.level,
    wet: preset.wet,
  };
}

function clampTimbre(settings: TimbreSettings): TimbreSettings {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return {
    attack: clamp(settings.attack, 0.001, 0.4),
    decay: clamp(settings.decay, 0.03, 1.2),
    sustain: clamp(settings.sustain, 0, 1),
    release: clamp(settings.release, 0.08, 4),
    filter: clamp(settings.filter, 300, 10000),
    level: clamp(settings.level, 0.02, 0.2),
    wet: clamp(settings.wet, 0, 0.5),
  };
}

function instrumentLabel(track: Track) {
  return track.instrument.number === 0 && !track.instrument.percussion
    ? "Kalimba · Grand Piano map"
    : track.instrument.name;
}

export default function Home() {
  const [project, setProject] = useState<MidiProject | null>(null);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [tempoDraft, setTempoDraft] = useState(120);
  const [keyDraft, setKeyDraft] = useState("C");
  const [scaleDraft, setScaleDraft] = useState<"major" | "minor">("major");
  const [toast, setToast] = useState<Toast | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [laneGeometry, setLaneGeometry] = useState({ left: 0, width: 0 });
  const [savedTimbres, setSavedTimbres] = useState<Record<string, TimbreSettings>>({});
  const [timbreTrackId, setTimbreTrackId] = useState<number | null>(null);
  const [timbreDraft, setTimbreDraft] = useState<TimbreSettings | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trackListRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<AudioGraph | null>(null);
  const playbackStartRef = useRef(0);
  const positionStartRef = useRef(0);
  const animationRef = useRef(0);
  const scheduledRef = useRef(new Set<string>());
  const voicesRef = useRef(new Set<ActiveVoice>());
  const projectRef = useRef(project);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => { projectRef.current = project; }, [project]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TIMBRE_STORAGE_KEY);
      if (stored) setSavedTimbres(JSON.parse(stored) as Record<string, TimbreSettings>);
    } catch {}
  }, []);

  useEffect(() => {
    const list = trackListRef.current;
    const lane = list?.querySelector<HTMLElement>(".track-lane");
    if (!list || !lane) {
      setLaneGeometry({ left: 0, width: 0 });
      return;
    }
    const update = () => {
      const listRect = list.getBoundingClientRect();
      const laneRect = lane.getBoundingClientRect();
      setLaneGeometry({ left: laneRect.left - listRect.left, width: laneRect.width });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    observer.observe(lane);
    return () => observer.disconnect();
  }, [project?.tracks.length]);

  const notify = useCallback((next: Toast) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = window.setTimeout(() => setToast(null), next.action ? 5500 : 2600);
  }, []);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) {
      void audioRef.current.context.resume();
      return audioRef.current;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = 0.82;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 10;
    compressor.ratio.value = 2;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    const highShelf = context.createBiquadFilter();
    highShelf.type = "highshelf";
    highShelf.frequency.value = 4200;
    highShelf.gain.value = 1.5;
    const reverb = context.createConvolver();
    reverb.buffer = makeImpulse(context);
    const wet = context.createGain();
    wet.gain.value = 0.2;
    reverb.connect(wet).connect(master);
    master.connect(highShelf).connect(compressor).connect(context.destination);
    audioRef.current = { context, master, reverb, wet };
    void context.resume();
    return audioRef.current;
  }, []);

  const stopVoices = useCallback(() => {
    const graph = audioRef.current;
    if (!graph) return;
    const now = graph.context.currentTime;
    voicesRef.current.forEach((voice) => {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.009);
      } catch {}
      voice.sources.forEach((source) => {
        try { source.stop(now + 0.045); } catch {}
      });
    });
    voicesRef.current.clear();
  }, []);

  const audibleTracks = useCallback((tracks: UiTrack[]) => {
    const hasSolo = tracks.some((track) => track.solo);
    return tracks.filter((track) => !track.muted && (!hasSolo || track.solo));
  }, []);

  const triggerNote = useCallback((
    note: Track["notes"][number],
    track: UiTrack,
    delay: number,
    previewSettings?: TimbreSettings,
    previewDuration?: number,
  ) => {
    const graph = ensureAudio();
    if (!graph) return;
    const { context, master, reverb } = graph;
    const basePreset = presetFor(track.source);
    const customSettings = previewSettings ?? savedTimbres[timbreKey(track.source)];
    const normalizedSettings = customSettings ? clampTimbre(customSettings) : null;
    const preset: SynthPreset = normalizedSettings
      ? {
          ...basePreset,
          ...normalizedSettings,
          filterEnd: Math.min(basePreset.filterEnd, normalizedSettings.filter * 0.45),
        }
      : basePreset;
    const start = context.currentTime + Math.max(0, delay);
    const noteOff = start + Math.max(0.05, previewDuration ?? note.duration);
    const end = preset.mode === "sustained" ? noteOff + preset.release : start + preset.release;
    const output = context.createGain();
    output.gain.value = 1;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(preset.filter, start);
    if (preset.mode === "sustained") {
      const filterDecayEnd = Math.min(noteOff, start + preset.attack + preset.decay);
      filter.frequency.exponentialRampToValueAtTime(Math.max(preset.filterEnd, preset.filter * 0.72), filterDecayEnd);
      filter.frequency.setValueAtTime(Math.max(preset.filterEnd, preset.filter * 0.72), noteOff);
    }
    filter.frequency.exponentialRampToValueAtTime(preset.filterEnd, end);
    filter.Q.value = track.source.instrument.percussion ? 0.3 : 0.8;
    filter.connect(output);
    output.connect(master);
    const send = context.createGain();
    send.gain.value = preset.wet;
    output.connect(send).connect(reverb);
    const frequency = track.source.instrument.percussion
      ? 58 + (note.midi % 12) * 11
      : 440 * 2 ** ((note.midi - 69) / 12);
    const isHarp = Boolean(preset.harp);
    const oscillators = isHarp
      ? []
      : preset.kalimba
      ? [
          { wave: "sine" as OscillatorType, ratio: 1, mix: 0.68, detune: -1.5, decayScale: 1 },
          { wave: "sine" as OscillatorType, ratio: 2.76, mix: 0.23, detune: 1, decayScale: 0.48 },
          { wave: "sine" as OscillatorType, ratio: 5.4, mix: 0.09, detune: -2, decayScale: 0.22 },
        ]
      : [
          { wave: preset.wave, ratio: 1, mix: 0.72, detune: -preset.detune / 2, decayScale: 1 },
          { wave: preset.second, ratio: track.source.instrument.percussion ? 1.9 : 1, mix: 0.28, detune: preset.detune, decayScale: preset.mode === "sustained" ? 1 : 0.62 },
        ];
    const voice: ActiveVoice = { gain: output, sources: new Set() };
    voicesRef.current.add(voice);
    if (isHarp) {
      const string = context.createBufferSource();
      string.buffer = makeHarpString(context, frequency, preset.release);
      const stringGain = context.createGain();
      stringGain.gain.setValueAtTime(0.0001, start);
      stringGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, note.velocity * preset.level), start + preset.attack);
      string.connect(stringGain).connect(filter);
      string.start(start);
      string.stop(end + 0.04);
      voice.sources.add(string);
      string.onended = () => {
        voice.sources.delete(string);
        if (!voice.sources.size) voicesRef.current.delete(voice);
      };
    }
    oscillators.forEach(({ wave, ratio, mix: mixLevel, detune, decayScale }) => {
      const oscillator = context.createOscillator();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency * ratio, start);
      oscillator.detune.value = detune;
      const mix = context.createGain();
      const peak = Math.max(0.0002, note.velocity * preset.level * mixLevel);
      const attackEnd = Math.min(noteOff, start + preset.attack);
      mix.gain.setValueAtTime(0.0001, start);
      mix.gain.exponentialRampToValueAtTime(peak, attackEnd);
      if (preset.mode === "sustained") {
        const decayEnd = Math.min(noteOff, attackEnd + preset.decay);
        const sustainLevel = Math.max(0.0002, peak * preset.sustain);
        mix.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
        mix.gain.setValueAtTime(sustainLevel, noteOff);
        mix.gain.exponentialRampToValueAtTime(0.0001, end);
      } else {
        const partialEnd = start + Math.max(0.055, preset.release * decayScale);
        mix.gain.exponentialRampToValueAtTime(0.0001, partialEnd);
      }
      oscillator.connect(mix).connect(filter);
      oscillator.start(start);
      oscillator.stop(end + 0.04);
      voice.sources.add(oscillator);
      oscillator.onended = () => {
        voice.sources.delete(oscillator);
        if (!voice.sources.size) voicesRef.current.delete(voice);
      };
    });
    if (track.source.instrument.percussion) {
      const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.08), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      const noiseGain = context.createGain();
      const noiseVoice: ActiveVoice = { gain: noiseGain, sources: new Set([noise]) };
      noiseGain.gain.setValueAtTime(note.velocity * 0.04, start);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
      noise.connect(noiseGain).connect(master);
      noise.start(start);
      noise.stop(start + 0.08);
      voicesRef.current.add(noiseVoice);
      noise.onended = () => voicesRef.current.delete(noiseVoice);
    }
  }, [ensureAudio, savedTimbres]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    cancelAnimationFrame(animationRef.current);
    stopVoices();
  }, [stopVoices]);

  const duration = project?.midi.duration ?? 0;
  const play = useCallback(() => {
    if (!project || !project.tracks.length) return;
    ensureAudio();
    const nextPosition = position >= project.midi.duration - 0.02 ? 0 : position;
    if (nextPosition !== position) setPosition(nextPosition);
    positionStartRef.current = nextPosition;
    playbackStartRef.current = performance.now();
    scheduledRef.current.clear();
    setIsPlaying(true);
  }, [ensureAudio, position, project]);

  useEffect(() => {
    if (!isPlaying || !project) return;
    const frame = () => {
      const now = positionStartRef.current + (performance.now() - playbackStartRef.current) / 1000;
      const liveDuration = projectRef.current?.midi.duration ?? 0;
      if (now >= liveDuration) {
        setPosition(liveDuration);
        setIsPlaying(false);
        stopVoices();
        return;
      }
      setPosition(now);
      const lookahead = 0.12;
      audibleTracks(projectRef.current?.tracks ?? []).forEach((track) => {
        track.source.notes.forEach((note, noteIndex) => {
          const key = `${track.id}-${noteIndex}`;
          if (!scheduledRef.current.has(key) && note.time >= now && note.time < now + lookahead) {
            scheduledRef.current.add(key);
            triggerNote(note, track, note.time - now);
          }
        });
      });
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationRef.current);
  }, [audibleTracks, isPlaying, project, stopVoices, triggerNote]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      if (isPlaying) pause(); else play();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, pause, play]);

  const activeTempo = project ? currentTempo(project.midi, position) : 120;
  const activeKey = project ? currentKey(project, position) : { key: "C", scale: "major" as const, ticks: 0, estimated: true };
  const sustainCount = useMemo(
    () => project?.tracks.reduce((sum, track) => sum + (track.source.controlChanges[64]?.length ?? 0), 0) ?? 0,
    [project],
  );

  async function loadFile(file?: File) {
    if (!file) return;
    if (!/\.midi?$/i.test(file.name)) {
      setError("请选择 .mid 或 .midi 文件");
      return;
    }
    try {
      pause();
      const midi = new Midi(await file.arrayBuffer());
      midi.header.update();
      const nextProject = projectFromMidi(midi, file.name);
      setProject(nextProject);
      setPosition(0);
      setTempoDraft(Math.round(currentTempo(midi, 0)));
      const firstKey = currentKey(nextProject, 0);
      setKeyDraft(firstKey.key);
      setScaleDraft(firstKey.scale);
      setError("");
      setShowTools(false);
      setTimbreTrackId(null);
      setTimbreDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取这个 MIDI 文件");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function toggleTrack(id: number, kind: "muted" | "solo") {
    setProject((current) => current ? {
      ...current,
      tracks: current.tracks.map((track) => track.id === id ? { ...track, [kind]: !track[kind] } : track),
    } : current);
    stopVoices();
    scheduledRef.current.clear();
  }

  function seek(next: number) {
    const wasPlaying = isPlaying;
    pause();
    setPosition(next);
    positionStartRef.current = next;
    if (wasPlaying) window.setTimeout(() => {
      playbackStartRef.current = performance.now();
      scheduledRef.current.clear();
      setIsPlaying(true);
    }, 0);
  }

  function addTempoEvent() {
    if (!project) return;
    const ticks = Math.max(0, Math.round(project.midi.header.secondsToTicks(position)));
    project.midi.header.tempos = [
      ...project.midi.header.tempos.filter((event) => event.ticks !== ticks),
      { ticks, bpm: Math.max(30, Math.min(300, tempoDraft)) },
    ].sort((a, b) => a.ticks - b.ticks);
    project.midi.header.update();
    setProject({ ...project });
    scheduledRef.current.clear();
    notify({ text: `已在 ${formatTime(position)} 设置 ${tempoDraft} BPM` });
  }

  function addKeyEvent() {
    if (!project) return;
    const ticks = Math.max(0, Math.round(project.midi.header.secondsToTicks(position)));
    project.midi.header.keySignatures = [
      ...project.midi.header.keySignatures.filter((event) => event.ticks !== ticks),
      { ticks, key: keyDraft, scale: scaleDraft },
    ].sort((a, b) => a.ticks - b.ticks);
    project.midi.header.update();
    setProject({ ...project });
    notify({ text: `已在 ${formatTime(position)} 设置 ${formatKey({ key: keyDraft, scale: scaleDraft, ticks })}` });
  }

  function clearSustain() {
    if (!project || !sustainCount) {
      notify({ text: "当前文件没有 Sustain 踏板事件" });
      return;
    }
    const backup = project.tracks.map((track) => [...(track.source.controlChanges[64] ?? [])]);
    project.tracks.forEach((track) => { track.source.controlChanges[64] = []; });
    setProject({ ...project });
    notify({
      text: `已删除 ${sustainCount} 个 Sustain 事件`,
      action: {
        label: "撤销",
        run: () => {
          project.tracks.forEach((track, index) => { track.source.controlChanges[64] = backup[index]; });
          setProject({ ...project });
          setToast(null);
        },
      },
    });
  }

  function deleteTrack(id: number) {
    if (!project) return;
    const target = project.tracks.find((track) => track.id === id);
    if (!target) return;
    const midiIndex = project.midi.tracks.indexOf(target.source);
    const uiIndex = project.tracks.indexOf(target);
    project.midi.tracks.splice(midiIndex, 1);
    const nextTracks = project.tracks.filter((track) => track.id !== id);
    setProject({ ...project, tracks: nextTracks });
    stopVoices();
    notify({
      text: `已删除 “${target.displayName}”`,
      action: {
        label: "撤销",
        run: () => {
          project.midi.tracks.splice(midiIndex, 0, target.source);
          const restored = [...nextTracks];
          restored.splice(uiIndex, 0, target);
          setProject({ ...project, tracks: restored });
          setToast(null);
        },
      },
    });
  }

  function openTimbrePanel(track: UiTrack) {
    const base = editableSettings(presetFor(track.source));
    const saved = savedTimbres[timbreKey(track.source)];
    setTimbreTrackId(track.id);
    setTimbreDraft(saved ? clampTimbre(saved) : base);
  }

  function previewTimbre() {
    if (!project || timbreTrackId === null || !timbreDraft) return;
    const track = project.tracks.find((item) => item.id === timbreTrackId);
    if (!track || !track.source.notes.length) return;
    const notes = [...track.source.notes].sort((a, b) => a.midi - b.midi);
    const note = notes[Math.floor(notes.length / 2)];
    stopVoices();
    triggerNote(note, track, 0, timbreDraft, presetFor(track.source).mode === "sustained" ? 0.85 : 0.65);
  }

  function saveTimbre() {
    if (!project || timbreTrackId === null || !timbreDraft) return;
    const track = project.tracks.find((item) => item.id === timbreTrackId);
    if (!track) return;
    const key = timbreKey(track.source);
    const settings = clampTimbre(timbreDraft);
    const next = { ...savedTimbres, [key]: settings };
    setSavedTimbres(next);
    window.localStorage.setItem(TIMBRE_STORAGE_KEY, JSON.stringify(next));
    setTimbreDraft(settings);
    scheduledRef.current.clear();
    notify({ text: `已永久保存 ${instrumentLabel(track.source)} 的音色` });
  }

  function resetTimbre() {
    if (!project || timbreTrackId === null) return;
    const track = project.tracks.find((item) => item.id === timbreTrackId);
    if (!track) return;
    const key = timbreKey(track.source);
    const next = { ...savedTimbres };
    delete next[key];
    setSavedTimbres(next);
    window.localStorage.setItem(TIMBRE_STORAGE_KEY, JSON.stringify(next));
    setTimbreDraft(editableSettings(presetFor(track.source)));
    scheduledRef.current.clear();
    notify({ text: `已恢复 ${instrumentLabel(track.source)} 的默认音色` });
  }

  function exportMidi() {
    if (!project) return;
    const exportCopy = project.midi.clone();
    exportCopy.name = utf8ByteString(repairMidiText(project.midi.name));
    project.tracks.forEach((track) => {
      const sourceIndex = project.midi.tracks.indexOf(track.source);
      if (sourceIndex >= 0 && exportCopy.tracks[sourceIndex]) {
        exportCopy.tracks[sourceIndex].name = utf8ByteString(track.displayName);
      }
    });
    const bytes = exportCopy.toArray();
    const exportBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(exportBuffer).set(bytes);
    const blob = new Blob([exportBuffer], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const base = project.name.replace(/\.midi?$/i, "") || "harmonic";
    anchor.href = url;
    anchor.download = `${base}-edited.mid`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify({ text: `已另存为 ${base}-edited.mid` });
  }

  const progress = duration ? Math.min(100, (position / duration) * 100) : 0;
  const timbreTrack = timbreTrackId === null ? null : project?.tracks.find((track) => track.id === timbreTrackId) ?? null;
  const timbreMode = timbreTrack ? presetFor(timbreTrack.source).mode : null;

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand">
          <span className="brand-bars"><i /><i /><i /><i /></span>
          <span>HARMONIC</span>
          <small>MIDI PLAYER</small>
        </div>
        <div className="header-actions">
          {project && <button className="save-button" onClick={exportMidi}>↓ 另存为 MIDI</button>}
          <button className="import-small" onClick={() => inputRef.current?.click()}><span>＋</span> 导入 MIDI</button>
        </div>
      </header>

      {!project ? (
        <section
          className={`empty-state ${isDragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            loadFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="empty-orbit"><span>♪</span></div>
          <p className="eyebrow">MIDI TRACK PLAYER</p>
          <h1>导入 MIDI，<br />马上开始聆听。</h1>
          <p className="empty-copy">自动分轨、播放与编辑 Tempo / Key，<br />最后另存为新的 MIDI 文件。</p>
          <button className="primary-import" onClick={() => inputRef.current?.click()}>选择 MIDI 文件 <span>↗</span></button>
          <button className="demo-button" onClick={() => {
            const demo = makeDemoProject();
            setProject(demo);
            setTempoDraft(112);
            setKeyDraft("C");
            setScaleDraft("minor");
            setError("");
          }}>或打开示例工程</button>
          <p className="privacy-note">支持 .mid / .midi · 文件只在浏览器本地读取</p>
          {error && <p className="error-message">{error}</p>}
        </section>
      ) : (
        <section className="player">
          <div className="project-summary">
            <div>
              <p className="eyebrow">NOW LOADED</p>
              <h1>{project.name}</h1>
              <p>{project.tracks.length} 条音轨 <i /> {formatTime(duration)} <i /> {project.midi.header.tempos.length} Tempo 事件 <i /> {project.midi.header.keySignatures.length || "估算"} Key</p>
            </div>
            <button className="replace-button" onClick={() => inputRef.current?.click()}>更换文件</button>
          </div>

          <div className="transport-card">
            <button className="jump-button" aria-label="回到开头" onClick={() => seek(0)}>│◀</button>
            <button className={`main-play ${isPlaying ? "playing" : ""}`} aria-label={isPlaying ? "暂停" : "播放"} onClick={isPlaying ? pause : play}>
              {isPlaying ? "Ⅱ" : "▶"}
            </button>
            <div className="time-current">{formatTime(position)}</div>
            <div
              className="scrubber"
              style={laneGeometry.width > 0 ? { left: `${laneGeometry.left}px`, width: `${laneGeometry.width}px` } : undefined}
            >
              <div className="scrubber-fill" style={{ width: `${progress}%` }} />
              {project.midi.header.tempos.map((event, index) => (
                <span className="event-marker tempo-marker" key={`tempo-${index}`} style={{ left: `${(project.midi.header.ticksToSeconds(event.ticks) / duration) * 100}%` }} />
              ))}
              {project.midi.header.keySignatures.map((event, index) => (
                <span className="event-marker key-marker" key={`key-${index}`} style={{ left: `${(project.midi.header.ticksToSeconds(event.ticks) / duration) * 100}%` }} />
              ))}
              <input aria-label="播放进度" type="range" min="0" max={duration} step="0.01" value={position} onChange={(event) => seek(Number(event.target.value))} />
            </div>
            <div className="time-total">{formatTime(duration)}</div>
            <div className="live-readouts">
              <div><span>TEMPO</span><strong>{Math.round(activeTempo)} <small>BPM</small></strong></div>
              <div><span>KEY {activeKey.estimated ? "· EST." : ""}</span><strong>{formatKey(activeKey)}</strong></div>
            </div>
          </div>

          <div className={`edit-tools ${showTools ? "open" : ""}`}>
            <button className="tools-toggle" onClick={() => setShowTools((open) => !open)}>
              <span>在播放头位置修改 Tempo / Key</span><b>{showTools ? "−" : "＋"}</b>
            </button>
            {showTools && (
              <div className="tools-body">
                <div className="event-editor">
                  <span className="editor-label">TEMPO AT {formatTime(position)}</span>
                  <input aria-label="新 Tempo" type="number" min="30" max="300" value={tempoDraft} onChange={(event) => setTempoDraft(Number(event.target.value))} />
                  <small>BPM</small>
                  <button onClick={addTempoEvent}>应用</button>
                </div>
                <div className="event-editor key-editor">
                  <span className="editor-label">KEY AT {formatTime(position)}</span>
                  <select aria-label="新 Key" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)}>
                    {KEYS.map((key) => <option value={key} key={key}>{key}</option>)}
                  </select>
                  <select aria-label="新调式" value={scaleDraft} onChange={(event) => setScaleDraft(event.target.value as "major" | "minor")}>
                    <option value="major">Major</option><option value="minor">Minor</option>
                  </select>
                  <button onClick={addKeyEvent}>应用</button>
                </div>
                <button className="sustain-button" onClick={clearSustain}>
                  <span>⌫</span><div><strong>清除所有 Sustain</strong><small>{sustainCount} 个 CC64 事件</small></div>
                </button>
              </div>
            )}
          </div>

          <div className="track-heading">
            <span>音轨</span>
            <span>{audibleTracks(project.tracks).length} / {project.tracks.length} 正在发声</span>
          </div>

          <div className="track-list" ref={trackListRef}>
            {laneGeometry.width > 0 && (
              <span
                className="global-playhead"
                aria-hidden="true"
                style={{ left: `${laneGeometry.left + laneGeometry.width * progress / 100}px` }}
              />
            )}
            {project.tracks.map((track, index) => {
              const hasSolo = project.tracks.some((item) => item.solo);
              const audible = !track.muted && (!hasSolo || track.solo);
              const minPitch = Math.min(...track.source.notes.map((note) => note.midi));
              const maxPitch = Math.max(...track.source.notes.map((note) => note.midi));
              const range = Math.max(1, maxPitch - minPitch);
              return (
                <article className={`track-row ${audible ? "" : "inaudible"}`} key={track.id}>
                  <div className="track-index" style={{ color: track.color }}>{String(index + 1).padStart(2, "0")}</div>
                  <button className="track-meta" onClick={() => openTimbrePanel(track)} aria-label={`调节 ${instrumentLabel(track.source)} 音色`}>
                    <strong>{track.displayName}</strong>
                    <span>CH {track.source.channel + 1} · {instrumentLabel(track.source)} · {track.source.notes.length} notes</span>
                    <em>{savedTimbres[timbreKey(track.source)] ? "已保存自定义音色 · 点击调节" : "点击调节音色"}</em>
                  </button>
                  <div className="track-lane">
                    <div className="track-progress" style={{ width: `${progress}%`, background: track.color }} />
                    {track.source.notes.slice(0, 900).map((note, noteIndex) => (
                      <i
                        key={noteIndex}
                        style={{
                          left: `${(note.time / duration) * 100}%`,
                          width: `${Math.max(0.18, (note.duration / duration) * 100)}%`,
                          bottom: `${8 + ((note.midi - minPitch) / range) * 70}%`,
                          background: track.color,
                          opacity: 0.5 + note.velocity * 0.5,
                        }}
                      />
                    ))}
                  </div>
                  <div className="track-controls">
                    <button className={track.muted ? "active mute" : ""} aria-label={`${track.displayName} 静音`} aria-pressed={track.muted} onClick={() => toggleTrack(track.id, "muted")}>M</button>
                    <button className={track.solo ? "active solo" : ""} aria-label={`${track.displayName} 独奏`} aria-pressed={track.solo} onClick={() => toggleTrack(track.id, "solo")}>S</button>
                    <button className="delete-track" aria-label={`删除 ${track.displayName}`} onClick={() => deleteTrack(track.id)}>×</button>
                  </div>
                </article>
              );
            })}
            {!project.tracks.length && <div className="no-tracks">所有轨道都已删除 · 可以撤销上一项操作或导入新的 MIDI</div>}
          </div>
        </section>
      )}

      <input ref={inputRef} className="visually-hidden" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" onChange={(event) => loadFile(event.target.files?.[0])} />
      {timbreTrack && timbreDraft && (
        <div className="timbre-backdrop" onMouseDown={() => setTimbreTrackId(null)}>
          <aside className="timbre-panel" role="dialog" aria-modal="true" aria-labelledby="timbre-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="timbre-titlebar">
              <div>
                <span>INSTRUMENT SOUND</span>
                <h2 id="timbre-title">{instrumentLabel(timbreTrack.source)}</h2>
                <p>Program {timbreTrack.source.instrument.number} · 保存后自动用于其他 MIDI</p>
              </div>
              <button aria-label="关闭音色面板" onClick={() => setTimbreTrackId(null)}>×</button>
            </div>

            <div className="timbre-controls">
              <label>
                <span>起音 <b>{Math.round(timbreDraft.attack * 1000)} ms</b></span>
                <input type="range" min="0.001" max="0.4" step="0.001" value={timbreDraft.attack} onChange={(event) => setTimbreDraft({ ...timbreDraft, attack: Number(event.target.value) })} />
              </label>
              {timbreMode === "sustained" && (
                <>
                  <label>
                    <span>衰减 <b>{timbreDraft.decay.toFixed(2)} s</b></span>
                    <input type="range" min="0.03" max="1.2" step="0.01" value={timbreDraft.decay} onChange={(event) => setTimbreDraft({ ...timbreDraft, decay: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>保持音量 <b>{Math.round(timbreDraft.sustain * 100)}%</b></span>
                    <input type="range" min="0" max="1" step="0.01" value={timbreDraft.sustain} onChange={(event) => setTimbreDraft({ ...timbreDraft, sustain: Number(event.target.value) })} />
                  </label>
                </>
              )}
              <label>
                <span>自然尾音 <b>{timbreDraft.release.toFixed(2)} s</b></span>
                <input type="range" min="0.08" max="4" step="0.01" value={timbreDraft.release} onChange={(event) => setTimbreDraft({ ...timbreDraft, release: Number(event.target.value) })} />
              </label>
              <label>
                <span>明亮度 <b>{Math.round(timbreDraft.filter)} Hz</b></span>
                <input type="range" min="300" max="10000" step="50" value={timbreDraft.filter} onChange={(event) => setTimbreDraft({ ...timbreDraft, filter: Number(event.target.value) })} />
              </label>
              <label>
                <span>音量 <b>{Math.round((timbreDraft.level / 0.2) * 100)}%</b></span>
                <input type="range" min="0.02" max="0.2" step="0.002" value={timbreDraft.level} onChange={(event) => setTimbreDraft({ ...timbreDraft, level: Number(event.target.value) })} />
              </label>
              <label>
                <span>空间感 <b>{Math.round(timbreDraft.wet * 200)}%</b></span>
                <input type="range" min="0" max="0.5" step="0.01" value={timbreDraft.wet} onChange={(event) => setTimbreDraft({ ...timbreDraft, wet: Number(event.target.value) })} />
              </label>
            </div>

            <div className="timbre-actions">
              <button className="preview-timbre" onClick={previewTimbre}>▶ 试听当前设置</button>
              <button onClick={resetTimbre}>恢复默认</button>
              <button className="save-timbre" onClick={saveTimbre}>保存音色</button>
            </div>
            <p className="timbre-storage-note">音色保存在此浏览器中；同一 MIDI 乐器编号会自动调用。</p>
          </aside>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.action && <button onClick={toast.action.run}>{toast.action.label}</button>}
        </div>
      )}
      <footer><span>HARMONIC / LOCAL MIDI ENGINE</span><span><kbd>SPACE</kbd> PLAY / PAUSE</span></footer>
    </main>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
