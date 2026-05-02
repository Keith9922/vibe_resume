import type { AppState, ResumeData } from "@/lib/types";
import { SCHEMA_VERSION } from "@/lib/types";

const STORAGE_KEY = "stori-state-v2";

export const DEFAULT_RESUME: ResumeData = {
  name: "",
  headline: "",
  location: "",
  email: "",
  phone: "",
  links: [],
  summary: "",
  skills: [],
  experiences: [],
  education: [],
  notes: [],
  targetRole: "",
  updatedAt: new Date().toISOString(),
};

export const DEFAULT_STATE: AppState = {
  schemaVersion: SCHEMA_VERSION,
  jd: null,
  jobAnalysis: null,
  messages: [],
  phase: "intro",
  turnCount: 0,
  stories: [],
  resume: null,
};

export function loadState(): AppState {
  if (typeof window === "undefined") return { ...DEFAULT_STATE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed.schemaVersion || parsed.schemaVersion < SCHEMA_VERSION) {
      return { ...DEFAULT_STATE };
    }
    return parsed;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable
  }
}

export function resetState(): AppState {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
  return { ...DEFAULT_STATE };
}

export function patchState(patch: Partial<AppState>): AppState {
  const current = loadState();
  const next = { ...current, ...patch };
  saveState(next);
  return next;
}
