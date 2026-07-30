"use client";

import { Midi, Track } from "@tonejs/midi";
import { parseMidi, writeMidi } from "midi-file";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudInstrument,
  CustomTimbre,
  ProgramMapping,
  fetchCustomTimbres,
  fetchInstruments,
  fetchMappings,
} from "./lib/timbres";

type UiTrack = {
  id: number;
  source: Track;
  displayName: string;
  muted: boolean;
  solo: boolean;
  segments: TrackSegment[];
  excludedFromExport?: boolean;
  practiceGenerated?: boolean;
  practicePreviousMuted?: boolean;
  practicePreviousSolo?: boolean;
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
  transposeKalimba?: boolean;
  resonance?: number;
  harmonics?: number;
};

type TimbreSettings = Pick<SynthPreset, "attack" | "decay" | "sustain" | "release" | "filter" | "level" | "wet"> & {
  resonance: number;
  harmonics: number;
};

type Toast = {
  text: string;
  action?: { label: string; run: () => void };
};

type TrackSegment = {
  id: string;
  startTick: number;
  durationTicks: number;
};

type RegionGesture = {
  pointerId: number;
  trackId: number;
  segmentId: string;
  mode: "move" | "trim-start" | "trim-end";
  originClientX: number;
  originalStartTick: number;
  originalDurationTicks: number;
};

type HistoryTrack = Omit<UiTrack, "source"> & {
  midiTrackIndex: number;
  noteRegionIds: Array<string | null>;
  controlRegionIds: Record<string, Array<string | null>>;
};

type EditorSnapshot = {
  midiBytes: number[];
  name: string;
  estimatedKey: KeyEvent;
  tracks: HistoryTrack[];
  trackTimbreOverrides: Record<number, number>;
  position: number;
};

type RulerMark = {
  ticks: number;
  kind: "measure" | "beat" | "division";
  label?: string;
};

type SustainRange = {
  startTick: number;
  endTick: number;
};

type PracticeCategory = "melody" | "harmony" | "bass" | "pad" | "drums" | "effects";

const KEYS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const PITCH_CLASS_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const TIMBRE_STORAGE_KEY = "harmonic-midi-saved-timbres-v1";
const GM_FAMILY_IDS = ["piano", "chromatic percussion", "organ", "guitar", "bass", "strings", "ensemble", "brass", "reed", "pipe", "synth lead", "synth pad", "synth effects", "ethnic", "percussive", "sound effects"];
const eventRegionIds = new WeakMap<object, string>();
let splitRegionSequence = 1;
const HISTORY_LIMIT = 30;
const PRACTICE_CATEGORIES: { id: PracticeCategory; label: string; detail: string }[] = [
  { id: "melody", label: "旋律", detail: "主旋律、独奏、歌唱线" },
  { id: "harmony", label: "和声", detail: "钢琴、吉他与和弦声部" },
  { id: "bass", label: "低音", detail: "Bass 与低音声部" },
  { id: "pad", label: "铺底", detail: "弦乐、Pad 与长音" },
  { id: "drums", label: "鼓组", detail: "通道 10 的打击乐" },
  { id: "effects", label: "音效", detail: "效果与特殊打击乐" },
];
const DEFAULT_PRACTICE_CATEGORIES: Record<PracticeCategory, boolean> = {
  melody: true,
  harmony: true,
  bass: true,
  pad: false,
  drums: false,
  effects: false,
};
function segmentId(trackId: number) {
  return `segment-${trackId}-1`;
}

function initialSegments(source: Track, trackId: number): TrackSegment[] {
  if (!source.notes.length) return [];
  const id = segmentId(trackId);
  source.notes.forEach((note) => eventRegionIds.set(note, id));
  Object.values(source.controlChanges).forEach((events) => events?.forEach((control) => eventRegionIds.set(control, id)));
  const startTick = Math.min(...source.notes.map((note) => note.ticks));
  const endTick = Math.max(...source.notes.map((note) => note.ticks + note.durationTicks));
  return [{
    id,
    startTick,
    durationTicks: Math.max(1, endTick - startTick),
  }];
}

function belongsToRegion(event: object, regionId: string) {
  return eventRegionIds.get(event) === regionId;
}

function regionsOverlap(startTick: number, durationTicks: number, segment: TrackSegment) {
  const endTick = startTick + durationTicks;
  const segmentEnd = segment.startTick + segment.durationTicks;
  return startTick < segmentEnd && endTick > segment.startTick;
}

function closestAvailableRegionStart(
  requestedStart: number,
  durationTicks: number,
  siblings: TrackSegment[],
  maxStart: number,
) {
  const candidates = [
    requestedStart,
    0,
    maxStart,
    ...siblings.flatMap((segment) => [
      segment.startTick + segment.durationTicks,
      segment.startTick - durationTicks,
    ]),
  ]
    .map((value) => Math.max(0, Math.min(maxStart, value)))
    .filter((value) => siblings.every((segment) => !regionsOverlap(value, durationTicks, segment)));
  return candidates.sort((a, b) => Math.abs(a - requestedStart) - Math.abs(b - requestedStart))[0] ?? null;
}

function sustainRangesFromEvents(events: Array<{ ticks: number; value: number }>, fallbackEndTick: number): SustainRange[] {
  const sortedEvents = [...events].sort((a, b) => a.ticks - b.ticks);
  const ranges: SustainRange[] = [];
  let startTick: number | null = null;
  sortedEvents.forEach((event) => {
    if (event.value >= 0.5 && startTick === null) {
      startTick = event.ticks;
    } else if (event.value < 0.5 && startTick !== null) {
      if (event.ticks > startTick) ranges.push({ startTick, endTick: event.ticks });
      startTick = null;
    }
  });
  if (startTick !== null) ranges.push({ startTick, endTick: Math.max(startTick + 1, fallbackEndTick) });
  return ranges;
}

function buildSustainRanges(track: Track, durationTicks: number): SustainRange[] {
  return sustainRangesFromEvents(track.controlChanges[64] ?? [], durationTicks);
}

function activeTimeSignature(midi: Midi, ticks: number) {
  const event = [...midi.header.timeSignatures]
    .sort((a, b) => a.ticks - b.ticks)
    .reverse()
    .find((item) => item.ticks <= ticks);
  return event?.timeSignature ?? [4, 4];
}

function buildRulerMarks(midi: Midi): RulerMark[] {
  const durationTicks = Math.max(1, midi.durationTicks);
  const signatures = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks);
  const marks: RulerMark[] = [];
  const sixteenthTicks = Math.max(1, midi.header.ppq / 4);
  let cursor = 0;
  let measure = 1;
  while (cursor <= durationTicks && marks.length < 5000) {
    const signature = activeTimeSignature(midi, cursor);
    const numerator = signature[0];
    const denominator = signature[1];
    const beatTicks = midi.header.ppq * 4 / denominator;
    const barTicks = Math.max(sixteenthTicks, numerator * beatTicks);
    const nextSignature = signatures.find((event) => event.ticks > cursor && event.ticks < cursor + barTicks);
    const measureEnd = nextSignature?.ticks ?? cursor + barTicks;
    for (let tick = cursor; tick < measureEnd && tick <= durationTicks; tick += sixteenthTicks) {
      const offset = tick - cursor;
      const onBeat = Math.abs(offset / beatTicks - Math.round(offset / beatTicks)) < 0.001;
      marks.push({
        ticks: Math.round(tick),
        kind: offset === 0 ? "measure" : onBeat ? "beat" : "division",
        label: offset === 0 ? String(measure) : undefined,
      });
    }
    cursor = Math.max(cursor + 1, measureEnd);
    measure += 1;
  }
  return marks;
}

function thinRulerMarks(midi: Midi, marks: RulerMark[], viewStart: number, viewEnd: number, width: number) {
  if (width <= 0 || viewEnd <= viewStart) return [];
  const visible = marks.map((mark) => ({
    ...mark,
    x: ((midi.header.ticksToSeconds(mark.ticks) - viewStart) / (viewEnd - viewStart)) * width,
  })).filter((mark) => mark.x >= 0 && mark.x <= width);
  const kept: Array<RulerMark & { x: number }> = [];
  let lastMeasureX = -Infinity;
  let lastLabelX = -Infinity;
  visible.filter((mark) => mark.kind === "measure").forEach((mark) => {
    if (mark.x - lastMeasureX < 5) return;
    kept.push({ ...mark, label: mark.x - lastLabelX >= 34 ? mark.label : undefined });
    lastMeasureX = mark.x;
    if (mark.label && mark.x - lastLabelX >= 34) lastLabelX = mark.x;
  });
  let lastBeatX = -Infinity;
  visible.filter((mark) => mark.kind === "beat").forEach((mark) => {
    const nearMeasure = kept.some((item) => item.kind === "measure" && Math.abs(item.x - mark.x) < 5);
    if (!nearMeasure && mark.x - lastBeatX >= 7) {
      kept.push(mark);
      lastBeatX = mark.x;
    }
  });
  let lastDivisionX = -Infinity;
  visible.filter((mark) => mark.kind === "division").forEach((mark) => {
    const nearStructural = kept.some((item) => item.kind !== "division" && Math.abs(item.x - mark.x) < 5);
    if (!nearStructural && mark.x - lastDivisionX >= 9) {
      kept.push(mark);
      lastDivisionX = mark.x;
    }
  });
  return kept.sort((a, b) => a.ticks - b.ticks);
}

function timelineValueChanges<T extends { ticks: number }>(events: T[], valueOf: (event: T) => string, initialValue: string) {
  const lastAtTick = new Map<number, T>();
  [...events].sort((a, b) => a.ticks - b.ticks).forEach((event) => lastAtTick.set(event.ticks, event));
  let previous = initialValue;
  return [...lastAtTick.values()].sort((a, b) => a.ticks - b.ticks).filter((event) => {
    const value = valueOf(event);
    const changed = value !== previous;
    previous = value;
    return changed;
  });
}

function encodeMidiWithValidKeySignatures(midi: Midi) {
  const parsed = parseMidi(midi.toArray());
  const signatures = [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks);
  let signatureIndex = 0;
  parsed.tracks.forEach((track) => track.forEach((event) => {
    if (event.type !== "keySignature") return;
    const signature = signatures[signatureIndex];
    signatureIndex += 1;
    if (!signature) return;
    const keyIndex = KEYS.indexOf(signature.key);
    event.key = keyIndex >= 0 ? keyIndex - 7 : 0;
    event.scale = signature.scale === "minor" ? 1 : 0;
  }));
  return Uint8Array.from(writeMidi(parsed));
}

function classifyTrackForPractice(track: Track): PracticeCategory {
  const name = `${track.name} ${track.instrument.name}`.toLowerCase();
  const program = track.instrument.number;
  const family = track.instrument.percussion ? "percussion" : GM_FAMILY_IDS[Math.floor(program / 8)];
  if (track.instrument.percussion || track.channel === 9 || /drum|kit|鼓|打击/.test(name)) return "drums";
  if (family === "bass" || /(^|\W)bass|低音|贝斯/.test(name)) return "bass";
  if (family === "synth effects" || family === "sound effects" || /\bfx\b|effect|效果|音效/.test(name)) return "effects";
  if (family === "strings" || family === "ensemble" || family === "synth pad" || /pad|string|弦乐|铺底/.test(name)) return "pad";
  if (/melody|lead|vocal|voice|solo|主旋律|旋律|人声|独奏/.test(name)) return "melody";
  if (/chord|harmony|伴奏|和声|和弦/.test(name)) return "harmony";
  const notes = [...track.notes].sort((a, b) => a.ticks - b.ticks);
  if (!notes.length) return "effects";
  const averagePitch = notes.reduce((sum, note) => sum + note.midi, 0) / notes.length;
  let overlaps = 0;
  let latestEnd = -1;
  notes.forEach((note) => {
    if (note.ticks < latestEnd) overlaps += 1;
    latestEnd = Math.max(latestEnd, note.ticks + note.durationTicks);
  });
  return overlaps / notes.length < 0.14 && averagePitch >= 52 ? "melody" : "harmony";
}

function fitToPianoRange(midi: number) {
  let pitch = midi;
  while (pitch < 36) pitch += 12;
  while (pitch > 96) pitch -= 12;
  return pitch;
}


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
    tracks: playable.map((source, index) => {
      const id = index + 1;
      return {
        id,
        source,
        displayName: repairMidiText(source.name) || source.instrument.name || `Track ${id}`,
        muted: false,
        solo: false,
        segments: initialSegments(source, id),
      };
    }),
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

function colorForTimbre(program: number, percussion = false) {
  const colorId = percussion ? 128 : Math.max(0, Math.min(127, program));
  const hue = (268 + colorId * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} 72% 66%)`;
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

function presetFor(track: Track, programOverride?: number, customTimbre?: CustomTimbre): SynthPreset {
  if (customTimbre) {
    const base = presetFor(track, customTimbre.baseProgram);
    return {
      ...base,
      attack: customTimbre.attack,
      decay: customTimbre.decay,
      sustain: customTimbre.sustain,
      release: customTimbre.release,
      filter: customTimbre.filter,
      filterEnd: Math.min(base.filterEnd, customTimbre.filter * 0.45),
      level: customTimbre.level,
      wet: customTimbre.wet,
      resonance: customTimbre.resonance,
      harmonics: customTimbre.harmonics,
      mode: customTimbre.engine === "kalimba" ? "plucked" : base.mode,
      kalimba: customTimbre.engine === "kalimba",
      transposeKalimba: customTimbre.engine === "kalimba" && customTimbre.transposeKalimba,
    };
  }
  const program = programOverride ?? track.instrument.number;
  const percussion = programOverride === undefined && track.instrument.percussion;
  const family = programOverride === undefined ? track.instrument.family : GM_FAMILY_IDS[Math.floor(program / 8)];
  if (program === 46 && !percussion) {
    return { wave: "triangle", second: "sine", detune: 4, filter: 3600, filterEnd: 620, attack: 0.006, decay: 0.18, sustain: 0, release: 2.4, level: 0.085, wet: 0.16, mode: "plucked", kalimba: false, resonance: 1.1, harmonics: 0.22 };
  }
  if (percussion) return { wave: "square" as OscillatorType, second: "sine" as OscillatorType, detune: 0, filter: 2300, filterEnd: 380, attack: 0.002, decay: 0.04, sustain: 0, release: 0.12, level: 0.1, wet: 0.03, mode: "percussion" as const, kalimba: false };
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

function clampTimbre(settings: TimbreSettings): TimbreSettings {
  const clamp = (value: number, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
  return {
    attack: clamp(settings.attack, 0.001, 0.4, 0.018),
    decay: clamp(settings.decay, 0.03, 1.2, 0.2),
    sustain: clamp(settings.sustain, 0, 1, 0.72),
    release: clamp(settings.release, 0.08, 4, 0.48),
    filter: clamp(settings.filter, 300, 10000, 2500),
    level: clamp(settings.level, 0.02, 0.2, 0.075),
    wet: clamp(settings.wet, 0, 0.5, 0.1),
    resonance: clamp(settings.resonance, 0.1, 12, 0.8),
    harmonics: clamp(settings.harmonics, 0, 1.5, 0.28),
  };
}

function settingsFromCloud(instrument: CloudInstrument | CustomTimbre): TimbreSettings {
  return clampTimbre({
    attack: instrument.attack,
    decay: instrument.decay,
    sustain: instrument.sustain,
    release: instrument.release,
    filter: instrument.filter,
    level: instrument.level,
    wet: instrument.wet,
    resonance: instrument.resonance,
    harmonics: instrument.harmonics,
  });
}

function instrumentLabel(track: Track) {
  return track.instrument.name;
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
  const [showPracticeMerge, setShowPracticeMerge] = useState(false);
  const [practiceCategories, setPracticeCategories] = useState(DEFAULT_PRACTICE_CATEGORIES);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineViewStart, setTimelineViewStart] = useState(0);
  const [laneGeometry, setLaneGeometry] = useState({ left: 0, width: 0 });
  const [selectedRegion, setSelectedRegion] = useState<{ trackId: number; segmentId: string } | null>(null);
  const [regionGesture, setRegionGesture] = useState<RegionGesture | null>(null);
  const [regionDropTrackId, setRegionDropTrackId] = useState<number | null>(null);
  const [regionDropInvalid, setRegionDropInvalid] = useState(false);
  const [savedTimbres, setSavedTimbres] = useState<Record<string, TimbreSettings>>({});
  const [cloudInstruments, setCloudInstruments] = useState<CloudInstrument[]>([]);
  const [customTimbres, setCustomTimbres] = useState<CustomTimbre[]>([]);
  const [programMappings, setProgramMappings] = useState<ProgramMapping[]>([]);
  const [trackTimbreOverrides, setTrackTimbreOverrides] = useState<Record<number, number>>({});
  const [timbrePickerTrackId, setTimbrePickerTrackId] = useState<number | null>(null);
  const [timbrePickerFavoritesOnly, setTimbrePickerFavoritesOnly] = useState(false);
  const [timbrePickerQuery, setTimbrePickerQuery] = useState("");
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
  const timelineScrollbarRef = useRef<HTMLDivElement | null>(null);
  const undoHistoryRef = useRef<EditorSnapshot[]>([]);
  const redoHistoryRef = useRef<EditorSnapshot[]>([]);
  const pendingRegionHistoryRef = useRef<EditorSnapshot | null>(null);

  useEffect(() => { projectRef.current = project; }, [project]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TIMBRE_STORAGE_KEY);
      if (stored) setSavedTimbres(JSON.parse(stored) as Record<string, TimbreSettings>);
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([fetchInstruments(), fetchCustomTimbres(), fetchMappings()])
      .then(([instruments, customItems, mappings]) => {
        setCloudInstruments(instruments);
        setCustomTimbres(customItems);
        setProgramMappings(mappings);
      })
      .catch(() => {});
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
    const programOverride = previewSettings ? undefined : trackTimbreOverrides[track.id];
    const effectiveProgram = programOverride ?? track.source.instrument.number;
    const cloudInstrument = cloudInstruments.find((instrument) => instrument.program === effectiveProgram);
    const mapping = programMappings.find((item) => item.program === effectiveProgram);
    const mappedCustom = customTimbres.find((item) => item.id === mapping?.customTimbreId);
    const basePreset = presetFor(track.source, programOverride, mappedCustom);
    const customSettings = previewSettings
      ?? (mappedCustom ? settingsFromCloud(mappedCustom) : cloudInstrument ? settingsFromCloud(cloudInstrument) : savedTimbres[timbreKey(track.source)]);
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
    filter.Q.value = preset.mode === "percussion" ? 0.3 : (preset.resonance ?? 0.8);
    filter.connect(output);
    output.connect(master);
    const send = context.createGain();
    send.gain.value = preset.wet;
    output.connect(send).connect(reverb);
    const frequency = preset.mode === "percussion"
      ? 58 + (note.midi % 12) * 11
      : 440 * 2 ** ((note.midi - 69) / 12);
    const oscillators = preset.transposeKalimba
      ? [
          { wave: "sine" as OscillatorType, ratio: 1, mix: 1, detune: 0, decayScale: 1 },
          { wave: "sine" as OscillatorType, ratio: 4.03, mix: preset.harmonics ?? 0.3, detune: 0, decayScale: 1 },
        ]
      : preset.kalimba
      ? [
          { wave: "sine" as OscillatorType, ratio: 1, mix: 0.68, detune: -1.5, decayScale: 1 },
          { wave: "sine" as OscillatorType, ratio: 2.76, mix: (preset.harmonics ?? 0.32) * 0.72, detune: 1, decayScale: 0.48 },
          { wave: "sine" as OscillatorType, ratio: 5.4, mix: (preset.harmonics ?? 0.32) * 0.28, detune: -2, decayScale: 0.22 },
        ]
      : [
          { wave: preset.wave, ratio: 1, mix: 0.72, detune: -preset.detune / 2, decayScale: 1 },
          { wave: preset.second, ratio: preset.mode === "percussion" ? 1.9 : 1, mix: preset.harmonics ?? 0.28, detune: preset.detune, decayScale: preset.mode === "sustained" ? 1 : 0.62 },
        ];
    const voice: ActiveVoice = { gain: output, sources: new Set() };
    voicesRef.current.add(voice);
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
    if (preset.mode === "percussion") {
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
  }, [cloudInstruments, customTimbres, ensureAudio, programMappings, savedTimbres, trackTimbreOverrides]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    cancelAnimationFrame(animationRef.current);
    stopVoices();
  }, [stopVoices]);

  function captureEditorSnapshot(): EditorSnapshot | null {
    if (!project) return null;
    return {
      midiBytes: Array.from(project.midi.toArray()),
      name: project.name,
      estimatedKey: { ...project.estimatedKey },
      tracks: project.tracks.map((track) => ({
        id: track.id,
        displayName: track.displayName,
        muted: track.muted,
        solo: track.solo,
        segments: track.segments.map((segment) => ({ ...segment })),
        excludedFromExport: track.excludedFromExport,
        practiceGenerated: track.practiceGenerated,
        practicePreviousMuted: track.practicePreviousMuted,
        practicePreviousSolo: track.practicePreviousSolo,
        midiTrackIndex: project.midi.tracks.indexOf(track.source),
        noteRegionIds: [...track.source.notes]
          .sort((a, b) => a.ticks - b.ticks || a.midi - b.midi || a.durationTicks - b.durationTicks)
          .map((note) => eventRegionIds.get(note) ?? null),
        controlRegionIds: Object.fromEntries(
          Object.entries(track.source.controlChanges).map(([number, events]) => [
            number,
            [...(events ?? [])]
              .sort((a, b) => a.ticks - b.ticks || a.value - b.value)
              .map((control) => eventRegionIds.get(control) ?? null),
          ]),
        ),
      })),
      trackTimbreOverrides: { ...trackTimbreOverrides },
      position,
    };
  }

  function restoreEditorSnapshot(snapshot: EditorSnapshot) {
    pause();
    const midi = new Midi(Uint8Array.from(snapshot.midiBytes));
    midi.header.update();
    const tracks = snapshot.tracks.flatMap((savedTrack): UiTrack[] => {
      const source = midi.tracks[savedTrack.midiTrackIndex];
      if (!source) return [];
      const sortedNotes = [...source.notes].sort((a, b) => a.ticks - b.ticks || a.midi - b.midi || a.durationTicks - b.durationTicks);
      savedTrack.noteRegionIds.forEach((regionId, index) => {
        if (regionId && sortedNotes[index]) eventRegionIds.set(sortedNotes[index], regionId);
      });
      Object.entries(savedTrack.controlRegionIds).forEach(([number, regionIds]) => {
        const controls = [...(source.controlChanges[Number(number)] ?? [])]
          .sort((a, b) => a.ticks - b.ticks || a.value - b.value);
        regionIds.forEach((regionId, index) => {
          if (regionId && controls[index]) eventRegionIds.set(controls[index], regionId);
        });
      });
      return [{
        id: savedTrack.id,
        source,
        displayName: savedTrack.displayName,
        muted: savedTrack.muted,
        solo: savedTrack.solo,
        segments: savedTrack.segments.map((segment) => ({ ...segment })),
        excludedFromExport: savedTrack.excludedFromExport,
        practiceGenerated: savedTrack.practiceGenerated,
        practicePreviousMuted: savedTrack.practicePreviousMuted,
        practicePreviousSolo: savedTrack.practicePreviousSolo,
      }];
    });
    setProject({
      name: snapshot.name,
      midi,
      tracks,
      estimatedKey: { ...snapshot.estimatedKey },
    });
    setTrackTimbreOverrides({ ...snapshot.trackTimbreOverrides });
    setPosition(Math.min(snapshot.position, midi.duration));
    setSelectedRegion(null);
    setRegionGesture(null);
    setRegionDropTrackId(null);
    setRegionDropInvalid(false);
    scheduledRef.current.clear();
  }

  function pushUndoSnapshot(snapshot = captureEditorSnapshot()) {
    if (!snapshot) return;
    undoHistoryRef.current = [...undoHistoryRef.current.slice(-(HISTORY_LIMIT - 1)), snapshot];
    redoHistoryRef.current = [];
  }

  function undoEditor() {
    const previous = undoHistoryRef.current.pop();
    const current = captureEditorSnapshot();
    if (!previous || !current) return;
    redoHistoryRef.current = [...redoHistoryRef.current.slice(-(HISTORY_LIMIT - 1)), current];
    restoreEditorSnapshot(previous);
    notify({ text: "已撤销上一步编辑" });
  }

  function redoEditor() {
    const next = redoHistoryRef.current.pop();
    const current = captureEditorSnapshot();
    if (!next || !current) return;
    undoHistoryRef.current = [...undoHistoryRef.current.slice(-(HISTORY_LIMIT - 1)), current];
    restoreEditorSnapshot(next);
    notify({ text: "已重做上一步编辑" });
  }

  function updateRegionSegment(trackId: number, segmentId: string, startTick: number, durationTicks: number) {
    if (!project) return;
    setProject({
      ...project,
      tracks: project.tracks.map((track) => track.id === trackId ? {
        ...track,
        segments: track.segments.map((segment) => segment.id === segmentId ? {
          ...segment,
          startTick,
          durationTicks,
        } : segment),
      } : track),
    });
  }

  function beginRegionGesture(
    event: React.PointerEvent<HTMLElement>,
    trackId: number,
    segment: TrackSegment,
    mode: RegionGesture["mode"],
  ) {
    event.preventDefault();
    event.stopPropagation();
    pause();
    event.currentTarget.setPointerCapture(event.pointerId);
    pendingRegionHistoryRef.current = captureEditorSnapshot();
    setSelectedRegion({ trackId, segmentId: segment.id });
    setRegionDropInvalid(false);
    setRegionGesture({
      pointerId: event.pointerId,
      trackId,
      segmentId: segment.id,
      mode,
      originClientX: event.clientX,
      originalStartTick: segment.startTick,
      originalDurationTicks: segment.durationTicks,
    });
  }

  function moveRegionGesture(event: React.PointerEvent<HTMLElement>) {
    if (!project || !regionGesture || event.pointerId !== regionGesture.pointerId || laneGeometry.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    let dropTrackId: number | null = null;
    if (regionGesture.mode === "move") {
      const dropRow = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-track-id]");
      dropTrackId = dropRow ? Number(dropRow.dataset.trackId) : null;
      setRegionDropTrackId(Number.isFinite(dropTrackId) ? dropTrackId : null);
    }
    const secondsDelta = ((event.clientX - regionGesture.originClientX) / laneGeometry.width) * visibleDuration;
    const originSeconds = project.midi.header.ticksToSeconds(regionGesture.originalStartTick);
    const targetTick = project.midi.header.secondsToTicks(Math.max(0, originSeconds + secondsDelta));
    const rawDelta = targetTick - regionGesture.originalStartTick;
    const snapTicks = Math.max(1, Math.round(project.midi.header.ppq / 4));
    const deltaTicks = Math.round(rawDelta / snapTicks) * snapTicks;
    const originalEndTick = regionGesture.originalStartTick + regionGesture.originalDurationTicks;
    let startTick = regionGesture.originalStartTick;
    let durationTicks = regionGesture.originalDurationTicks;
    const sourceTrack = project.tracks.find((track) => track.id === regionGesture.trackId);
    const siblings = sourceTrack?.segments.filter((segment) => segment.id !== regionGesture.segmentId) ?? [];
    if (regionGesture.mode === "move") {
      const requestedStart = Math.max(0, Math.min(project.midi.durationTicks - durationTicks, regionGesture.originalStartTick + deltaTicks));
      startTick = dropTrackId !== null && dropTrackId !== regionGesture.trackId
        ? requestedStart
        : closestAvailableRegionStart(
            requestedStart,
            durationTicks,
            siblings,
            Math.max(0, project.midi.durationTicks - durationTicks),
          ) ?? regionGesture.originalStartTick;
    } else if (regionGesture.mode === "trim-start") {
      startTick = Math.max(0, Math.min(originalEndTick - snapTicks, regionGesture.originalStartTick + deltaTicks));
      const previousEnd = siblings
        .filter((segment) => segment.startTick < regionGesture.originalStartTick)
        .reduce((latest, segment) => Math.max(latest, segment.startTick + segment.durationTicks), 0);
      startTick = Math.max(startTick, previousEnd);
      durationTicks = originalEndTick - startTick;
    } else {
      const endTick = Math.max(regionGesture.originalStartTick + snapTicks, Math.min(project.midi.durationTicks, originalEndTick + deltaTicks));
      const nextStart = siblings
        .filter((segment) => segment.startTick >= originalEndTick)
        .reduce((earliest, segment) => Math.min(earliest, segment.startTick), project.midi.durationTicks);
      durationTicks = Math.min(endTick, nextStart) - regionGesture.originalStartTick;
    }
    if (regionGesture.mode === "move" && dropTrackId !== null && dropTrackId !== regionGesture.trackId) {
      const targetTrack = project.tracks.find((track) => track.id === dropTrackId);
      setRegionDropInvalid(Boolean(targetTrack?.segments.some((segment) => regionsOverlap(startTick, durationTicks, segment))));
    } else {
      setRegionDropInvalid(false);
    }
    updateRegionSegment(regionGesture.trackId, regionGesture.segmentId, Math.round(startTick), Math.max(1, Math.round(durationTicks)));
  }

  function finishRegionGesture(event: React.PointerEvent<HTMLElement>) {
    if (!project || !regionGesture || event.pointerId !== regionGesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const track = project.tracks.find((item) => item.id === regionGesture.trackId);
    const segment = track?.segments.find((item) => item.id === regionGesture.segmentId);
    const dropRow = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-track-id]");
    const detectedDropTrackId = dropRow ? Number(dropRow.dataset.trackId) : null;
    const targetTrack = regionGesture.mode === "move" && Number.isFinite(detectedDropTrackId)
      ? project.tracks.find((item) => item.id === detectedDropTrackId)
      : null;
    const historySnapshot = pendingRegionHistoryRef.current;
    pendingRegionHistoryRef.current = null;
    setRegionGesture(null);
    setRegionDropTrackId(null);
    setRegionDropInvalid(false);
    if (!track || !segment) return;
    const originalEndTick = regionGesture.originalStartTick + regionGesture.originalDurationTicks;
    if (regionGesture.mode === "move") {
      if (targetTrack && targetTrack.id !== track.id && targetTrack.segments.some((candidate) => regionsOverlap(segment.startTick, segment.durationTicks, candidate))) {
        updateRegionSegment(track.id, segment.id, regionGesture.originalStartTick, regionGesture.originalDurationTicks);
        notify({ text: "目标位置已有 Region，不能重叠" });
        return;
      }
      const deltaTicks = segment.startTick - regionGesture.originalStartTick;
      if ((deltaTicks || (targetTrack && targetTrack.id !== track.id)) && historySnapshot) pushUndoSnapshot(historySnapshot);
      if (deltaTicks) {
        track.source.notes.filter((note) => belongsToRegion(note, segment.id)).forEach((note) => { note.ticks += deltaTicks; });
        Object.values(track.source.controlChanges).forEach((events) => events?.forEach((control) => {
          if (belongsToRegion(control, segment.id)) control.ticks = Math.max(0, control.ticks + deltaTicks);
        }));
      }
      if (targetTrack && targetTrack.id !== track.id) {
        const movedNotes = track.source.notes.filter((note) => belongsToRegion(note, segment.id));
        for (let index = track.source.notes.length - 1; index >= 0; index -= 1) {
          if (belongsToRegion(track.source.notes[index], segment.id)) track.source.notes.splice(index, 1);
        }
        targetTrack.source.notes.push(...movedNotes);
        targetTrack.source.notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
        Object.entries(track.source.controlChanges).forEach(([number, events]) => {
          const movedControls = (events ?? []).filter((control) => belongsToRegion(control, segment.id));
          track.source.controlChanges[Number(number)] = (events ?? []).filter((control) => !belongsToRegion(control, segment.id));
          if (movedControls.length) {
            targetTrack.source.controlChanges[Number(number)] = [
              ...(targetTrack.source.controlChanges[Number(number)] ?? []),
              ...movedControls,
            ].sort((a, b) => a.ticks - b.ticks);
          }
        });
        const nextTracks = project.tracks.map((item) => {
          if (item.id === track.id) return { ...item, segments: item.segments.filter((candidate) => candidate.id !== segment.id) };
          if (item.id === targetTrack.id) return { ...item, segments: [...item.segments, segment].sort((a, b) => a.startTick - b.startTick) };
          return item;
        });
        project.midi.header.update();
        scheduledRef.current.clear();
        setSelectedRegion({ trackId: targetTrack.id, segmentId: segment.id });
        setProject({ ...project, tracks: nextTracks });
        notify({ text: `Region 已移到 “${targetTrack.displayName}”` });
        return;
      }
    } else {
      if ((segment.startTick !== regionGesture.originalStartTick || segment.startTick + segment.durationTicks !== originalEndTick) && historySnapshot) {
        pushUndoSnapshot(historySnapshot);
      }
      const trimStart = segment.startTick;
      const trimEnd = segment.startTick + segment.durationTicks;
      const ownedPedalEvents = (track.source.controlChanges[64] ?? [])
        .filter((control) => belongsToRegion(control, segment.id));
      const trimmedPedalRanges = sustainRangesFromEvents(ownedPedalEvents, originalEndTick)
        .map((range) => ({
          startTick: Math.max(trimStart, range.startTick),
          endTick: Math.min(trimEnd, range.endTick),
        }))
        .filter((range) => range.endTick > range.startTick);
      for (let index = track.source.notes.length - 1; index >= 0; index -= 1) {
        const note = track.source.notes[index];
        if (!belongsToRegion(note, segment.id)) continue;
        const noteEnd = note.ticks + note.durationTicks;
        if (noteEnd <= trimStart || note.ticks >= trimEnd) {
          track.source.notes.splice(index, 1);
        } else {
          const nextStart = Math.max(note.ticks, trimStart);
          const nextEnd = Math.min(noteEnd, trimEnd);
          note.ticks = nextStart;
          note.durationTicks = Math.max(1, nextEnd - nextStart);
        }
      }
      Object.entries(track.source.controlChanges).forEach(([number, events]) => {
        if (Number(number) === 64) return;
        track.source.controlChanges[Number(number)] = (events ?? []).filter((control) => (
          !belongsToRegion(control, segment.id) || (control.ticks >= trimStart && control.ticks <= trimEnd)
        ));
      });
      track.source.controlChanges[64] = (track.source.controlChanges[64] ?? [])
        .filter((control) => !belongsToRegion(control, segment.id));
      trimmedPedalRanges.forEach((range) => {
        const pedalDown = track.source.addCC({ number: 64, ticks: range.startTick, value: 1 });
        const pedalUp = track.source.addCC({ number: 64, ticks: range.endTick, value: 0 });
        eventRegionIds.set(pedalDown, segment.id);
        eventRegionIds.set(pedalUp, segment.id);
      });
    }
    if (segment.startTick !== regionGesture.originalStartTick || segment.startTick + segment.durationTicks !== originalEndTick) {
      project.midi.header.update();
      scheduledRef.current.clear();
      setProject({ ...project });
      notify({ text: regionGesture.mode === "move" ? "Region 已平移" : "Region 已 Trim" });
    }
  }

  function deleteRegion(trackId: number, segmentId: string) {
    if (!project) return;
    const track = project.tracks.find((item) => item.id === trackId);
    const segment = track?.segments.find((item) => item.id === segmentId);
    if (!track || !segment) return;
    pushUndoSnapshot();
    pause();
    for (let index = track.source.notes.length - 1; index >= 0; index -= 1) {
      if (belongsToRegion(track.source.notes[index], segmentId)) track.source.notes.splice(index, 1);
    }
    Object.entries(track.source.controlChanges).forEach(([number, events]) => {
      track.source.controlChanges[Number(number)] = (events ?? []).filter((control) => !belongsToRegion(control, segmentId));
    });
    project.midi.header.update();
    scheduledRef.current.clear();
    setSelectedRegion(null);
    setProject({
      ...project,
      tracks: project.tracks.map((item) => item.id === trackId
        ? { ...item, segments: item.segments.filter((candidate) => candidate.id !== segmentId) }
        : item),
    });
    notify({ text: "Region 已删除" });
  }

  function splitRegionAtPlayhead(trackId: number, segmentId: string) {
    if (!project) return;
    const track = project.tracks.find((item) => item.id === trackId);
    const segment = track?.segments.find((item) => item.id === segmentId);
    if (!track || !segment) return;
    const splitTick = Math.round(project.midi.header.secondsToTicks(position));
    const segmentEnd = segment.startTick + segment.durationTicks;
    if (splitTick <= segment.startTick || splitTick >= segmentEnd) {
      notify({ text: "请先把播放线放在选中 Region 内部" });
      return;
    }
    pushUndoSnapshot();
    pause();
    const rightRegionId = `${segment.id}-split-${splitRegionSequence++}`;
    [...track.source.notes].forEach((note) => {
      if (!belongsToRegion(note, segment.id)) return;
      const noteEnd = note.ticks + note.durationTicks;
      if (note.ticks >= splitTick) {
        eventRegionIds.set(note, rightRegionId);
      } else if (noteEnd > splitTick) {
        const rightNote = track.source.addNote({
          midi: note.midi,
          ticks: splitTick,
          durationTicks: Math.max(1, noteEnd - splitTick),
          velocity: note.velocity,
        });
        eventRegionIds.set(rightNote, rightRegionId);
        note.durationTicks = Math.max(1, splitTick - note.ticks);
      }
    });
    Object.entries(track.source.controlChanges).forEach(([number, events]) => {
      const ownedEvents = (events ?? [])
        .filter((control) => belongsToRegion(control, segment.id))
        .sort((a, b) => a.ticks - b.ticks);
      ownedEvents.filter((control) => control.ticks >= splitTick).forEach((control) => eventRegionIds.set(control, rightRegionId));
      const lastBefore = [...ownedEvents].reverse().find((control) => control.ticks < splitTick);
      const hasBoundaryValue = ownedEvents.some((control) => control.ticks === splitTick);
      if (lastBefore && !hasBoundaryValue) {
        const boundaryControl = track.source.addCC({
          number: Number(number),
          ticks: splitTick,
          value: lastBefore.value,
        });
        eventRegionIds.set(boundaryControl, rightRegionId);
      }
    });
    const leftSegment = { ...segment, durationTicks: splitTick - segment.startTick };
    const rightSegment: TrackSegment = {
      id: rightRegionId,
      startTick: splitTick,
      durationTicks: segmentEnd - splitTick,
    };
    project.midi.header.update();
    scheduledRef.current.clear();
    setSelectedRegion({ trackId, segmentId: rightRegionId });
    setProject({
      ...project,
      tracks: project.tracks.map((item) => item.id === trackId ? {
        ...item,
        segments: item.segments
          .flatMap((candidate) => candidate.id === segmentId ? [leftSegment, rightSegment] : [candidate])
          .sort((a, b) => a.startTick - b.startTick),
      } : item),
    });
    notify({ text: `已在 ${formatTime(position)} 分割 Region` });
  }

  const duration = project?.midi.duration ?? 0;
  const visibleDuration = Math.max(0.001, duration / timelineZoom);
  const maxViewStart = Math.max(0, duration - visibleDuration);
  const viewStart = Math.min(timelineViewStart, maxViewStart);
  const viewEnd = viewStart + visibleDuration;
  const timelinePercent = useCallback((seconds: number) => ((seconds - viewStart) / visibleDuration) * 100, [viewStart, visibleDuration]);
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
    if (!isPlaying || timelineZoom <= 1 || !duration) return;
    if (position > viewEnd - visibleDuration * 0.08) {
      setTimelineViewStart(Math.min(maxViewStart, Math.max(0, position - visibleDuration * 0.12)));
    } else if (position < viewStart) {
      setTimelineViewStart(Math.max(0, position - visibleDuration * 0.12));
    }
  }, [duration, isPlaying, maxViewStart, position, timelineZoom, viewEnd, viewStart, visibleDuration]);

  useEffect(() => {
    const scrollbar = timelineScrollbarRef.current;
    if (!scrollbar) return;
    const maxScrollLeft = Math.max(0, scrollbar.scrollWidth - scrollbar.clientWidth);
    const nextScrollLeft = maxViewStart > 0 ? (viewStart / maxViewStart) * maxScrollLeft : 0;
    if (Math.abs(scrollbar.scrollLeft - nextScrollLeft) > 1) scrollbar.scrollLeft = nextScrollLeft;
  }, [maxViewStart, timelineZoom, viewStart]);

  useEffect(() => {
    const trackArea = trackListRef.current;
    if (!trackArea || !duration) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const lane = target?.closest<HTMLElement>(".track-lane");
      if (!lane || !trackArea.contains(lane)) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        const rect = lane.getBoundingClientRect();
        const anchorRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const anchorTime = viewStart + visibleDuration * anchorRatio;
        const zoom = Math.max(1, Math.min(12, timelineZoom * (event.deltaY < 0 ? 1.18 : 1 / 1.18)));
        const nextVisibleDuration = duration / zoom;
        setTimelineZoom(zoom);
        setTimelineViewStart(Math.max(0, Math.min(duration - nextVisibleDuration, anchorTime - nextVisibleDuration * anchorRatio)));
        return;
      }
      const horizontalDelta = Math.abs(event.deltaX) > 0.2 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      const scrollbar = timelineScrollbarRef.current;
      if (horizontalDelta && scrollbar && timelineZoom > 1) {
        event.preventDefault();
        event.stopPropagation();
        scrollbar.scrollLeft += horizontalDelta;
      }
    };
    trackArea.addEventListener("wheel", onWheel, { passive: false });
    return () => trackArea.removeEventListener("wheel", onWheel);
  }, [duration, timelineZoom, viewStart, visibleDuration]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      if (isPlaying) pause(); else play();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, pause, play]);

  useEffect(() => {
    const onRegionShortcut = (event: KeyboardEvent) => {
      if (!selectedRegion) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.shiftKey && event.code === "KeyT") {
        event.preventDefault();
        splitRegionAtPlayhead(selectedRegion.trackId, selectedRegion.segmentId);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteRegion(selectedRegion.trackId, selectedRegion.segmentId);
      }
    };
    window.addEventListener("keydown", onRegionShortcut);
    return () => window.removeEventListener("keydown", onRegionShortcut);
  }, [position, project, selectedRegion]);

  useEffect(() => {
    const onHistoryShortcut = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === "KeyZ") {
        event.preventDefault();
        undoEditor();
      } else if (event.code === "KeyY") {
        event.preventDefault();
        redoEditor();
      }
    };
    window.addEventListener("keydown", onHistoryShortcut);
    return () => window.removeEventListener("keydown", onHistoryShortcut);
  }, [position, project, trackTimbreOverrides]);

  const activeTempo = project ? currentTempo(project.midi, position) : 120;
  const activeKey = project ? currentKey(project, position) : { key: "C", scale: "major" as const, ticks: 0, estimated: true };
  const positionTicks = project ? Math.max(0, Math.round(project.midi.header.secondsToTicks(position))) : 0;
  const activeMeter = project ? activeTimeSignature(project.midi, positionTicks) : [4, 4];
  const rulerMarks = useMemo(() => project ? buildRulerMarks(project.midi) : [], [project]);
  const displayedRulerMarks = useMemo(
    () => project ? thinRulerMarks(project.midi, rulerMarks, viewStart, viewEnd, laneGeometry.width) : [],
    [laneGeometry.width, project, rulerMarks, viewEnd, viewStart],
  );
  const sustainCount = useMemo(
    () => project?.tracks.reduce((sum, track) => sum + (track.source.controlChanges[64]?.length ?? 0), 0) ?? 0,
    [project],
  );
  const favoriteTimbres = useMemo(() => cloudInstruments.filter((instrument) => instrument.favorite), [cloudInstruments]);
  const tempoChangeEvents = useMemo(
    () => project ? timelineValueChanges(project.midi.header.tempos, (event) => event.bpm.toFixed(4), "120.0000") : [],
    [project],
  );
  const keyChangeEvents = useMemo(
    () => project ? timelineValueChanges(
      project.midi.header.keySignatures,
      (event) => `${event.key}:${event.scale}`,
      `${project.estimatedKey.key}:${project.estimatedKey.scale}`,
    ) : [],
    [project],
  );
  const practiceCategoryCounts = useMemo(() => {
    const counts: Record<PracticeCategory, number> = { melody: 0, harmony: 0, bass: 0, pad: 0, drums: 0, effects: 0 };
    project?.tracks.filter((track) => !track.practiceGenerated).forEach((track) => {
      counts[classifyTrackForPractice(track.source)] += 1;
    });
    return counts;
  }, [project]);

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
      undoHistoryRef.current = [];
      redoHistoryRef.current = [];
      pendingRegionHistoryRef.current = null;
      setProject(nextProject);
      setPosition(0);
      setTempoDraft(Math.round(currentTempo(midi, 0)));
      const firstKey = currentKey(nextProject, 0);
      setKeyDraft(firstKey.key);
      setScaleDraft(firstKey.scale);
      setError("");
      setShowTools(false);
      setShowPracticeMerge(false);
      setPracticeCategories(DEFAULT_PRACTICE_CATEGORIES);
      setTimelineZoom(1);
      setTimelineViewStart(0);
      setTimbrePickerTrackId(null);
      setTrackTimbreOverrides({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取这个 MIDI 文件");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function toggleTrack(id: number, kind: "muted" | "solo") {
    pushUndoSnapshot();
    setProject((current) => current ? {
      ...current,
      tracks: current.tracks.map((track) => track.id === id ? { ...track, [kind]: !track[kind] } : track),
    } : current);
    stopVoices();
    scheduledRef.current.clear();
  }

  function changeTrackTimbre(id: number, value: string) {
    pushUndoSnapshot();
    setTrackTimbreOverrides((current) => {
      const next = { ...current };
      if (value === "") delete next[id];
      else next[id] = Number(value);
      return next;
    });
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

  function handleTimelineScrollbar() {
    const scrollbar = timelineScrollbarRef.current;
    if (!scrollbar) return;
    const maxScrollLeft = Math.max(0, scrollbar.scrollWidth - scrollbar.clientWidth);
    setTimelineViewStart(maxScrollLeft > 0 ? (scrollbar.scrollLeft / maxScrollLeft) * maxViewStart : 0);
  }

  function addTempoEvent() {
    if (!project) return;
    pushUndoSnapshot();
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
    pushUndoSnapshot();
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
    pushUndoSnapshot();
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
    pushUndoSnapshot();
    const previousTracks = project.tracks;
    const midiIndex = project.midi.tracks.indexOf(target.source);
    project.midi.tracks.splice(midiIndex, 1);
    const nextTracks = project.tracks
      .filter((track) => track.id !== id)
      .map((track) => target.practiceGenerated && track.excludedFromExport ? {
        ...track,
        muted: track.practicePreviousMuted ?? false,
        solo: track.practicePreviousSolo ?? false,
        excludedFromExport: undefined,
        practicePreviousMuted: undefined,
        practicePreviousSolo: undefined,
      } : track);
    setProject({ ...project, tracks: nextTracks });
    stopVoices();
    notify({
      text: `已删除 “${target.displayName}”`,
      action: {
        label: "撤销",
        run: () => {
          project.midi.tracks.splice(midiIndex, 0, target.source);
          setProject({ ...project, tracks: previousTracks });
          setToast(null);
        },
      },
    });
  }

  function mergePracticeTracks() {
    if (!project) return;
    if (project.tracks.some((track) => track.practiceGenerated)) {
      notify({ text: "已有 Piano Practice 轨，请先删除后再重新生成" });
      return;
    }
    const selected = project.tracks.filter((track) => (
      !track.practiceGenerated && practiceCategories[classifyTrackForPractice(track.source)]
    ));
    if (!selected.length) {
      notify({ text: "所选分类中没有可合并的轨道" });
      return;
    }

    pushUndoSnapshot();
    pause();
    const previousTracks = project.tracks;
    const practiceTrack = project.midi.addTrack();
    practiceTrack.name = "Piano Practice";
    practiceTrack.channel = 0;
    practiceTrack.instrument.number = 0;
    const mergedNotes = new Map<string, { midi: number; ticks: number; durationTicks: number; velocity: number }>();
    selected.forEach((track) => track.source.notes.forEach((note) => {
      const midi = fitToPianoRange(note.midi);
      const key = `${note.ticks}:${midi}`;
      const existing = mergedNotes.get(key);
      if (!existing) {
        mergedNotes.set(key, {
          midi,
          ticks: note.ticks,
          durationTicks: Math.max(1, note.durationTicks),
          velocity: Math.min(1, Math.max(0.12, note.velocity)),
        });
      } else {
        existing.durationTicks = Math.max(existing.durationTicks, note.durationTicks);
        existing.velocity = Math.max(existing.velocity, note.velocity);
      }
    }));
    [...mergedNotes.values()]
      .sort((a, b) => a.ticks - b.ticks || a.midi - b.midi)
      .forEach((note) => practiceTrack.addNote(note));
    project.midi.header.update();

    const chosenLabels = PRACTICE_CATEGORIES
      .filter((category) => practiceCategories[category.id] && practiceCategoryCounts[category.id] > 0)
      .map((category) => category.label);
    const selectedIds = new Set(selected.map((track) => track.id));
    const nextTracks = previousTracks.map((track) => (
      selectedIds.has(track.id) ? {
        ...track,
        muted: true,
        solo: false,
        excludedFromExport: true,
        practicePreviousMuted: track.muted,
        practicePreviousSolo: track.solo,
      } : track
    ));
    const practiceTrackId = Math.max(0, ...previousTracks.map((track) => track.id)) + 1;
    const practiceUiTrack: UiTrack = {
      id: practiceTrackId,
      source: practiceTrack,
      displayName: `Piano Practice · ${chosenLabels.join(" + ")}`,
      muted: false,
      solo: false,
      segments: initialSegments(practiceTrack, practiceTrackId),
      practiceGenerated: true,
    };
    setProject({ ...project, tracks: [...nextTracks, practiceUiTrack] });
    setPosition(0);
    setShowPracticeMerge(false);
    scheduledRef.current.clear();
    notify({
      text: `已将 ${selected.length} 轨合并为 Piano Practice（${mergedNotes.size} notes）`,
      action: {
        label: "撤销",
        run: () => {
          const midiIndex = project.midi.tracks.indexOf(practiceTrack);
          if (midiIndex >= 0) project.midi.tracks.splice(midiIndex, 1);
          project.midi.header.update();
          setProject({ ...project, tracks: previousTracks });
          setToast(null);
        },
      },
    });
  }

  function exportMidi() {
    if (!project) return;
    const selectedTracks = project.tracks.filter((track) => track.solo);
    if (!selectedTracks.length) {
      notify({ text: "请先点亮至少一条轨道的 S，再另存 MIDI" });
      return;
    }
    const exportCopy = project.midi.clone();
    exportCopy.name = utf8ByteString(repairMidiText(project.midi.name));
    project.tracks.forEach((track) => {
      const sourceIndex = project.midi.tracks.indexOf(track.source);
      if (sourceIndex >= 0 && exportCopy.tracks[sourceIndex]) {
        exportCopy.tracks[sourceIndex].name = utf8ByteString(track.displayName);
      }
    });
    project.tracks
      .filter((track) => !track.solo)
      .map((track) => project.midi.tracks.indexOf(track.source))
      .filter((index) => index >= 0)
      .sort((a, b) => b - a)
      .forEach((index) => exportCopy.tracks.splice(index, 1));
    exportCopy.header.update();
    const bytes = encodeMidiWithValidKeySignatures(exportCopy);
    const exportBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(exportBuffer).set(bytes);
    const blob = new Blob([exportBuffer], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const base = project.name.replace(/\.midi?$/i, "") || "harmonic";
    anchor.href = url;
    const suffix = selectedTracks.some((track) => track.practiceGenerated) ? "piano-practice" : "selected-tracks";
    anchor.download = `${base}-${suffix}.mid`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify({ text: `已另存 ${selectedTracks.length} 条 S 轨：${base}-${suffix}.mid` });
  }

  const progress = Math.max(0, Math.min(100, timelinePercent(position)));
  const draggedRegion = regionGesture
    ? project?.tracks
        .find((track) => track.id === regionGesture.trackId)
        ?.segments.find((segment) => segment.id === regionGesture.segmentId) ?? null
    : null;
  const trimGuideTick = draggedRegion && regionGesture && regionGesture.mode !== "move"
    ? regionGesture.mode === "trim-start"
      ? draggedRegion.startTick
      : draggedRegion.startTick + draggedRegion.durationTicks
    : null;
  const trimGuideSeconds = trimGuideTick === null || !project
    ? null
    : project.midi.header.ticksToSeconds(trimGuideTick);
  const timbrePickerTrack = timbrePickerTrackId === null ? null : project?.tracks.find((track) => track.id === timbrePickerTrackId) ?? null;
  const pickerInstruments = cloudInstruments.filter((instrument) => {
    const query = timbrePickerQuery.trim().toLowerCase();
    const matchesQuery = !query || `${instrument.program + 1} ${instrument.name} ${instrument.family}`.toLowerCase().includes(query);
    return matchesQuery && (!timbrePickerFavoritesOnly || instrument.favorite);
  });

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand">
          <span className="brand-bars"><i /><i /><i /><i /></span>
          <span>HARMONIC</span>
          <small>MIDI PLAYER</small>
        </div>
        <div className="header-actions">
          <a className="manage-link" href="./timbres/">音色管理</a>
          {project && <button className="save-button" onClick={exportMidi}>↓ 另存 S 轨</button>}
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
            undoHistoryRef.current = [];
            redoHistoryRef.current = [];
            pendingRegionHistoryRef.current = null;
            setProject(demo);
            setTempoDraft(112);
            setKeyDraft("C");
            setScaleDraft("minor");
            setError("");
            setShowPracticeMerge(false);
            setPracticeCategories(DEFAULT_PRACTICE_CATEGORIES);
            setTimelineZoom(1);
            setTimelineViewStart(0);
            setTrackTimbreOverrides({});
          }}>或打开示例工程</button>
          <p className="privacy-note">支持 .mid / .midi · 文件只在浏览器本地读取</p>
          {error && <p className="error-message">{error}</p>}
        </section>
      ) : (
        <section className="player">
          <div className="project-summary">
            <div className="project-title-block">
              <p className="eyebrow">NOW LOADED</p>
              <h1>{project.name}</h1>
              <div className="project-live-status">
                <span className={isPlaying ? "playing" : ""}>{isPlaying ? "播放中" : "已暂停"}</span>
                <strong>{formatTime(position)} / {formatTime(duration)}</strong>
                <span>{Math.round(activeTempo)} BPM</span>
                <span>{formatKey(activeKey)}</span>
                <span>{activeMeter[0]}/{activeMeter[1]}</span>
                <small>{project.tracks.length} 轨 · SPACE 播放 / 暂停</small>
              </div>
            </div>
            <button className="replace-button" onClick={() => inputRef.current?.click()}>更换文件</button>
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

          <div className={`practice-builder ${showPracticeMerge ? "open" : ""}`}>
            <button className="practice-toggle" onClick={() => setShowPracticeMerge((open) => !open)}>
              <span><b>♬</b> 生成钢琴练习版</span>
              <small>按声部分类合并为一条可导出的 Piano Track</small>
              <i>{showPracticeMerge ? "−" : "＋"}</i>
            </button>
            {showPracticeMerge && (
              <div className="practice-body">
                <div className="practice-intro">
                  <strong>选择要合并的分类</strong>
                  <span>已合并的原轨会静音但仍保留供比较；另存 MIDI 时不会重复导出。</span>
                </div>
                <div className="practice-categories">
                  {PRACTICE_CATEGORIES.map((category) => (
                    <label className={practiceCategories[category.id] ? "selected" : ""} key={category.id}>
                      <input
                        type="checkbox"
                        checked={practiceCategories[category.id]}
                        onChange={() => setPracticeCategories((current) => ({ ...current, [category.id]: !current[category.id] }))}
                      />
                      <span><strong>{category.label}</strong><small>{category.detail}</small></span>
                      <b>{practiceCategoryCounts[category.id]} 轨</b>
                    </label>
                  ))}
                </div>
                <div className="practice-actions">
                  <span>自动去重，并将超出范围的音符移入 36–96 钢琴练习音域。</span>
                  <button onClick={mergePracticeTracks}>生成 Piano Track</button>
                </div>
              </div>
            )}
          </div>

          <div className="track-heading">
            <span>音轨</span>
            <span>S 已选 {project.tracks.filter((track) => track.solo).length} 条 · {audibleTracks(project.tracks).length} / {project.tracks.length} 正在发声</span>
          </div>

          <div className="track-list" ref={trackListRef}>
            <div className="timeline-ruler-shell">
              {laneGeometry.width > 0 && (
                <div
                  className="timeline-ruler"
                  style={{ left: `${laneGeometry.left}px`, width: `${laneGeometry.width}px` }}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    seek(Math.max(viewStart, Math.min(viewEnd, viewStart + ((event.clientX - rect.left) / rect.width) * visibleDuration)));
                  }}
                >
                  {displayedRulerMarks.map((mark, index) => (
                    <span
                      className={`ruler-mark ${mark.kind}`}
                      key={`${mark.ticks}-${index}`}
                      style={{ left: `${timelinePercent(project.midi.header.ticksToSeconds(mark.ticks))}%` }}
                    >
                      {mark.label && <b>{mark.label}</b>}
                    </span>
                  ))}
                  {tempoChangeEvents.filter((event) => {
                    const seconds = project.midi.header.ticksToSeconds(event.ticks);
                    return event.ticks > 0 && seconds >= viewStart && seconds <= viewEnd;
                  }).map((event, index) => (
                    <span
                      className="ruler-event tempo"
                      title={`${Math.round(event.bpm)} BPM`}
                      key={`tempo-${index}`}
                      style={{ left: `${timelinePercent(project.midi.header.ticksToSeconds(event.ticks))}%` }}
                    />
                  ))}
                  {keyChangeEvents.filter((event) => {
                    const seconds = project.midi.header.ticksToSeconds(event.ticks);
                    return event.ticks > 0 && seconds >= viewStart && seconds <= viewEnd;
                  }).map((event, index) => (
                    <span
                      className="ruler-event key"
                      title={`${event.key} ${event.scale}`}
                      key={`key-${index}`}
                      style={{ left: `${timelinePercent(project.midi.header.ticksToSeconds(event.ticks))}%` }}
                    />
                  ))}
                </div>
              )}
              <span className="ruler-meter-label">拍号 {activeMeter[0]}/{activeMeter[1]} · 16分格自动疏密 · 轨道区捏合 / 双指左右滚动</span>
            </div>
            {laneGeometry.width > 0 && timelineZoom > 1 && (
              <div className="timeline-scrollbar-shell">
                <div
                  className="timeline-scrollbar"
                  ref={timelineScrollbarRef}
                  onScroll={handleTimelineScrollbar}
                  style={{ left: `${laneGeometry.left}px`, width: `${laneGeometry.width}px` }}
                >
                  <div style={{ width: `${timelineZoom * 100}%` }} />
                </div>
              </div>
            )}
            {laneGeometry.width > 0 && position >= viewStart && position <= viewEnd && (
              <span
                className="global-playhead"
                aria-hidden="true"
                style={{ left: `${laneGeometry.left + laneGeometry.width * progress / 100}px` }}
              />
            )}
            {laneGeometry.width > 0 && trimGuideSeconds !== null && trimGuideSeconds >= viewStart && trimGuideSeconds <= viewEnd && (
              <span
                className={`region-trim-guide ${regionGesture?.mode === "trim-end" ? "trim-end" : "trim-start"}`}
                aria-hidden="true"
                style={{ left: `${laneGeometry.left + laneGeometry.width * timelinePercent(trimGuideSeconds) / 100}px` }}
              >
                <b>{regionGesture?.mode === "trim-end" ? "TRIM OUT" : "TRIM IN"} · {formatTime(trimGuideSeconds)}</b>
              </span>
            )}
            {project.tracks.map((track, index) => {
              const hasSolo = project.tracks.some((item) => item.solo);
              const audible = !track.muted && (!hasSolo || track.solo);
              const minPitch = track.source.notes.length ? Math.min(...track.source.notes.map((note) => note.midi)) : 60;
              const maxPitch = track.source.notes.length ? Math.max(...track.source.notes.map((note) => note.midi)) : 72;
              const range = Math.max(1, maxPitch - minPitch);
              const overrideProgram = trackTimbreOverrides[track.id];
              const overrideTimbre = cloudInstruments.find((instrument) => instrument.program === overrideProgram);
              const effectiveProgram = overrideProgram ?? track.source.instrument.number;
              const effectiveMapping = programMappings.find((mapping) => mapping.program === effectiveProgram);
              const effectiveCustom = customTimbres.find((item) => item.id === effectiveMapping?.customTimbreId);
              const timbreColor = colorForTimbre(effectiveProgram, overrideProgram === undefined && track.source.instrument.percussion);
              const sustainRanges = buildSustainRanges(track.source, project.midi.durationTicks);
              return (
                <div
                  className={`track-unit ${regionGesture?.mode === "move" && regionDropTrackId === track.id && regionGesture.trackId !== track.id ? regionDropInvalid ? "region-drop-invalid" : "region-drop-target" : ""}`}
                  data-track-id={track.id}
                  key={track.id}
                >
                  <article className={`track-row ${audible ? "" : "inaudible"}`}>
                    <div className="track-index" style={{ color: timbreColor }}>{String(index + 1).padStart(2, "0")}</div>
                    <div className="track-meta">
                      <button className="track-meta-open" onClick={() => { setTimbrePickerTrackId(track.id); setTimbrePickerFavoritesOnly(false); setTimbrePickerQuery(""); }} aria-label={`替换 ${instrumentLabel(track.source)} 音色`}>
                        <strong>{track.displayName}</strong>
                        <span>CH {track.source.channel + 1} · P{String(effectiveProgram + 1).padStart(3, "0")} · {overrideTimbre?.name ?? instrumentLabel(track.source)}{effectiveCustom ? ` → ${effectiveCustom.name}` : ""} · {track.source.notes.length} notes{sustainRanges.length ? ` · ${sustainRanges.length} 段踏板` : ""}</span>
                        <small>{track.practiceGenerated ? "钢琴练习合并轨 · 点击可替换音色" : track.excludedFromExport ? "已并入练习轨 · 原轨不重复导出" : "在轨道区捏合伸缩，双指左右滚动"}</small>
                      </button>
                    </div>
                    <div className="track-lane" onPointerDown={(event) => {
                      if (event.target === event.currentTarget) setSelectedRegion(null);
                    }}>
                      <div className="track-progress" style={{ width: `${progress}%`, background: timbreColor }} />
                      {draggedRegion && regionGesture?.mode === "move" && regionDropTrackId === track.id && regionGesture.trackId !== track.id && (() => {
                        const previewStart = project.midi.header.ticksToSeconds(draggedRegion.startTick);
                        const previewEnd = project.midi.header.ticksToSeconds(draggedRegion.startTick + draggedRegion.durationTicks);
                        return (
                          <div
                            className={`region-drop-preview ${regionDropInvalid ? "invalid" : ""}`}
                            aria-hidden="true"
                            style={{
                              left: `${timelinePercent(previewStart)}%`,
                              width: `${Math.max(0.25, ((previewEnd - previewStart) / visibleDuration) * 100)}%`,
                            }}
                          >
                            <span>{regionDropInvalid ? "重叠" : "移动到这里"}</span>
                          </div>
                        );
                      })()}
                      {track.segments.map((segment) => {
                        const startSeconds = project.midi.header.ticksToSeconds(segment.startTick);
                        const endSeconds = project.midi.header.ticksToSeconds(segment.startTick + segment.durationTicks);
                        return (
                          <div
                            className={`track-segment ${selectedRegion?.trackId === track.id && selectedRegion.segmentId === segment.id ? "selected" : ""}`}
                            key={segment.id}
                            title="点击选择；拖动中间平移；拖动两侧 Trim"
                            aria-selected={selectedRegion?.trackId === track.id && selectedRegion.segmentId === segment.id}
                            onPointerDown={(event) => beginRegionGesture(event, track.id, segment, "move")}
                            onPointerMove={moveRegionGesture}
                            onPointerUp={finishRegionGesture}
                            onPointerCancel={finishRegionGesture}
                            style={{
                              left: `${timelinePercent(startSeconds)}%`,
                              width: `${Math.max(0.25, ((endSeconds - startSeconds) / visibleDuration) * 100)}%`,
                              borderColor: timbreColor,
                              background: timbreColor,
                            }}
                          >
                            {selectedRegion?.trackId === track.id && selectedRegion.segmentId === segment.id && (
                              <>
                                <button
                                  className="region-handle start"
                                  aria-label="Trim Region 开头"
                                  onPointerDown={(event) => beginRegionGesture(event, track.id, segment, "trim-start")}
                                  onPointerMove={moveRegionGesture}
                                  onPointerUp={finishRegionGesture}
                                  onPointerCancel={finishRegionGesture}
                                />
                                <span className="region-move-label">MOVE</span>
                                <button
                                  className="region-split"
                                  aria-label="从播放线分割 Region"
                                  title="从播放线分割 Region（Shift+T）"
                                  onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    splitRegionAtPlayhead(track.id, segment.id);
                                  }}
                                >✂</button>
                                <button
                                  className="region-delete"
                                  aria-label="删除 Region"
                                  title="删除 Region（Delete / Backspace）"
                                  onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    deleteRegion(track.id, segment.id);
                                  }}
                                >×</button>
                                <button
                                  className="region-handle end"
                                  aria-label="Trim Region 结尾"
                                  onPointerDown={(event) => beginRegionGesture(event, track.id, segment, "trim-end")}
                                  onPointerMove={moveRegionGesture}
                                  onPointerUp={finishRegionGesture}
                                  onPointerCancel={finishRegionGesture}
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                      {track.source.notes.slice(0, 900).map((note, noteIndex) => (
                        <i
                          key={noteIndex}
                          style={{
                            left: `${timelinePercent(note.time)}%`,
                            width: `${Math.max(0.18, (note.duration / visibleDuration) * 100)}%`,
                            bottom: `${8 + ((note.midi - minPitch) / range) * 70}%`,
                            background: timbreColor,
                            opacity: 0.5 + note.velocity * 0.5,
                          }}
                        />
                      ))}
                      {sustainRanges.map((range, sustainIndex) => {
                        const rangeStart = Math.max(viewStart, project.midi.header.ticksToSeconds(range.startTick));
                        const rangeEnd = Math.min(viewEnd, project.midi.header.ticksToSeconds(range.endTick));
                        if (rangeEnd <= rangeStart) return null;
                        return (
                          <span
                            className="sustain-range"
                            key={`sustain-${sustainIndex}`}
                            title={`Sustain ${formatTime(rangeStart)} – ${formatTime(rangeEnd)}`}
                            style={{
                              left: `${timelinePercent(rangeStart)}%`,
                              width: `${Math.max(0.25, ((rangeEnd - rangeStart) / visibleDuration) * 100)}%`,
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="track-controls">
                      <button className={track.muted ? "active mute" : ""} aria-label={`${track.displayName} 静音`} aria-pressed={track.muted} onClick={() => toggleTrack(track.id, "muted")}>M</button>
                      <button className={track.solo ? "active solo" : ""} aria-label={`${track.displayName} 独奏并选择导出`} aria-pressed={track.solo} title="Solo／选择导出" onClick={() => toggleTrack(track.id, "solo")}>S</button>
                      <button className="delete-track" aria-label={`删除 ${track.displayName}`} onClick={() => deleteTrack(track.id)}>×</button>
                    </div>
                  </article>
                </div>
              );
            })}
            {!project.tracks.length && <div className="no-tracks">所有轨道都已删除 · 可以撤销上一项操作或导入新的 MIDI</div>}
          </div>
        </section>
      )}

      <input ref={inputRef} className="visually-hidden" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" onChange={(event) => loadFile(event.target.files?.[0])} />
      {timbrePickerTrack && (
        <div className="timbre-picker-backdrop" onMouseDown={() => setTimbrePickerTrackId(null)}>
          <aside className="timbre-picker" role="dialog" aria-modal="true" aria-labelledby="timbre-picker-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="timbre-picker-titlebar">
              <div>
                <span>REPLACE INSTRUMENT</span>
                <h2 id="timbre-picker-title">{timbrePickerTrack.displayName}</h2>
                <p>选择一个 GM 音色立即替换当前轨道</p>
              </div>
              <button aria-label="关闭音色选择" onClick={() => setTimbrePickerTrackId(null)}>×</button>
            </div>
            <div className="timbre-picker-filters">
              <input aria-label="搜索替换音色" placeholder="搜索名称或编号" value={timbrePickerQuery} onChange={(event) => setTimbrePickerQuery(event.target.value)} />
              <button className={!timbrePickerFavoritesOnly ? "active" : ""} onClick={() => setTimbrePickerFavoritesOnly(false)}>全部 128</button>
              <button className={timbrePickerFavoritesOnly ? "active favorite" : ""} onClick={() => setTimbrePickerFavoritesOnly(true)}>★ 收藏 {favoriteTimbres.length}</button>
            </div>
            <div className="timbre-picker-list">
              <button className="original" onClick={() => { changeTrackTimbre(timbrePickerTrack.id, ""); setTimbrePickerTrackId(null); }}>
                <span>—</span><strong>使用 MIDI 原始音色</strong><small>P{String(timbrePickerTrack.source.instrument.number + 1).padStart(3, "0")}</small>
              </button>
              {pickerInstruments.map((instrument) => (
                (() => {
                  const mapping = programMappings.find((item) => item.program === instrument.program);
                  const custom = customTimbres.find((item) => item.id === mapping?.customTimbreId);
                  return (
                    <button key={instrument.program} onClick={() => { changeTrackTimbre(timbrePickerTrack.id, String(instrument.program)); setTimbrePickerTrackId(null); }}>
                      <span>{String(instrument.program + 1).padStart(3, "0")}</span>
                      <strong>{instrument.name}{custom ? ` → ${custom.name}` : ""}</strong>
                      <small>{instrument.favorite ? "★" : custom ? "CUSTOM MAP" : instrument.family}</small>
                    </button>
                  );
                })()
              ))}
              {!pickerInstruments.length && <p>还没有收藏音色，可到“音色管理”中点击星标收藏。</p>}
            </div>
          </aside>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.action && <button onClick={toast.action.run}>{toast.action.label}</button>}
        </div>
      )}
      <footer><span>HARMONIC / LOCAL MIDI ENGINE</span><span><kbd>SPACE</kbd> PLAY / PAUSE · <kbd>SHIFT Z</kbd> UNDO · <kbd>SHIFT Y</kbd> REDO</span></footer>
    </main>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
