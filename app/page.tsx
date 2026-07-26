"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Region = {
  id: number;
  name: string;
  start: number;
  length: number;
  color: string;
};

type Note = {
  id: number;
  pitch: number;
  start: number;
  length: number;
  velocity: number;
};

type TempoEvent = { beat: number; bpm: number };
type KeyEvent = { beat: number; root: number; mode: "Major" | "Minor" };

const TOTAL_BEATS = 32;
const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const PITCHES = Array.from({ length: 25 }, (_, index) => 72 - index);
const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10];
const DEGREE_NAMES = ["1", "2", "3", "4", "5", "6", "7"];

const initialRegions: Region[] = [
  { id: 1, name: "VERSE · MIDI", start: 0, length: 8, color: "#8568ff" },
  { id: 2, name: "PRE · MIDI", start: 8, length: 8, color: "#5b72f2" },
  { id: 3, name: "CHORUS · MIDI", start: 16, length: 12, color: "#ba63ea" },
];

const initialNotes: Note[] = [
  { id: 1, pitch: 60, start: 0, length: 1.5, velocity: 91 },
  { id: 2, pitch: 64, start: 2, length: 1.5, velocity: 96 },
  { id: 3, pitch: 67, start: 4, length: 1, velocity: 87 },
  { id: 4, pitch: 69, start: 5.5, length: 2, velocity: 102 },
  { id: 5, pitch: 67, start: 8, length: 1.5, velocity: 82 },
  { id: 6, pitch: 71, start: 10, length: 1.5, velocity: 94 },
  { id: 7, pitch: 72, start: 12, length: 3, velocity: 108 },
  { id: 8, pitch: 64, start: 16, length: 2, velocity: 92 },
  { id: 9, pitch: 67, start: 18.5, length: 1, velocity: 86 },
  { id: 10, pitch: 72, start: 20, length: 2, velocity: 110 },
  { id: 11, pitch: 71, start: 22.5, length: 1.5, velocity: 98 },
  { id: 12, pitch: 69, start: 24.5, length: 3, velocity: 93 },
];

function bpmAt(beat: number, events: TempoEvent[]) {
  return [...events].reverse().find((event) => event.beat <= beat)?.bpm ?? 120;
}

function keyAt(beat: number, events: KeyEvent[]) {
  return [...events].reverse().find((event) => event.beat <= beat) ?? events[0];
}

function noteName(midi: number) {
  return `${KEYS[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function degreeFor(pitch: number, key: KeyEvent) {
  const scale = key.mode === "Major" ? SCALE_MAJOR : SCALE_MINOR;
  const interval = (pitch - key.root + 120) % 12;
  const degree = scale.indexOf(interval);
  return degree >= 0 ? DEGREE_NAMES[degree] : "·";
}

export default function Home() {
  const [regions, setRegions] = useState(initialRegions);
  const [notes, setNotes] = useState(initialNotes);
  const [selected, setSelected] = useState<number[]>([1]);
  const [playhead, setPlayhead] = useState(5.25);
  const [zoom, setZoom] = useState(100);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempoEvents, setTempoEvents] = useState<TempoEvent[]>([
    { beat: 0, bpm: 118 },
    { beat: 16, bpm: 126 },
  ]);
  const [keyEvents, setKeyEvents] = useState<KeyEvent[]>([
    { beat: 0, root: 0, mode: "Major" },
    { beat: 16, root: 9, mode: "Minor" },
  ]);
  const [draftTempo, setDraftTempo] = useState(122);
  const [draftRoot, setDraftRoot] = useState(0);
  const [draftMode, setDraftMode] = useState<"Major" | "Minor">("Major");
  const [snap, setSnap] = useState(true);
  const [status, setStatus] = useState("Ready");
  const [drag, setDrag] = useState<
    | { type: "region"; id: number; originX: number; start: number }
    | { type: "trim-left" | "trim-right"; id: number; originX: number; start: number; length: number }
    | null
  >(null);
  const audioRef = useRef<AudioContext | null>(null);
  const lastAudibleBeat = useRef(-1);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const pxPerBeat = (58 * zoom) / 100;
  const surfaceWidth = TOTAL_BEATS * pxPerBeat;
  const currentKey = keyAt(playhead, keyEvents);
  const currentBpm = bpmAt(playhead, tempoEvents);

  const sortedTempo = useMemo(
    () => [...tempoEvents].sort((a, b) => a.beat - b.beat),
    [tempoEvents],
  );
  const sortedKeys = useMemo(
    () => [...keyEvents].sort((a, b) => a.beat - b.beat),
    [keyEvents],
  );

  const flash = useCallback((message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus("Ready"), 1800);
  }, []);

  const playTone = useCallback((pitch: number, duration = 0.16) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioRef.current) audioRef.current = new AudioContextClass();
    const context = audioRef.current;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    let previous = performance.now();
    let animation = 0;
    const tick = (now: number) => {
      const deltaSeconds = (now - previous) / 1000;
      previous = now;
      setPlayhead((beat) => {
        const next = beat + deltaSeconds * (bpmAt(beat, sortedTempo) / 60);
        if (next >= TOTAL_BEATS) {
          setIsPlaying(false);
          return 0;
        }
        const crossed = notes.filter((note) => note.start > lastAudibleBeat.current && note.start <= next);
        crossed.slice(0, 3).forEach((note) => playTone(note.pitch));
        lastAudibleBeat.current = next;
        return next;
      });
      animation = requestAnimationFrame(tick);
    };
    lastAudibleBeat.current = playhead - 0.05;
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [isPlaying, notes, playTone, sortedTempo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying((value) => !value);
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        setRegions((items) => items.filter((region) => !selected.includes(region.id)));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      const delta = (event.clientX - drag.originX) / pxPerBeat;
      const quantized = snap ? Math.round(delta * 4) / 4 : delta;
      setRegions((items) =>
        items.map((region) => {
          if (region.id !== drag.id) return region;
          if (drag.type === "region") {
            return { ...region, start: Math.max(0, Math.min(TOTAL_BEATS - region.length, drag.start + quantized)) };
          }
          if (drag.type === "trim-left") {
            const nextStart = Math.max(0, Math.min(drag.start + drag.length - 0.5, drag.start + quantized));
            return { ...region, start: nextStart, length: drag.length + drag.start - nextStart };
          }
          return { ...region, length: Math.max(0.5, Math.min(TOTAL_BEATS - drag.start, drag.length + quantized)) };
        }),
      );
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, pxPerBeat, snap]);

  function locateBeat(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = (event.clientX - rect.left) / pxPerBeat;
    return Math.max(0, Math.min(TOTAL_BEATS, snap ? Math.round(raw * 4) / 4 : raw));
  }

  function splitRegion() {
    const region = regions.find((item) => selected.includes(item.id) && playhead > item.start && playhead < item.start + item.length);
    if (!region) return flash("Move playhead inside a selected region");
    const nextId = Math.max(...regions.map((item) => item.id), 0) + 1;
    setRegions((items) => [
      ...items.map((item) => item.id === region.id ? { ...item, length: playhead - item.start } : item),
      { ...region, id: nextId, name: `${region.name.split(" ·")[0]} B · MIDI`, start: playhead, length: region.start + region.length - playhead },
    ]);
    setSelected([nextId]);
    flash("Region split at playhead");
  }

  function mergeRegions() {
    const picks = regions.filter((region) => selected.includes(region.id));
    if (picks.length < 2) return flash("Shift-click two regions to merge");
    const start = Math.min(...picks.map((item) => item.start));
    const end = Math.max(...picks.map((item) => item.start + item.length));
    const base = picks[0];
    setRegions((items) => [
      ...items.filter((item) => !selected.includes(item.id)),
      { ...base, id: Date.now(), name: "MERGED · MIDI", start, length: end - start },
    ]);
    setSelected([]);
    flash("Selected regions merged");
  }

  function addTempoEvent() {
    setTempoEvents((items) => [...items.filter((event) => Math.abs(event.beat - playhead) > 0.01), { beat: playhead, bpm: draftTempo }]);
    flash(`Tempo ${draftTempo} added at ${formatPosition(playhead)}`);
  }

  function addKeyEvent() {
    setKeyEvents((items) => [...items.filter((event) => Math.abs(event.beat - playhead) > 0.01), { beat: playhead, root: draftRoot, mode: draftMode }]);
    flash(`${KEYS[draftRoot]} ${draftMode} added at ${formatPosition(playhead)}`);
  }

  function formatPosition(beat: number) {
    const bar = Math.floor(beat / 4) + 1;
    const beatInBar = Math.floor(beat % 4) + 1;
    const ticks = Math.floor((beat % 1) * 960);
    return `${String(bar).padStart(2, "0")}.${beatInBar}.${String(ticks).padStart(3, "0")}`;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><i /><i /><i /><i /></span>
          <span>HARMONIC</span>
          <span className="edition">STUDIO</span>
        </div>
        <div className="transport" aria-label="Transport">
          <button className="icon-button" aria-label="Go to beginning" onClick={() => setPlayhead(0)}>│◀</button>
          <button
            className={`play-button ${isPlaying ? "is-playing" : ""}`}
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={() => setIsPlaying((value) => !value)}
          >
            {isPlaying ? "Ⅱ" : "▶"}
          </button>
          <button className="icon-button" aria-label="Stop" onClick={() => { setIsPlaying(false); setPlayhead(0); }}>■</button>
          <div className="time-readout">
            <span className="readout-label">POSITION</span>
            <strong>{formatPosition(playhead)}</strong>
          </div>
          <div className="tempo-readout">
            <span className="readout-label">TEMPO</span>
            <strong>{Math.round(currentBpm)}</strong><small>BPM</small>
          </div>
          <div className="key-readout">
            <span className="readout-label">KEY</span>
            <strong>{KEYS[currentKey.root]} {currentKey.mode === "Major" ? "MAJ" : "MIN"}</strong>
          </div>
        </div>
        <div className="top-actions">
          <span className={`status-dot ${status !== "Ready" ? "active" : ""}`} />
          <span className="status-text">{status}</span>
          <button className="export-button" onClick={() => flash("Project snapshot saved locally")}>SAVE</button>
        </div>
      </header>

      <section className="toolbar">
        <div className="tool-group">
          <button className="tool active" aria-label="Select tool">↖ <span>SELECT</span></button>
          <button className="tool" aria-label="Draw tool">✎ <span>DRAW</span></button>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={splitRegion}>⌁ <span>SPLIT</span></button>
          <button className="tool" onClick={mergeRegions}>⧉ <span>MERGE</span></button>
          <button className="tool" onClick={() => { setRegions((items) => items.filter((region) => !selected.includes(region.id))); setSelected([]); flash("Region deleted"); }}>× <span>DELETE</span></button>
        </div>
        <label className="snap-control">
          <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} />
          SNAP <b>1/16</b>
        </label>
        <div className="zoom-control">
          <span>−</span>
          <input aria-label="Timeline zoom" type="range" min="55" max="170" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          <span>＋</span>
          <b>{zoom}%</b>
        </div>
      </section>

      <div className="workspace">
        <aside className="inspector">
          <div className="inspector-heading">
            <span>GLOBAL EVENTS</span>
            <small>AT PLAYHEAD</small>
          </div>
          <div className="event-card tempo-card">
            <div className="event-icon">♩</div>
            <div>
              <span className="field-label">TEMPO</span>
              <div className="inline-input">
                <input type="number" min="40" max="240" value={draftTempo} onChange={(event) => setDraftTempo(Number(event.target.value))} />
                <span>BPM</span>
              </div>
            </div>
            <button onClick={addTempoEvent} aria-label="Add tempo event">＋</button>
          </div>
          <div className="event-card key-card">
            <div className="event-icon">♭</div>
            <div className="key-fields">
              <span className="field-label">KEY / SCALE</span>
              <div>
                <select aria-label="Key root" value={draftRoot} onChange={(event) => setDraftRoot(Number(event.target.value))}>
                  {KEYS.map((key, index) => <option value={index} key={key}>{key}</option>)}
                </select>
                <select aria-label="Scale mode" value={draftMode} onChange={(event) => setDraftMode(event.target.value as "Major" | "Minor")}>
                  <option>Major</option><option>Minor</option>
                </select>
              </div>
            </div>
            <button onClick={addKeyEvent} aria-label="Add key event">＋</button>
          </div>
          <div className="event-list">
            <div className="list-title"><span>AUTOMATION MAP</span><span>{tempoEvents.length + keyEvents.length}</span></div>
            {[...sortedTempo.map((event) => ({ ...event, kind: "tempo" as const })), ...sortedKeys.map((event) => ({ ...event, kind: "key" as const }))]
              .sort((a, b) => a.beat - b.beat)
              .map((event, index) => (
                <button className="event-row" key={`${event.kind}-${event.beat}-${index}`} onClick={() => setPlayhead(event.beat)}>
                  <span className={`event-pip ${event.kind}`} />
                  <span>{formatPosition(event.beat).slice(0, 4)}</span>
                  <strong>{event.kind === "tempo" ? `${event.bpm} BPM` : `${KEYS[event.root]} ${event.mode}`}</strong>
                </button>
              ))}
          </div>
          <div className="hint-box">
            <span>TIP</span>
            Set the playhead anywhere, then add tempo or key changes here.
          </div>
        </aside>

        <section className="editor">
          <div className="scroll-stage" ref={timelineRef}>
            <div className="timeline-content" style={{ width: surfaceWidth }}>
              <div className="ruler" onPointerDown={(event) => setPlayhead(locateBeat(event))}>
                {Array.from({ length: 9 }, (_, index) => (
                  <div className="bar-mark" key={index} style={{ left: index * 4 * pxPerBeat }}>
                    <b>{index + 1}</b>
                    <span />
                  </div>
                ))}
                {sortedTempo.map((event) => (
                  <button className="ruler-event tempo" key={`t-${event.beat}`} style={{ left: event.beat * pxPerBeat }} onClick={(e) => { e.stopPropagation(); setPlayhead(event.beat); }} title={`${event.bpm} BPM`}>
                    {event.bpm}
                  </button>
                ))}
                {sortedKeys.map((event) => (
                  <button className="ruler-event key" key={`k-${event.beat}`} style={{ left: event.beat * pxPerBeat }} onClick={(e) => { e.stopPropagation(); setPlayhead(event.beat); }} title={`${KEYS[event.root]} ${event.mode}`}>
                    {KEYS[event.root]}{event.mode === "Minor" ? "m" : ""}
                  </button>
                ))}
              </div>

              <div className="arrangement" onPointerDown={(event) => { if (event.target === event.currentTarget) setPlayhead(locateBeat(event)); }}>
                <div className="lane-label">MIDI 01</div>
                {regions.map((region) => (
                  <div
                    className={`region ${selected.includes(region.id) ? "selected" : ""}`}
                    key={region.id}
                    style={{ left: region.start * pxPerBeat, width: region.length * pxPerBeat, "--region": region.color } as React.CSSProperties}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (event.shiftKey) setSelected((items) => items.includes(region.id) ? items.filter((id) => id !== region.id) : [...items, region.id]);
                      else setSelected([region.id]);
                      setDrag({ type: "region", id: region.id, originX: event.clientX, start: region.start });
                    }}
                  >
                    <button className="trim-handle left" aria-label={`Trim left edge of ${region.name}`} onPointerDown={(event) => { event.stopPropagation(); setDrag({ type: "trim-left", id: region.id, originX: event.clientX, start: region.start, length: region.length }); }} />
                    <span>{region.name}</span>
                    <div className="region-notes">
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <i key={n} style={{ left: `${6 + n * 11}%`, top: `${25 + ((n * 17) % 50)}%`, width: `${5 + (n % 3) * 4}%` }} />)}
                    </div>
                    <button className="trim-handle right" aria-label={`Trim right edge of ${region.name}`} onPointerDown={(event) => { event.stopPropagation(); setDrag({ type: "trim-right", id: region.id, originX: event.clientX, start: region.start, length: region.length }); }} />
                  </div>
                ))}
              </div>

              <div className="piano-roll">
                <div className="piano-sidebar">
                  <div className="roll-title"><span>PIANO ROLL</span><small>DEGREE VIEW</small></div>
                  {PITCHES.map((pitch) => (
                    <button
                      key={pitch}
                      className={`piano-key ${[1, 3, 6, 8, 10].includes(pitch % 12) ? "black" : ""}`}
                      onClick={() => playTone(pitch, 0.35)}
                    >
                      {pitch % 12 === 0 || [59, 64, 67, 71].includes(pitch) ? noteName(pitch) : ""}
                    </button>
                  ))}
                </div>
                <div
                  className="note-grid"
                  style={{ width: surfaceWidth }}
                  onDoubleClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const beat = Math.max(0, Math.min(TOTAL_BEATS - 0.5, (event.clientX - rect.left) / pxPerBeat));
                    const row = Math.max(0, Math.min(PITCHES.length - 1, Math.floor((event.clientY - rect.top) / 24)));
                    const pitch = PITCHES[row];
                    setNotes((items) => [...items, { id: Date.now(), pitch, start: snap ? Math.round(beat * 4) / 4 : beat, length: 1, velocity: 90 }]);
                    playTone(pitch);
                  }}
                >
                  {PITCHES.map((pitch, row) => (
                    <div className={`pitch-row ${[1, 3, 6, 8, 10].includes(pitch % 12) ? "black-row" : ""}`} key={pitch} style={{ top: row * 24 }} />
                  ))}
                  {Array.from({ length: TOTAL_BEATS * 4 + 1 }, (_, index) => <i className={`grid-line ${index % 16 === 0 ? "bar" : index % 4 === 0 ? "beat" : ""}`} key={index} style={{ left: index * pxPerBeat / 4 }} />)}
                  {notes.map((note) => {
                    const row = PITCHES.indexOf(note.pitch);
                    const noteKey = keyAt(note.start, sortedKeys);
                    return (
                      <button
                        className={`midi-note ${degreeFor(note.pitch, noteKey) === "·" ? "chromatic" : ""}`}
                        key={note.id}
                        style={{ left: note.start * pxPerBeat, top: row * 24 + 3, width: Math.max(16, note.length * pxPerBeat), opacity: 0.65 + note.velocity / 300 }}
                        onClick={(event) => { event.stopPropagation(); playTone(note.pitch); }}
                        onContextMenu={(event) => { event.preventDefault(); setNotes((items) => items.filter((item) => item.id !== note.id)); }}
                        title={`${noteName(note.pitch)} · degree ${degreeFor(note.pitch, noteKey)} · right-click to delete`}
                      >
                        <span>{degreeFor(note.pitch, noteKey)}</span>
                        <small>{noteName(note.pitch)}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="playhead" style={{ left: playhead * pxPerBeat }}>
                <span />
              </div>
            </div>
          </div>
        </section>
      </div>
      <footer>
        <span><kbd>SPACE</kbd> PLAY / PAUSE</span>
        <span><kbd>⇧ CLICK</kbd> MULTI-SELECT</span>
        <span><kbd>DOUBLE CLICK</kbd> ADD NOTE</span>
        <span><kbd>RIGHT CLICK</kbd> DELETE NOTE</span>
        <strong>{regions.length} REGIONS · {notes.length} NOTES</strong>
      </footer>
    </main>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
