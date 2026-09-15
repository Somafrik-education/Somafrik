export interface DemoRuntimeState {
  id: string;
  expiresAt: string;
}

const STORAGE_KEY = "somafrik.demo.runtime";

export function normalizeDemoRuntimeState(value: unknown): DemoRuntimeState | null {
  if (!value || typeof value !== "object") return null;
  const source = value as { id?: unknown; expiresAt?: unknown };
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const expiresAt = typeof source.expiresAt === "string" ? source.expiresAt.trim() : "";
  const expiresAtMs = Date.parse(expiresAt);
  if (!id || !Number.isFinite(expiresAtMs)) return null;
  return { id, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function saveDemoRuntimeState(value: unknown): DemoRuntimeState {
  const state = normalizeDemoRuntimeState(value);
  if (!state) throw new Error("Métadonnées de session Démo invalides.");
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

export function loadDemoRuntimeState(): DemoRuntimeState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? normalizeDemoRuntimeState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearDemoRuntimeState() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // SessionStorage indisponible : la session d'authentification reste l'autorité.
  }
}

export function isDemoRuntimeExpired(state: DemoRuntimeState, now = Date.now()) {
  return Date.parse(state.expiresAt) <= now;
}

export function demoWatermarkLabel(state: DemoRuntimeState, now = Date.now()) {
  const stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ");
  const shortId = state.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12).toUpperCase();
  return `SOMAFRIK — DÉMONSTRATION — DONNÉES FICTIVES — ${shortId || "SESSION"} — ${stamp}Z`;
}
