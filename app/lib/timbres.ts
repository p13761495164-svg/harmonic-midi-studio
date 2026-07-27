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

export type CustomTimbre = {
  id: number;
  key: string;
  name: string;
  description: string;
  baseProgram: number;
  engine: "standard" | "kalimba";
  transposeKalimba: boolean;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filter: number;
  resonance: number;
  harmonics: number;
  level: number;
  wet: number;
  updatedAt: string;
};

export type ProgramMapping = {
  program: number;
  customTimbreId: number | null;
  updatedAt?: string;
};

function applicationBase() {
  if (typeof window === "undefined") return "";
  const path = window.location.pathname;
  const managerIndexes = [path.indexOf("/timbres"), path.indexOf("/custom-timbres")].filter((index) => index >= 0);
  if (managerIndexes.length) return path.slice(0, Math.min(...managerIndexes));
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

export async function fetchCustomTimbres() {
  const response = await fetch(`${applicationBase()}/api/custom-timbres.php`, { cache: "no-store" });
  const payload = await response.json().catch(() => null) as { customTimbres?: CustomTimbre[]; error?: string } | null;
  if (!response.ok || !payload?.customTimbres) throw new Error(payload?.error || "无法读取 Custom 音色");
  return payload.customTimbres;
}

export async function saveCustomTimbre(timbre: CustomTimbre, create = false) {
  const response = await fetch(`${applicationBase()}/api/custom-timbres.php`, {
    method: create ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(timbre),
  });
  const payload = await response.json().catch(() => null) as { customTimbre?: CustomTimbre; error?: string } | null;
  if (!response.ok || !payload?.customTimbre) throw new Error(payload?.error || "无法保存 Custom 音色");
  return payload.customTimbre;
}

export async function deleteCustomTimbre(id: number) {
  const response = await fetch(`${applicationBase()}/api/custom-timbres.php?id=${id}`, { method: "DELETE" });
  const payload = await response.json().catch(() => null) as { deleted?: boolean; error?: string } | null;
  if (!response.ok || !payload?.deleted) throw new Error(payload?.error || "无法删除 Custom 音色");
}

export async function fetchMappings() {
  const response = await fetch(`${applicationBase()}/api/mappings.php`, { cache: "no-store" });
  const payload = await response.json().catch(() => null) as { mappings?: ProgramMapping[]; error?: string } | null;
  if (!response.ok || !payload?.mappings) throw new Error(payload?.error || "无法读取音色映射");
  return payload.mappings;
}

export async function updateMapping(program: number, customTimbreId: number | null) {
  const response = await fetch(`${applicationBase()}/api/mappings.php`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ program, customTimbreId }),
  });
  const payload = await response.json().catch(() => null) as { mapping?: ProgramMapping; error?: string } | null;
  if (!response.ok || !payload?.mapping) throw new Error(payload?.error || "无法保存音色映射");
  return payload.mapping;
}
