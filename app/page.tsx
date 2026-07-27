"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type MidiNote = {
  midi: number;
  velocity: number;
  start: number;
  duration: number;
};

type MidiTrack = {
  id: number;
  name: string;
  channel: number;
  program: number;
  notes: MidiNote[];
  muted: boolean;
  solo: boolean;
  color: string;
};

type MidiProject = {
  name: string;
  duration: number;
  bpm: number;
  tracks: MidiTrack[];
};

type RawNote = {
  midi: number;
  velocity: number;
  startTick: number;
  endTick: number;
};

type ParsedTrack = {
  name: string;
  channel: number;
  program: number;
  notes: RawNote[];
};

const TRACK_COLORS = ["#8c74ff", "#4fc8b7", "#f0a95a", "#ef6f8f", "#5da8ff", "#c781ef", "#76c86c", "#e3cb5f"];
const GM_NAMES = [
  "Acoustic Grand", "Bright Piano", "Electric Grand", "Honky-tonk", "Electric Piano", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar", "Muted Guitar", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Finger Bass", "Pick Bass", "Fretless Bass", "Slap Bass", "Slap Bass 2", "Synth Bass", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Harp", "Timpani",
  "Strings", "Slow Strings", "Synth Strings", "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1", "Lead 2", "Lead 3", "Lead 4", "Lead 5", "Lead 6", "Lead 7", "Lead 8",
  "Pad 1", "Pad 2", "Pad 3", "Pad 4", "Pad 5", "Pad 6", "Pad 7", "Pad 8",
  "FX 1", "FX 2", "FX 3", "FX 4", "FX 5", "FX 6", "FX 7", "FX 8",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag Pipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret", "Breath", "Seashore", "Bird", "Telephone", "Helicopter", "Applause", "Gunshot",
];

const demoProject: MidiProject = {
  name: "Midnight Sketch.mid",
  duration: 18.4,
  bpm: 112,
  tracks: [
    { id: 1, name: "Electric Piano", channel: 1, program: 4, muted: false, solo: false, color: TRACK_COLORS[0], notes: makeDemoNotes(48, 0, 16, 0.72) },
    { id: 2, name: "Warm Bass", channel: 2, program: 38, muted: false, solo: false, color: TRACK_COLORS[1], notes: makeDemoNotes(36, 0.2, 12, 1.05) },
    { id: 3, name: "Soft Drums", channel: 10, program: 0, muted: false, solo: false, color: TRACK_COLORS[2], notes: makeDemoNotes(42, 0, 32, 0.12) },
    { id: 4, name: "Air Pad", channel: 3, program: 89, muted: false, solo: false, color: TRACK_COLORS[3], notes: makeDemoNotes(60, 1, 8, 1.8) },
  ],
};

function makeDemoNotes(base: number, offset: number, count: number, duration: number): MidiNote[] {
  return Array.from({ length: count }, (_, index) => ({
    midi: base + [0, 4, 7, 9, 7, 4][index % 6],
    velocity: 0.45 + (index % 4) * 0.11,
    start: offset + index * (18 / count),
    duration,
  }));
}

function readVariable(view: DataView, cursor: { value: number }) {
  let result = 0;
  let byte = 0;
  do {
    byte = view.getUint8(cursor.value++);
    result = (result << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return result;
}

function readText(view: DataView, start: number, length: number) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + start, length);
  return new TextDecoder("utf-8").decode(bytes).replace(/\0/g, "").trim();
}

function parseMidi(buffer: ArrayBuffer, filename: string): MidiProject {
  const view = new DataView(buffer);
  if (view.byteLength < 14 || view.getUint32(0) !== 0x4d546864) throw new Error("This is not a valid MIDI file.");
  const headerLength = view.getUint32(4);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new Error("SMPTE-timed MIDI files are not supported yet.");
  const ticksPerBeat = division || 480;
  const tempos: { tick: number; microseconds: number }[] = [{ tick: 0, microseconds: 500000 }];
  const parsedTracks: ParsedTrack[] = [];
  let offset = 8 + headerLength;

  for (let trackIndex = 0; trackIndex < trackCount && offset + 8 <= view.byteLength; trackIndex++) {
    const chunkId = view.getUint32(offset);
    const chunkLength = view.getUint32(offset + 4);
    offset += 8;
    const trackEnd = Math.min(view.byteLength, offset + chunkLength);
    if (chunkId !== 0x4d54726b) {
      offset = trackEnd;
      continue;
    }
    const cursor = { value: offset };
    let tick = 0;
    let runningStatus = 0;
    let trackName = "";
    let program = 0;
    let channel = 0;
    const active = new Map<string, { tick: number; velocity: number }[]>();
    const notes: RawNote[] = [];

    while (cursor.value < trackEnd) {
      tick += readVariable(view, cursor);
      if (cursor.value >= trackEnd) break;
      let status = view.getUint8(cursor.value++);
      let firstData: number | null = null;
      if (status < 0x80) {
        if (!runningStatus) throw new Error("Invalid MIDI running status.");
        firstData = status;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      }

      if (status === 0xff) {
        if (cursor.value >= trackEnd) break;
        const type = view.getUint8(cursor.value++);
        const length = readVariable(view, cursor);
        if (type === 0x03 && !trackName) trackName = readText(view, cursor.value, Math.min(length, trackEnd - cursor.value));
        if (type === 0x51 && length === 3 && cursor.value + 2 < trackEnd) {
          tempos.push({ tick, microseconds: (view.getUint8(cursor.value) << 16) | (view.getUint8(cursor.value + 1) << 8) | view.getUint8(cursor.value + 2) });
        }
        cursor.value = Math.min(trackEnd, cursor.value + length);
        if (type === 0x2f) break;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        cursor.value = Math.min(trackEnd, cursor.value + readVariable(view, cursor));
        continue;
      }

      const eventType = status >> 4;
      const eventChannel = status & 0x0f;
      const dataLength = eventType === 0xc || eventType === 0xd ? 1 : 2;
      const data1 = firstData ?? view.getUint8(cursor.value++);
      const data2 = dataLength === 2 && cursor.value < trackEnd ? view.getUint8(cursor.value++) : 0;
      channel = eventChannel;

      if (eventType === 0xc) program = data1;
      if (eventType === 0x9 && data2 > 0) {
        const key = `${eventChannel}:${data1}`;
        const stack = active.get(key) ?? [];
        stack.push({ tick, velocity: data2 });
        active.set(key, stack);
      }
      if (eventType === 0x8 || (eventType === 0x9 && data2 === 0)) {
        const key = `${eventChannel}:${data1}`;
        const stack = active.get(key);
        const started = stack?.shift();
        if (started) notes.push({ midi: data1, velocity: started.velocity, startTick: started.tick, endTick: Math.max(tick, started.tick + 1) });
      }
    }
    parsedTracks.push({ name: trackName, channel, program, notes });
    offset = trackEnd;
  }

  const tempoMap = tempos
    .sort((a, b) => a.tick - b.tick)
    .filter((event, index, list) => index === list.length - 1 || list[index + 1].tick !== event.tick);
  const tickToSeconds = (targetTick: number) => {
    let seconds = 0;
    let previousTick = 0;
    let microseconds = 500000;
    for (const event of tempoMap) {
      if (event.tick > targetTick) break;
      seconds += ((event.tick - previousTick) / ticksPerBeat) * (microseconds / 1_000_000);
      previousTick = event.tick;
      microseconds = event.microseconds;
    }
    return seconds + ((targetTick - previousTick) / ticksPerBeat) * (microseconds / 1_000_000);
  };

  const tracks = parsedTracks
    .filter((track) => track.notes.length > 0)
    .map((track, index) => {
      const fallback = track.channel === 9 ? "Drums" : GM_NAMES[track.program] || `Track ${index + 1}`;
      return {
        id: index + 1,
        name: track.name || fallback,
        channel: track.channel + 1,
        program: track.program,
        notes: track.notes.map((note) => ({
          midi: note.midi,
          velocity: note.velocity / 127,
          start: tickToSeconds(note.startTick),
          duration: Math.max(0.03, tickToSeconds(note.endTick) - tickToSeconds(note.startTick)),
        })),
        muted: false,
        solo: false,
        color: TRACK_COLORS[index % TRACK_COLORS.length],
      };
    });

  if (!tracks.length) throw new Error("No playable note tracks were found in this MIDI file.");
  const duration = Math.max(...tracks.flatMap((track) => track.notes.map((note) => note.start + note.duration)));
  return {
    name: filename,
    duration,
    bpm: Math.round(60_000_000 / (tempoMap[0]?.microseconds || 500000)),
    tracks,
  };
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default function Home() {
  const [project, setProject] = useState<MidiProject | null>(null);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const playbackStartRef = useRef(0);
  const positionStartRef = useRef(0);
  const animationRef = useRef(0);
  const scheduledRef = useRef(new Set<string>());
  const voicesRef = useRef(new Set<OscillatorNode>());
  const projectRef = useRef(project);

  useEffect(() => { projectRef.current = project; }, [project]);

  const stopVoices = useCallback(() => {
    voicesRef.current.forEach((voice) => {
      try { voice.stop(); } catch {}
    });
    voicesRef.current.clear();
  }, []);

  const audibleTracks = useCallback((tracks: MidiTrack[]) => {
    const hasSolo = tracks.some((track) => track.solo);
    return tracks.filter((track) => !track.muted && (!hasSolo || track.solo));
  }, []);

  const triggerNote = useCallback((note: MidiNote, track: MidiTrack, delay: number) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioRef.current) audioRef.current = new AudioContextClass();
    const context = audioRef.current;
    const start = context.currentTime + Math.max(0, delay);
    const duration = Math.min(note.duration, track.channel === 10 ? 0.12 : 2.5);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const waveform: OscillatorType[] = ["triangle", "sine", "square", "sawtooth"];
    oscillator.type = track.channel === 10 ? "square" : waveform[(track.id - 1) % waveform.length];
    oscillator.frequency.value = track.channel === 10 ? 70 + (note.midi % 12) * 13 : 440 * 2 ** ((note.midi - 69) / 12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.015, note.velocity * 0.1), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.04, duration));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + Math.max(0.05, duration) + 0.02);
    voicesRef.current.add(oscillator);
    oscillator.onended = () => voicesRef.current.delete(oscillator);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
    cancelAnimationFrame(animationRef.current);
    stopVoices();
  }, [stopVoices]);

  const play = useCallback(() => {
    if (!project || !project.tracks.length) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      if (!audioRef.current) audioRef.current = new AudioContextClass();
      void audioRef.current.resume();
    }
    if (position >= project.duration - 0.02) setPosition(0);
    positionStartRef.current = position >= project.duration - 0.02 ? 0 : position;
    playbackStartRef.current = performance.now();
    scheduledRef.current.clear();
    setIsPlaying(true);
  }, [position, project]);

  useEffect(() => {
    if (!isPlaying || !project) return;
    const frame = () => {
      const elapsed = (performance.now() - playbackStartRef.current) / 1000;
      const now = positionStartRef.current + elapsed;
      if (now >= project.duration) {
        setPosition(project.duration);
        setIsPlaying(false);
        stopVoices();
        return;
      }
      setPosition(now);
      const lookahead = 0.12;
      audibleTracks(projectRef.current?.tracks ?? []).forEach((track) => {
        track.notes.forEach((note, noteIndex) => {
          const key = `${track.id}-${noteIndex}`;
          if (!scheduledRef.current.has(key) && note.start >= now && note.start < now + lookahead) {
            scheduledRef.current.add(key);
            triggerNote(note, track, note.start - now);
          }
        });
      });
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationRef.current);
  }, [audibleTracks, isPlaying, project, stopVoices, triggerNote]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      if (isPlaying) pause(); else play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, pause, play]);

  async function loadFile(file?: File) {
    if (!file) return;
    if (!/\.midi?$/i.test(file.name)) {
      setError("请选择 .mid 或 .midi 文件");
      return;
    }
    try {
      pause();
      const parsed = parseMidi(await file.arrayBuffer(), file.name);
      setProject(parsed);
      setPosition(0);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取这个 MIDI 文件");
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

  const progress = project?.duration ? (position / project.duration) * 100 : 0;

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand">
          <span className="brand-bars"><i /><i /><i /><i /></span>
          <span>HARMONIC</span>
          <small>MIDI PLAYER</small>
        </div>
        <button className="import-small" onClick={() => inputRef.current?.click()}>
          <span>＋</span> 导入 MIDI
        </button>
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
          <p className="empty-copy">自动识别并拆分所有音轨。播放、暂停，<br />为每条轨道设置静音或独奏。</p>
          <button className="primary-import" onClick={() => inputRef.current?.click()}>
            选择 MIDI 文件 <span>↗</span>
          </button>
          <button className="demo-button" onClick={() => { setProject(demoProject); setPosition(0); setError(""); }}>
            或打开示例工程
          </button>
          <p className="privacy-note">支持 .mid / .midi · 文件只在浏览器本地读取</p>
          {error && <p className="error-message">{error}</p>}
        </section>
      ) : (
        <section className="player">
          <div className="project-summary">
            <div>
              <p className="eyebrow">NOW LOADED</p>
              <h1>{project.name}</h1>
              <p>{project.tracks.length} 条音轨 <i /> {project.bpm} BPM <i /> {formatTime(project.duration)}</p>
            </div>
            <button className="replace-button" onClick={() => inputRef.current?.click()}>更换文件</button>
          </div>

          <div className="transport-card">
            <button className="jump-button" aria-label="回到开头" onClick={() => seek(0)}>│◀</button>
            <button className={`main-play ${isPlaying ? "playing" : ""}`} aria-label={isPlaying ? "暂停" : "播放"} onClick={isPlaying ? pause : play}>
              {isPlaying ? "Ⅱ" : "▶"}
            </button>
            <div className="time-current">{formatTime(position)}</div>
            <div className="scrubber">
              <div className="scrubber-fill" style={{ width: `${progress}%` }} />
              <input
                aria-label="播放进度"
                type="range"
                min="0"
                max={project.duration}
                step="0.01"
                value={position}
                onChange={(event) => seek(Number(event.target.value))}
              />
            </div>
            <div className="time-total">{formatTime(project.duration)}</div>
          </div>

          <div className="track-heading">
            <span>音轨</span>
            <span>{audibleTracks(project.tracks).length} / {project.tracks.length} 正在发声</span>
          </div>

          <div className="track-list">
            {project.tracks.map((track, index) => {
              const hasSolo = project.tracks.some((item) => item.solo);
              const audible = !track.muted && (!hasSolo || track.solo);
              const minPitch = Math.min(...track.notes.map((note) => note.midi));
              const maxPitch = Math.max(...track.notes.map((note) => note.midi));
              const range = Math.max(1, maxPitch - minPitch);
              return (
                <article className={`track-row ${audible ? "" : "inaudible"}`} key={track.id}>
                  <div className="track-index" style={{ color: track.color }}>{String(index + 1).padStart(2, "0")}</div>
                  <div className="track-meta">
                    <strong>{track.name}</strong>
                    <span>CH {track.channel} · {track.channel === 10 ? "Percussion" : GM_NAMES[track.program] || "Instrument"} · {track.notes.length} notes</span>
                  </div>
                  <div className="track-lane">
                    <div className="track-progress" style={{ width: `${progress}%`, background: track.color }} />
                    {track.notes.slice(0, 900).map((note, noteIndex) => (
                      <i
                        key={noteIndex}
                        style={{
                          left: `${(note.start / project.duration) * 100}%`,
                          width: `${Math.max(0.18, (note.duration / project.duration) * 100)}%`,
                          bottom: `${8 + ((note.midi - minPitch) / range) * 70}%`,
                          background: track.color,
                          opacity: 0.5 + note.velocity * 0.5,
                        }}
                      />
                    ))}
                    <span className="lane-playhead" style={{ left: `${progress}%` }} />
                  </div>
                  <div className="track-controls">
                    <button
                      className={track.muted ? "active mute" : ""}
                      aria-label={`${track.name} 静音`}
                      aria-pressed={track.muted}
                      onClick={() => toggleTrack(track.id, "muted")}
                    >M</button>
                    <button
                      className={track.solo ? "active solo" : ""}
                      aria-label={`${track.name} 独奏`}
                      aria-pressed={track.solo}
                      onClick={() => toggleTrack(track.id, "solo")}
                    >S</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".mid,.midi,audio/midi,audio/x-midi"
        onChange={(event) => loadFile(event.target.files?.[0])}
      />
      <footer>
        <span>HARMONIC / LOCAL MIDI ENGINE</span>
        <span><kbd>SPACE</kbd> PLAY / PAUSE</span>
      </footer>
    </main>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
