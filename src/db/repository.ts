import { getDb } from './database';
import type {
  DayActivity,
  Exercise,
  ExerciseCatalogEntry,
  ExerciseLastUse,
  MuscleGroupSets,
  PersonalBest,
  Session,
  SessionSummary,
  SetEntry,
  StatsSummary,
  SummaryExercise,
} from '../types';
import { MUSCLE_GROUP_ALIASES } from '../types';
import { dateToString, parseDateString } from '../utils/date';
import { bestEffectiveWeight, countSets, exerciseVolume, sessionVolume } from '../utils/stats';
import { parseCount, weightToKg } from '../utils/weight';

type Db = Awaited<ReturnType<typeof getDb>>;

function toNumOrStr(v: string | null): number | string {
  if (v === null || v === undefined) return '';
  if (v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

function toStorable(v: number | string): string {
  return v === undefined || v === null ? '' : String(v);
}

function normTag(v: string | undefined | null): string {
  return (v ?? '').trim().toUpperCase();
}

function normGroup(v: string | undefined | null): string {
  const tag = normTag(v);
  return MUSCLE_GROUP_ALIASES[tag] ?? tag;
}

interface SessionRow {
  id: number;
  date: string;
  name: string;
  notes: string;
}

interface SessionExerciseRow {
  id: number;
  session_id: number;
  name: string;
  muscle_group: string;
  machine: string;
  notes: string;
  has_base_resistance: number;
  base_resistance: number | null;
  position: number;
}

interface SetRow {
  id: number;
  session_exercise_id: number;
  weight: string | null;
  reps: string | null;
  ws: number;
  position: number;
}

const SESSION_COLS = `id, date, name, notes`;
const EXERCISE_COLS = `id, session_id, name, muscle_group, machine, notes, has_base_resistance, base_resistance, position`;
const SET_COLS = `id, session_exercise_id, weight, reps, ws, position`;

function rowsToSets(rows: SetRow[]): SetEntry[] {
  return rows.map((r) => ({ weight: toNumOrStr(r.weight), reps: toNumOrStr(r.reps), ws: !!r.ws }));
}

function rowToExercise(row: SessionExerciseRow, sets: SetEntry[]): Exercise {
  return {
    name: row.name,
    muscleGroup: row.muscle_group,
    machine: row.machine,
    notes: row.notes,
    hasBaseResistance: !!row.has_base_resistance,
    baseResistance: row.base_resistance ?? undefined,
    sets,
  };
}

async function insertExercisesForSession(db: Db, sessionId: number, exercises: Exercise[]) {
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    const seResult = await db.runAsync(
      `INSERT INTO session_exercises (session_id, name, muscle_group, machine, notes, has_base_resistance, base_resistance, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      normTag(ex.name),
      normGroup(ex.muscleGroup),
      normTag(ex.machine),
      (ex.notes ?? '').trim(),
      ex.hasBaseResistance ? 1 : 0,
      ex.hasBaseResistance && ex.baseResistance !== undefined ? ex.baseResistance : null,
      i
    );
    const sessionExerciseId = seResult.lastInsertRowId;
    for (let j = 0; j < ex.sets.length; j++) {
      const s = ex.sets[j];
      await db.runAsync(
        `INSERT INTO sets (session_exercise_id, weight, reps, ws, position) VALUES (?, ?, ?, ?, ?)`,
        sessionExerciseId,
        toStorable(s.weight),
        toStorable(s.reps),
        s.ws ? 1 : 0,
        j
      );
    }
  }
}

export async function createSession(date: string, exercises: Exercise[], name: string = '', notes: string = ''): Promise<number> {
  const db = await getDb();
  let newId = -1;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(`INSERT INTO sessions (date, name, notes) VALUES (?, ?, ?)`, date, name.trim(), notes.trim());
    newId = result.lastInsertRowId;
    await insertExercisesForSession(db, newId, exercises);
  });
  return newId;
}

export async function updateSession(
  id: number,
  date: string,
  exercises: Exercise[],
  name: string = '',
  notes: string = ''
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE sessions SET date = ?, name = ?, notes = ? WHERE id = ?`, date, name.trim(), notes.trim(), id);
    await db.runAsync(`DELETE FROM session_exercises WHERE session_id = ?`, id);
    await insertExercisesForSession(db, id, exercises);
  });
}

export async function deleteSession(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM sessions WHERE id = ?`, id);
}

export interface SessionListItem {
  id: number;
  date: string;
  name: string;
  exerciseNames: string[];
  muscleGroups: string[];
  setCount: number;
  volume: number;
}

export async function getSessionsList(): Promise<SessionListItem[]> {
  const db = await getDb();
  const sessions = await db.getAllAsync<SessionRow>(`SELECT ${SESSION_COLS} FROM sessions ORDER BY date DESC, id DESC`);
  const exRows = await db.getAllAsync<{ session_id: number; name: string; muscle_group: string }>(
    `SELECT session_id, name, muscle_group FROM session_exercises ORDER BY session_id ASC, position ASC`
  );
  const setRows = await db.getAllAsync<{ session_id: number; weight: string | null; reps: string | null }>(
    `SELECT se.session_id, st.weight, st.reps
     FROM sets st JOIN session_exercises se ON se.id = st.session_exercise_id`
  );

  const bySession = new Map<number, SessionListItem>();
  for (const s of sessions) {
    bySession.set(s.id, { id: s.id, date: s.date, name: s.name, exerciseNames: [], muscleGroups: [], setCount: 0, volume: 0 });
  }
  for (const r of exRows) {
    const item = bySession.get(r.session_id);
    if (!item) continue;
    item.exerciseNames.push(r.name);
    if (r.muscle_group && !item.muscleGroups.includes(r.muscle_group)) item.muscleGroups.push(r.muscle_group);
  }
  for (const r of setRows) {
    const item = bySession.get(r.session_id);
    if (!item) continue;
    item.setCount += 1;
    const kg = weightToKg(r.weight);
    const reps = parseCount(r.reps);
    if (kg !== null && reps !== null && kg > 0 && reps > 0) item.volume += kg * reps;
  }
  return sessions.map((s) => bySession.get(s.id)!);
}

export async function getSessionDetail(id: number): Promise<Session | null> {
  const db = await getDb();
  const sessionRow = await db.getFirstAsync<SessionRow>(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`, id);
  if (!sessionRow) return null;
  const exerciseRows = await db.getAllAsync<SessionExerciseRow>(
    `SELECT ${EXERCISE_COLS} FROM session_exercises WHERE session_id = ? ORDER BY position ASC`,
    id
  );
  const exercises: Exercise[] = [];
  for (const exRow of exerciseRows) {
    const setRows = await db.getAllAsync<SetRow>(
      `SELECT ${SET_COLS} FROM sets WHERE session_exercise_id = ? ORDER BY position ASC`,
      exRow.id
    );
    exercises.push(rowToExercise(exRow, rowsToSets(setRows)));
  }
  return { id: sessionRow.id, date: sessionRow.date, name: sessionRow.name, notes: sessionRow.notes, exercises };
}

export async function getAllExerciseNames(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name, MAX(id) as maxId FROM session_exercises GROUP BY name COLLATE NOCASE ORDER BY name COLLATE NOCASE ASC`
  );
  return rows.map((r) => r.name);
}

/** Every exercise ever logged, with its most recent muscle group and the machines it has been done on (newest first). */
export async function getExerciseCatalog(): Promise<ExerciseCatalogEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string; muscle_group: string; machine: string }>(
    `SELECT se.name, se.muscle_group, se.machine
     FROM session_exercises se JOIN sessions s ON s.id = se.session_id
     ORDER BY s.date DESC, se.id DESC`
  );
  const byName = new Map<string, ExerciseCatalogEntry>();
  for (const r of rows) {
    const key = r.name.toUpperCase();
    let entry = byName.get(key);
    if (!entry) {
      entry = { name: r.name, muscleGroup: '', machines: [] };
      byName.set(key, entry);
    }
    if (!entry.muscleGroup && r.muscle_group) entry.muscleGroup = r.muscle_group;
    if (r.machine && !entry.machines.includes(r.machine)) entry.machines.push(r.machine);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAllMachines(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ machine: string }>(
    `SELECT DISTINCT machine FROM session_exercises WHERE machine <> '' ORDER BY machine ASC`
  );
  return rows.map((r) => r.machine);
}

export async function getRecentSessionNames(limit: number = 40): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name, MAX(date) as d FROM sessions WHERE name <> '' GROUP BY name COLLATE NOCASE ORDER BY d DESC, name ASC LIMIT ?`,
    limit
  );
  return rows.map((r) => r.name);
}

/**
 * Most recent use of an exercise. When `machine` is given, only a use on that exact
 * machine counts (so the caller can decide whether to re-fill weights for it).
 */
export async function getLastUseForExercise(name: string, machine?: string): Promise<ExerciseLastUse | null> {
  const db = await getDb();
  const base = `SELECT se.${EXERCISE_COLS.replace(/, /g, ', se.')}, s.date
     FROM session_exercises se JOIN sessions s ON s.id = se.session_id
     WHERE se.name = ? COLLATE NOCASE`;
  const exRow =
    machine === undefined
      ? await db.getFirstAsync<SessionExerciseRow & { date: string }>(`${base} ORDER BY s.date DESC, se.id DESC LIMIT 1`, name)
      : await db.getFirstAsync<SessionExerciseRow & { date: string }>(
          `${base} AND se.machine = ? COLLATE NOCASE ORDER BY s.date DESC, se.id DESC LIMIT 1`,
          name,
          normTag(machine)
        );
  if (!exRow) return null;
  const setRow = await db.getFirstAsync<SetRow>(
    `SELECT ${SET_COLS} FROM sets WHERE session_exercise_id = ? ORDER BY position ASC LIMIT 1`,
    exRow.id
  );
  // The newest use may have no note, so look back for the latest one that does.
  const noteRow = await db.getFirstAsync<{ notes: string }>(
    `SELECT se.notes FROM session_exercises se JOIN sessions s ON s.id = se.session_id
     WHERE se.name = ? COLLATE NOCASE AND se.notes <> ''${machine === undefined ? '' : ' AND se.machine = ? COLLATE NOCASE'}
     ORDER BY s.date DESC, se.id DESC LIMIT 1`,
    ...(machine === undefined ? [name] : [name, normTag(machine)])
  );
  return {
    name: exRow.name,
    muscleGroup: exRow.muscle_group,
    machine: exRow.machine,
    hasBaseResistance: !!exRow.has_base_resistance,
    baseResistance: exRow.base_resistance ?? undefined,
    lastWeight: setRow ? toNumOrStr(setRow.weight) : '',
    lastReps: setRow ? toNumOrStr(setRow.reps) : '',
    lastNote: noteRow?.notes ?? '',
  };
}

export interface ProgressPoint {
  sessionId: number;
  date: string;
  sessionName: string;
  machine: string;
  effectiveWeight: number;
  reps: number | string;
  /** Every set that day in order, so a 100×8 top set can be read next to a 100×4 second set. */
  sets: SetEntry[];
}

/** Best effective weight (kg) per session for an exercise, oldest first, across every machine. */
export async function getProgressForExercise(name: string): Promise<ProgressPoint[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SessionExerciseRow & { date: string; session_name: string }>(
    `SELECT se.${EXERCISE_COLS.replace(/, /g, ', se.')}, s.date, s.name AS session_name
     FROM session_exercises se JOIN sessions s ON s.id = se.session_id
     WHERE se.name = ? COLLATE NOCASE
     ORDER BY s.date ASC, se.id ASC`,
    name
  );
  const points: ProgressPoint[] = [];
  for (const row of rows) {
    const setRows = await db.getAllAsync<SetRow>(
      `SELECT ${SET_COLS} FROM sets WHERE session_exercise_id = ? ORDER BY position ASC`,
      row.id
    );
    const base = row.has_base_resistance ? row.base_resistance ?? 0 : 0;
    let best: { effectiveWeight: number; reps: number | string } | null = null;
    for (const sr of setRows) {
      const kg = weightToKg(sr.weight);
      if (kg === null) continue;
      const effective = base + kg;
      if (!best || effective > best.effectiveWeight) {
        best = { effectiveWeight: effective, reps: toNumOrStr(sr.reps) };
      }
    }
    if (best) {
      points.push({
        sessionId: row.session_id,
        date: row.date,
        sessionName: row.session_name,
        machine: row.machine,
        ...best,
        sets: rowsToSets(setRows),
      });
    }
  }
  return points;
}

export interface NewPR {
  name: string;
  machine: string;
  effectiveWeight: number;
  previousBest: number;
}

/** Call BEFORE saving: which of these exercises beat their stored best on the same machine? */
export async function findNewPRs(exercises: Exercise[]): Promise<NewPR[]> {
  const prs: NewPR[] = [];
  for (const ex of exercises) {
    const best = bestEffectiveWeight(ex);
    if (best === null) continue;
    const machine = normTag(ex.machine);
    const prior = (await getProgressForExercise(ex.name)).filter((p) => p.machine === machine);
    if (prior.length === 0) continue;
    const previousBest = Math.max(...prior.map((p) => p.effectiveWeight));
    if (best > previousBest) prs.push({ name: normTag(ex.name), machine, effectiveWeight: best, previousBest });
  }
  return prs;
}

function formatTopSet(ex: Exercise): string {
  let bestSet: SetEntry | null = null;
  let bestKg: number | null = null;
  for (const s of ex.sets) {
    const kg = weightToKg(s.weight);
    if (kg === null) continue;
    if (bestKg === null || kg > bestKg) {
      bestKg = kg;
      bestSet = s;
    }
  }
  const chosen = bestSet ?? ex.sets[0];
  if (!chosen) return '—';
  return `${chosen.weight} × ${chosen.reps}`;
}

/** Everything the summary/share card needs for one session, including which lifts were PRs that day. */
export async function getSessionSummary(sessionId: number): Promise<SessionSummary | null> {
  const session = await getSessionDetail(sessionId);
  if (!session) return null;

  const exercises: SummaryExercise[] = [];
  let prCount = 0;
  for (const ex of session.exercises) {
    const machine = normTag(ex.machine);
    const best = bestEffectiveWeight(ex);
    let isPR = false;
    let prDelta: number | null = null;
    if (best !== null) {
      const earlier = (await getProgressForExercise(ex.name)).filter(
        (p) =>
          p.machine === machine &&
          p.sessionId !== sessionId &&
          (p.date < session.date || (p.date === session.date && p.sessionId < sessionId))
      );
      if (earlier.length > 0) {
        const previousBest = Math.max(...earlier.map((p) => p.effectiveWeight));
        if (best > previousBest) {
          isPR = true;
          prDelta = best - previousBest;
          prCount += 1;
        }
      }
    }
    exercises.push({
      name: ex.name,
      machine,
      muscleGroup: normTag(ex.muscleGroup),
      setCount: ex.sets.length,
      topSet: formatTopSet(ex),
      bestWeight: best,
      volume: exerciseVolume(ex),
      isPR,
      prDelta,
    });
  }

  const muscleGroups: string[] = [];
  for (const ex of exercises) {
    if (ex.muscleGroup && !muscleGroups.includes(ex.muscleGroup)) muscleGroups.push(ex.muscleGroup);
  }

  return {
    id: session.id,
    date: session.date,
    name: session.name ?? '',
    exerciseCount: session.exercises.length,
    setCount: countSets(session.exercises),
    workingSets: session.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.ws).length, 0),
    volume: sessionVolume(session.exercises),
    muscleGroups,
    exercises,
    prCount,
  };
}

/** Sets and sessions per training day, for the calendar heatmap. */
async function dailyActivity(db: Db): Promise<DayActivity[]> {
  return db.getAllAsync<DayActivity>(
    `SELECT s.date AS date, COUNT(st.id) AS sets, COUNT(DISTINCT s.id) AS sessions
     FROM sessions s
     LEFT JOIN session_exercises se ON se.session_id = s.id
     LEFT JOIN sets st ON st.session_exercise_id = se.id
     GROUP BY s.date
     ORDER BY s.date ASC`
  );
}

async function setsByMuscleGroup(db: Db, sinceDate?: string): Promise<MuscleGroupSets[]> {
  const where = sinceDate ? `WHERE s.date >= ?` : ``;
  const rows = await db.getAllAsync<{ muscleGroup: string; sets: number }>(
    `SELECT se.muscle_group AS muscleGroup, COUNT(st.id) AS sets
     FROM sets st
     JOIN session_exercises se ON se.id = st.session_exercise_id
     JOIN sessions s ON s.id = se.session_id
     ${where}
     GROUP BY se.muscle_group
     ORDER BY sets DESC, muscleGroup ASC`,
    ...(sinceDate ? [sinceDate] : [])
  );
  return rows;
}

export async function getStats(): Promise<StatsSummary> {
  const db = await getDb();

  const totalSessionsRow = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM sessions`);
  const totalSessions = totalSessionsRow?.c ?? 0;

  const distinctExercisesRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(DISTINCT name COLLATE NOCASE) as c FROM session_exercises`
  );
  const distinctExercises = distinctExercisesRow?.c ?? 0;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = dateToString(sevenDaysAgo);
  const last7Row = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM sessions WHERE date >= ?`, sevenDaysAgoStr);
  const sessionsLast7Days = last7Row?.c ?? 0;

  const firstSessionRow = await db.getFirstAsync<{ date: string }>(`SELECT date FROM sessions ORDER BY date ASC LIMIT 1`);
  let weeksSinceFirstSession = 0;
  if (firstSessionRow) {
    const first = parseDateString(firstSessionRow.date);
    const diffMs = Date.now() - first.getTime();
    weeksSinceFirstSession = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7)));
  }

  const mostTrainedRow = await db.getFirstAsync<{ name: string; sessionCount: number }>(
    `SELECT name, COUNT(DISTINCT session_id) as sessionCount
     FROM session_exercises
     GROUP BY name COLLATE NOCASE
     ORDER BY sessionCount DESC, name ASC
     LIMIT 1`
  );
  const mostTrainedExercise = mostTrainedRow ? { name: mostTrainedRow.name, sessionCount: mostTrainedRow.sessionCount } : null;

  const personalBests: PersonalBest[] = [];
  for (const name of await getAllExerciseNames()) {
    const byMachine = new Map<string, ProgressPoint>();
    for (const p of await getProgressForExercise(name)) {
      const current = byMachine.get(p.machine);
      if (!current || p.effectiveWeight > current.effectiveWeight) byMachine.set(p.machine, p);
    }
    for (const [machine, best] of byMachine) {
      personalBests.push({ exerciseName: name, machine, effectiveWeight: best.effectiveWeight, reps: best.reps, date: best.date });
    }
  }
  personalBests.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName) || a.machine.localeCompare(b.machine));

  return {
    totalSessions,
    distinctExercises,
    sessionsLast7Days,
    weeksSinceFirstSession,
    mostTrainedExercise,
    personalBests,
    setsByMuscleGroupLast7Days: await setsByMuscleGroup(db, sevenDaysAgoStr),
    setsByMuscleGroupAllTime: await setsByMuscleGroup(db),
    activity: await dailyActivity(db),
  };
}

export async function exportAllSessions(): Promise<Session[]> {
  const db = await getDb();
  const sessions = await db.getAllAsync<SessionRow>(`SELECT ${SESSION_COLS} FROM sessions ORDER BY date ASC, id ASC`);
  const result: Session[] = [];
  for (const s of sessions) {
    const detail = await getSessionDetail(s.id);
    if (detail) result.push(detail);
  }
  return result;
}

async function insertSessions(db: Db, sessions: Omit<Session, 'id'>[]) {
  for (const s of sessions) {
    const result = await db.runAsync(
      `INSERT INTO sessions (date, name, notes) VALUES (?, ?, ?)`,
      s.date,
      (s.name ?? '').trim(),
      (s.notes ?? '').trim()
    );
    await insertExercisesForSession(db, result.lastInsertRowId, s.exercises);
  }
}

export async function replaceAllData(sessions: Omit<Session, 'id'>[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM sessions`);
    await insertSessions(db, sessions);
  });
}

export async function mergeData(sessions: Omit<Session, 'id'>[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await insertSessions(db, sessions);
  });
}

export async function getSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM settings WHERE key = ?`, key);
}
