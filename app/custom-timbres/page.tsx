"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CloudInstrument,
  CustomTimbre,
  ProgramMapping,
  deleteCustomTimbre,
  fetchCustomTimbres,
  fetchInstruments,
  fetchMappings,
  saveCustomTimbre,
} from "../lib/timbres";

const SCALE = [60, 62, 64, 65, 67, 69, 71, 72];

function blankCustom(source?: CloudInstrument): CustomTimbre {
  return {
    id: 0,
    key: "",
    name: "New Custom Timbre",
    description: "",
    baseProgram: source?.program ?? 0,
    engine: "standard",
    transposeKalimba: false,
    attack: source?.attack ?? 0.004,
    decay: source?.decay ?? 0.16,
    sustain: source?.sustain ?? 0,
    release: source?.release ?? 1.7,
    filter: source?.filter ?? 4200,
    resonance: source?.resonance ?? 0.8,
    harmonics: source?.harmonics ?? 0.28,
    level: source?.level ?? 0.09,
    wet: source?.wet ?? 0.12,
    updatedAt: "",
  };
}

function familyWave(program: number): OscillatorType {
  const family = Math.floor(program / 8);
  if (family === 4) return "square";
  if ([5, 6, 7, 8, 9, 10, 11].includes(family)) return "sawtooth";
  return family === 2 ? "sine" : "triangle";
}

export default function CustomTimbresPage() {
  const [items, setItems] = useState<CustomTimbre[]>([]);
  const [instruments, setInstruments] = useState<CloudInstrument[]>([]);
  const [mappings, setMappings] = useState<ProgramMapping[]>([]);
  const [draft, setDraft] = useState<CustomTimbre | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("正在读取 Custom 音色…");
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    Promise.all([fetchCustomTimbres(), fetchInstruments(), fetchMappings()])
      .then(([customItems, gmItems, mappingItems]) => {
        setItems(customItems);
        setInstruments(gmItems);
        setMappings(mappingItems);
        setDraft(customItems[0] ?? blankCustom(gmItems[0]));
        setCreating(customItems.length === 0);
        setStatus(`已连接 · ${customItems.length} 个 Custom 音色`);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "无法读取 Custom 音色"));
  }, []);

  function change<K extends keyof CustomTimbre>(key: K, value: CustomTimbre[K]) {
    if (draft) setDraft({ ...draft, [key]: value });
  }

  function choose(item: CustomTimbre) {
    setDraft({ ...item });
    setCreating(false);
  }

  function createNew() {
    setDraft(blankCustom(instruments[0]));
    setCreating(true);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await saveCustomTimbre(draft, creating);
      setItems((current) => [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(saved);
      setCreating(false);
      setStatus(`已永久保存 ${saved.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft || creating || !window.confirm(`删除 Custom 音色“${draft.name}”？相关 GM 映射会同时解除。`)) return;
    try {
      await deleteCustomTimbre(draft.id);
      const next = items.filter((item) => item.id !== draft.id);
      setItems(next);
      setMappings((current) => current.filter((mapping) => mapping.customTimbreId !== draft.id));
      setDraft(next[0] ?? blankCustom(instruments[0]));
      setCreating(next.length === 0);
      setStatus(`已删除 ${draft.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除失败");
    }
  }

  function preview() {
    if (!draft) return;
    if (!audioRef.current) audioRef.current = new AudioContext();
    const context = audioRef.current;
    void context.resume();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = 0.68;
    compressor.threshold.value = -18;
    master.connect(compressor).connect(context.destination);

    SCALE.forEach((midi, index) => {
      const start = context.currentTime + 0.05 + index * 0.3;
      const end = start + Math.max(0.15, draft.release);
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      filter.type = "lowpass";
      filter.frequency.value = draft.filter;
      filter.Q.value = draft.resonance;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(draft.level, start + draft.attack);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      filter.connect(envelope).connect(master);

      const partials = draft.engine === "kalimba"
        ? draft.transposeKalimba
          ? [[1, 1], [4.03, draft.harmonics]]
          : [[1, 0.68], [2.76, draft.harmonics * 0.72], [5.4, draft.harmonics * 0.28]]
        : [[1, 1], [2, draft.harmonics]];
      partials.forEach(([ratio, level], partialIndex) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = draft.engine === "kalimba" || partialIndex > 0 ? "sine" : familyWave(draft.baseProgram);
        oscillator.frequency.value = frequency * ratio;
        gain.gain.value = level;
        oscillator.connect(gain).connect(filter);
        oscillator.start(start);
        oscillator.stop(end + 0.04);
      });
    });
    setStatus(`正在试听 ${draft.name} · 1 2 3 4 5 6 7 1`);
  }

  const mappedPrograms = draft
    ? mappings.filter((mapping) => mapping.customTimbreId === draft.id).map((mapping) => mapping.program + 1)
    : [];

  return (
    <main className="timbre-manager-shell custom-manager-shell">
      <header className="manager-header">
        <div><span>HARMONIC / CUSTOM LIBRARY</span><h1>Custom 音色列表</h1><p>{status}</p></div>
        <nav><Link href="/timbres/">GM 音色管理</Link><Link href="/">← 返回播放器</Link></nav>
      </header>

      <section className="custom-manager-layout">
        <aside className="custom-list">
          <button className="new-custom" onClick={createNew}>＋ 新建 Custom 音色</button>
          {items.map((item) => {
            const programs = mappings.filter((mapping) => mapping.customTimbreId === item.id).map((mapping) => mapping.program + 1);
            return (
              <button className={!creating && draft?.id === item.id ? "selected" : ""} key={item.id} onClick={() => choose(item)}>
                <strong>{item.name}</strong>
                <span>{item.engine === "kalimba" ? "KALIMBA ENGINE" : "STANDARD SYNTH"}</span>
                <small>{programs.length ? `映射到 ${programs.map((program) => `P${String(program).padStart(3, "0")}`).join(", ")}` : "尚未映射"}</small>
              </button>
            );
          })}
        </aside>

        {draft && (
          <section className="custom-editor">
            <div className="custom-editor-heading">
              <div><span>{creating ? "NEW CUSTOM TIMBRE" : draft.key}</span><h2>{draft.name}</h2><p>{mappedPrograms.length ? `当前映射：${mappedPrograms.map((program) => `P${String(program).padStart(3, "0")}`).join(", ")}` : "可在 GM 音色管理中建立映射"}</p></div>
              {!creating && <button className="delete-custom" onClick={remove}>删除</button>}
            </div>

            <div className="custom-meta-grid">
              <label><span>名称</span><input value={draft.name} maxLength={96} onChange={(event) => change("name", event.target.value)} /></label>
              <label><span>基础 GM 音色</span><select value={draft.baseProgram} onChange={(event) => change("baseProgram", Number(event.target.value))}>{instruments.map((item) => <option value={item.program} key={item.program}>{String(item.program + 1).padStart(3, "0")} · {item.name}</option>)}</select></label>
              <label><span>合成引擎</span><select value={draft.engine} onChange={(event) => change("engine", event.target.value as CustomTimbre["engine"])}><option value="standard">Standard Synth</option><option value="kalimba">Kalimba Engine</option></select></label>
              <label className="custom-description"><span>说明</span><input value={draft.description} maxLength={240} onChange={(event) => change("description", event.target.value)} /></label>
              {draft.engine === "kalimba" && <label className="custom-check"><input type="checkbox" checked={draft.transposeKalimba} onChange={(event) => change("transposeKalimba", event.target.checked)} /><span>使用 Transpose Piano 高泛音模式</span></label>}
            </div>

            <div className="cloud-parameter-grid">
              {([
                ["attack", "起音 Attack", 0.001, 0.4, 0.001, `${Math.round(draft.attack * 1000)} ms`],
                ["decay", "衰减 Decay", 0.03, 1.2, 0.01, `${draft.decay.toFixed(2)} s`],
                ["sustain", "保持 Sustain", 0, 1, 0.01, `${Math.round(draft.sustain * 100)}%`],
                ["release", "尾音 Release", 0.08, 4, 0.01, `${draft.release.toFixed(2)} s`],
                ["filter", "明亮度", 300, 10000, 50, `${Math.round(draft.filter)} Hz`],
                ["resonance", "共鸣", 0.1, 12, 0.1, draft.resonance.toFixed(1)],
                ["harmonics", "泛音", 0, 1.5, 0.01, `${Math.round(draft.harmonics * 100)}%`],
                ["level", "音量", 0.02, 0.2, 0.002, `${Math.round(draft.level / 0.2 * 100)}%`],
                ["wet", "混响", 0, 0.5, 0.01, `${Math.round(draft.wet * 200)}%`],
              ] as const).map(([key, label, min, max, step, display]) => (
                <label key={key}><span>{label}<b>{display}</b></span><input type="range" min={min} max={max} step={step} value={draft[key]} onChange={(event) => change(key, Number(event.target.value))} /></label>
              ))}
            </div>

            <div className="cloud-editor-actions">
              <button className="scale-preview" onClick={preview}>▶ 试听 1 2 3 4 5 6 7 1</button>
              <button className="cloud-save" disabled={saving} onClick={save}>{saving ? "保存中…" : creating ? "创建 Custom 音色" : "永久保存到 MySQL"}</button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
