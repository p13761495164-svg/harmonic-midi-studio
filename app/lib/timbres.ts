export type CloudInstrument = {
  program: number;
  name: string;
  family: string;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filter: number;
  resonance: number;
  harmonics: number;
  level: number;
  wet: number;
  favorite: boolean;
  updatedAt: string;
};

function applicationBase() {
  if (typeof window === "undefined") return "";
  const path = window.location.pathname;
  const timbreIndex = path.indexOf("/timbres");
  if (timbreIndex >= 0) return path.slice(0, timbreIndex);
  return path.endsWith("/") ? path.slice(0, -1) : path.replace(/\/index\.html$/, "");
}

export function instrumentsApiUrl(favoritesOnly = false) {
  const suffix = favoritesOnly ? "?favorites=1" : "";
  return `${applicationBase()}/api/instruments.php${suffix}`;
}

export async function fetchInstruments(favoritesOnly = false) {
  const response = await fetch(instrumentsApiUrl(favoritesOnly), { cache: "no-store" });
  const payload = await response.json().catch(() => null) as { instruments?: CloudInstrument[]; error?: string } | null;
  if (!payload) throw new Error("PHP 音色接口尚未连接");
  if (!response.ok || !payload.instruments) throw new Error(payload.error || "无法读取音色库");
  return payload.instruments;
}

export async function updateInstrument(instrument: CloudInstrument) {
  const response = await fetch(instrumentsApiUrl(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(instrument),
  });
  const payload = await response.json().catch(() => null) as { instrument?: CloudInstrument; error?: string } | null;
  if (!payload) throw new Error("PHP 音色接口没有返回有效数据");
  if (!response.ok || !payload.instrument) throw new Error(payload.error || "无法保存音色");
  return payload.instrument;
}
