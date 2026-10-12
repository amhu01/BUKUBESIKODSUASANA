import { AppState } from 'react-native';
import type { EditorDraft } from './components/SessionEditor';
import { deleteSetting, getSettings, setSetting } from './db/repository';

/**
 * The workout being typed on the Log tab, persisted so it survives the app
 * crashing or being killed, not just a redraw. Kept in memory for instant reads
 * and written to the settings table shortly after each change (and immediately
 * when the app goes to the background). Cleared when the session is saved.
 */

const KEY = 'logDraft';
const WRITE_DELAY_MS = 400;

let current: EditorDraft | null = null;
/** True when `current` came back from disk at launch, i.e. the last run ended with unsaved work. */
let restored = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function isEmpty(d: EditorDraft): boolean {
  return d.exercises.length === 0 && d.name.trim() === '' && d.notes.trim() === '';
}

function isDraft(v: unknown): v is EditorDraft {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d.date === 'string' && typeof d.name === 'string' && typeof d.notes === 'string' && Array.isArray(d.exercises);
}

async function write() {
  timer = null;
  try {
    if (!current || isEmpty(current)) await deleteSetting(KEY);
    else await setSetting(KEY, JSON.stringify(current));
  } catch {
    // A failed write must never break typing; the next change retries.
  }
}

/** Called once at launch, before the Log screen mounts. */
export async function loadDraft(): Promise<void> {
  try {
    const raw = (await getSettings())[KEY];
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isDraft(parsed) && !isEmpty(parsed)) {
      current = parsed;
      restored = true;
    }
  } catch {
    // Unreadable draft: start clean rather than crash on launch.
  }
}

export function getDraft(): EditorDraft | null {
  return current;
}

export function wasRestored(): boolean {
  return restored;
}

export function dismissRestored() {
  restored = false;
}

export function setDraft(draft: EditorDraft) {
  current = draft;
  if (timer) clearTimeout(timer);
  timer = setTimeout(write, WRITE_DELAY_MS);
}

/** Write any pending change now. */
export function flushDraft() {
  if (!timer) return;
  clearTimeout(timer);
  void write();
}

export function clearDraft() {
  current = null;
  restored = false;
  if (timer) clearTimeout(timer);
  timer = null;
  void deleteSetting(KEY).catch(() => {});
}

// Android may kill a backgrounded app without warning, so never leave a write pending.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') flushDraft();
});
