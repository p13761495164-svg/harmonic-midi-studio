"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CloudInstrument,
  CustomTimbre,
  ProgramMapping,
  fetchCustomTimbres,
  fetchInstruments,
  fetchMappings,
  updateInstrument,
  updateMapping,
} from "../lib/timbres";

const PREVIEW_NOTES = [60, 62, 64, 65, 67, 69, 71, 72];

type PreviewVoice = { oscillator: OscillatorNode; gain: GainNode };

function previewWave(program: number): OscillatorType {
  const family = Math.floor(program / 8);
  if (family === 4) return "square";
  if ([5, 6, 7, 8, 9, 10, 11].includes(family)) return "sawtooth";
  return family === 2 ? "sine" : "triangle";
}

function isPlucked(program: number) {
  return [0, 1, 3, 13].includes(Math.floor(program / 8)) || program === 46;
}

function makePreviewReverb(context: AudioContext) {
  const length = Math.floor(context.sampleRate * 1.2);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 2.7);
    }
  }
  return buffer;
}

export default function TimbreManager() {
  const [instruments, setInstruments] = useState<CloudInstrument[]>([]);
  const [selectedProgram, setSelectedProgram] = useState(0);
  const [draft, setDraft] = useState<CloudInstrument | null>(null);
  const [query, setQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [status, setStatus] = useState("正在连接 MySQL 音色库…");
  const [saving, setSaving] = useState(false);
  const [customTimbres, setCustomTimbres] = useState<CustomTimbre[]>([]);
  const [mappings, setMappings] = useState<ProgramMapping[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const voicesRef = useRef<PreviewVoice[]>([]);

  useEffect(() => {
    Promise.all([fetchInstruments(), fetchCustomTimbres(), fetchMappings()])
      .then(([items, customItems, mappingItems]) => {
        setInstruments(items);
        setCustomTimbres(customItems);
        setMappings(mappingItems);
        setDraft(items[0] ?? null);
        setStatus(`已连接 · ${items.length} 个 GM 乐器 · ${customItems.length} 个 Custom 音色`);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "无法连接音色库"));
    return () => {
      voicesRef.current.forEach(({ oscillator }) => {
        try { oscillator.stop(); } catch {}
      });
    };
  }, []);

  const visible = useMemo(() => instruments.filter((instrument) => {
    const matchesQuery = `${instrument.program + 1} ${instrument.name} ${instrument.family}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (!favoriteOnly || instrument.favorite);
  }), [favoriteOnly, instruments, query]);
  const selectedMapping = mappings.find((mapping) => mapping.program === selectedProgram);
  const mappedCustom = customTimbres.find((item) => item.id === selectedMapping?.customTimbreId);

  function selectInstrument(instrument: CloudInstrument) {
    setSelectedProgram(instrument.program);
    setDraft({ ...instrument });
  }

  function change<K extends keyof CloudInstrument>(key: K, value: CloudInstrument[K]) {
    if (draft) setDraft({ ...draft, [key]: value });
  }

  function stopPreview() {
    const context = audioRef.current;
    if (!context) return;
    const now = context.currentTime;
    voicesRef.current.forEach(({ oscillator, gain }) => {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0.0001, now, 0.008);
        oscillator.stop(now + 0.05);
      } catch {}
    });
    voicesRef.current = [];
  }

  function previewScale() {
    if (!draft) return;
    if (!audioRef.current) audioRef.current = new AudioContext();
    const context = audioRef.current;
    void context.resume();
    stopPreview();

    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const reverb = context.createConvolver();
    const wet = context.createGain();
    master.gain.value = 0.72;
    compressor.threshold.value = -18;
    compressor.ratio.value = 2;
    reverb.buffer = makePreviewReverb(context);
    wet.gain.value = draft.wet;
    master.connect(compressor).connect(context.destination);
    reverb.connect(wet).connect(compressor);

    PREVIEW_NOTES.forEach((midi, index) => {
      const start = context.currentTime + 0.06 + index * 0.32;
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      const noteOff = start + 0.22;
      const end = isPlucked(draft.program) ? start + draft.release : noteOff + draft.release;
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      filter.type = "lowpass";
      filter.frequency.value = draft.filter;
      filter.Q.value = draft.resonance;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, draft.level), start + draft.attack);
      if (isPlucked(draft.program)) {
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      } else {
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, draft.level * draft.sustain), start + draft.attack + draft.decay);
        envelope.gain.setValueAtTime(Math.max(0.0002, draft.level * draft.sustain), noteOff);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      }
      filter.connect(envelope);
      envelope.connect(master);
      envelope.connect(reverb);

      const partials = [{ ratio: 1, level: 1 }, { ratio: 2, level: draft.harmonics }];
      partials.forEach((partial, partialIndex) => {
        const oscillator = context.createOscillator();
        const partialGain = context.createGain();
        oscillator.type = partialIndex === 0 ? previewWave(draft.program) : "sine";
        oscillator.frequency.value = frequency * partial.ratio;
        partialGain.gain.value = partial.level;
        oscillator.connect(partialGain).connect(filter);
        oscillator.start(start);
        oscillator.stop(end + 0.05);
        const voice = { oscillator, gain: envelope };
        voicesRef.current.push(voice);
        oscillator.onended = () => {
          voicesRef.current = voicesRef.current.filter((item) => item !== voice);
        };
      });
    });
    setStatus(`正在试听 ${draft.name} · 1 2 3 4 5 6 7 1`);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await updateInstrument(draft);
      setInstruments((current) => current.map((item) => item.program === saved.program ? saved : item));
      setDraft(saved);
      setStatus(`已永久保存 ${saved.name} 到 MySQL`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite(instrument: CloudInstrument) {
    const next = { ...instrument, favorite: !instrument.favorite };
    setInstruments((current) => current.map((item) => item.program === next.program ? next : item));
    if (draft?.program === next.program) setDraft(next);
    try {
      const saved = await updateInstrument(next);
      setInstruments((current) => current.map((item) => item.program === saved.program ? saved : item));
      if (draft?.program === saved.program) setDraft(saved);
      setStatus(saved.favorite ? `已收藏 ${saved.name}` : `已取消收藏 ${saved.name}`);
    } catch (error) {
      setInstruments((current) => current.map((item) => item.program === instrument.program ? instrument : item));
      if (draft?.program === instrument.program) setDraft(instrument);
      setStatus(error instanceof Error ? error.message : "收藏失败");
    }
  }

  async function changeMapping(customTimbreId: number | null) {
    if (!draft) return;
    try {
      const saved = await updateMapping(draft.program, customTimbreId);
      setMappings((current) => [
        ...current.filter((mapping) => mapping.program !== saved.program),
        ...(saved.customTimbreId === null ? [] : [saved]),
      ]);
      const custom = customTimbres.find((item) => item.id === saved.customTimbreId);
      setStatus(custom ? `已将 ${draft.name} 映射到 ${custom.name}` : `已解除 ${draft.name} 的 Custom 映射`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "映射保存失败");
    }
  }

  return (
    <main className="timbre-manager-shell">
      <header className="manager-header">
        <div>
          <span>HARMONIC / MYSQL</span>
          <h1>MIDI 音色管理</h1>
          <p>{status}</p>
        </div>
        <nav><Link href="/custom-timbres/">Custom 音色</Link><Link href="/">← 返回播放器</Link></nav>
      </header>

      <section className="manager-layout">
        <aside className="instrument-browser">
          <div className="instrument-filters">
            <input aria-label="搜索乐器" placeholder="搜索名称、Family 或编号" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className={favoriteOnly ? "active" : ""} onClick={() => setFavoriteOnly((value) => !value)}>★ 收藏</button>
          </div>
          <div className="instrument-list">
            {visible.map((instrument) => (
              <div className={selectedProgram === instrument.program ? "selected" : ""} key={instrument.program}>
                <button className="instrument-select" onClick={() => selectInstrument(instrument)}>
                  <span>{String(instrument.program + 1).padStart(3, "0")}</span>
                  <span>
                    <strong>{instrument.name}</strong>
                    <small>{mappings.some((mapping) => mapping.program === instrument.program) ? `CUSTOM MAP · ${instrument.family}` : instrument.family}</small>
                  </span>
                </button>
                <button className={instrument.favorite ? "instrument-favorite active" : "instrument-favorite"} aria-label={instrument.favorite ? `取消收藏 ${instrument.name}` : `收藏 ${instrument.name}`} onClick={() => toggleFavorite(instrument)}>
                  {instrument.favorite ? "★" : "☆"}
                </button>
              </div>
            ))}
            {!visible.length && <p>没有匹配的乐器</p>}
          </div>
        </aside>

        {draft ? (
          <section className="cloud-timbre-editor">
            <div className="cloud-editor-title">
              <div>
                <span>PROGRAM {String(draft.program + 1).padStart(3, "0")} · STANDARD GM</span>
                <h2>{draft.name}</h2>
                <p>{mappedCustom ? `当前播放映射：${mappedCustom.name}` : `${draft.family} · 当前使用标准 GM 合成音色`}</p>
              </div>
              <button className={draft.favorite ? "favorite active" : "favorite"} onClick={() => toggleFavorite(draft)}>
                {draft.favorite ? "★ 已收藏" : "☆ 收藏音色"}
              </button>
            </div>

            <div className={mappedCustom ? "mapping-control mapped" : "mapping-control"}>
              <div>
                <span>CUSTOM MAPPING</span>
                <strong>{mappedCustom ? mappedCustom.name : "没有映射"}</strong>
                <small>{mappedCustom ? `实际播放 Custom 音色；GM 名称仍保留为 ${draft.name}` : "实际播放此 GM 音色本身"}</small>
              </div>
              <select aria-label="Custom 音色映射" value={selectedMapping?.customTimbreId ?? ""} onChange={(event) => changeMapping(event.target.value ? Number(event.target.value) : null)}>
                <option value="">不使用 Custom 映射</option>
                {customTimbres.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
              {mappedCustom && <button onClick={() => changeMapping(null)}>解除映射</button>}
            </div>

            <div className="cloud-parameter-grid">
              {([
                ["attack", "起音 Attack", 0.001, 0.4, 0.001, `${Math.round(draft.attack * 1000)} ms`],
                ["decay", "衰减 Decay", 0.03, 1.2, 0.01, `${draft.decay.toFixed(2)} s`],
                ["sustain", "保持 Sustain", 0, 1, 0.01, `${Math.round(draft.sustain * 100)}%`],
                ["release", "尾音 Release", 0.08, 4, 0.01, `${draft.release.toFixed(2)} s`],
                ["filter", "明亮度 Brightness", 300, 10000, 50, `${Math.round(draft.filter)} Hz`],
                ["resonance", "共鸣 Resonance", 0.1, 12, 0.1, draft.resonance.toFixed(1)],
                ["harmonics", "泛音 Harmonics", 0, 1.5, 0.01, `${Math.round(draft.harmonics * 100)}%`],
                ["level", "音量 Volume", 0.02, 0.2, 0.002, `${Math.round(draft.level / 0.2 * 100)}%`],
                ["wet", "混响 Reverb", 0, 0.5, 0.01, `${Math.round(draft.wet * 200)}%`],
              ] as const).map(([key, label, min, max, step, display]) => (
                <label key={key}>
                  <span>{label}<b>{display}</b></span>
                  <input type="range" min={min} max={max} step={step} value={draft[key]} onChange={(event) => change(key, Number(event.target.value))} />
                </label>
              ))}
            </div>

            <div className="cloud-editor-actions">
              <button className="scale-preview" onClick={previewScale}>▶ 试听标准 GM · 1 2 3 4 5 6 7 1</button>
              <button className="cloud-save" disabled={saving} onClick={save}>{saving ? "保存中…" : "永久保存到 MySQL"}</button>
            </div>
          </section>
        ) : (
          <section className="cloud-timbre-editor empty"><p>请先完成 MySQL 配置并运行数据库脚本。</p></section>
        )}
      </section>
    </main>
  );
}
