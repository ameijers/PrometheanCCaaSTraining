// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { randomBytes, randomInt, timingSafeEqual } from "crypto";
import { KvStore } from "./kv";
import { AiError } from "./ai/provider";

// Classes (manual 10, decision 15.5): a trainer creates a class and gets a code to hand out and a key of
// their own; learners join with the code and a display name. Nothing else about a learner is kept: their id
// is random, made in their browser. The key is needed to see the class's progress and to manage the class:
// set an end date, close or reopen it, remove a learner, or delete it. A class that ended or was closed takes
// no new learners and no progress; its trainer still sees what was done.
//
// A trainer who signs in (docs/classroom.md) owns the classes they create, or add with their trainer link,
// and manages them without the key. Only the Static Web Apps user id is kept with the class, no name or email.
//
// A learner who joins gets a personal code. With it they carry on in another browser as the same learner:
// the browser takes over their learner id. Their work on the class's exercises (the environment, answers and
// hints, compressed by the browser) is kept here too, so any browser carries on where they left off.

export interface ClassRecord {
  code: string; name: string; scenarios: string[]; trainerKey: string; createdOn: string;
  // The last day learners can work in the class (YYYY-MM-DD, the end of that day in UTC), if set.
  openUntil?: string;
  closed?: boolean;
  // Learners the trainer removed: their progress is gone and they can't report any more.
  removed?: string[];
  // The signed-in trainer who owns the class: their Static Web Apps user id.
  owner?: string;
}
// Who may manage a class: whoever has its trainer key, or its owner.
export type Who = { key: unknown } | { owner: string };
// A class in the trainer's list.
export interface ClassSummary extends ClassView { createdOn: string; learners: number }
// What the trainer's page shows about the class.
export interface ClassView { code: string; name: string; scenarios: string[]; openUntil?: string; closed: boolean; open: boolean }
export interface CheckProgress { title: string; passed: boolean }
// Someone who joined the class, whether or not they've started an exercise.
export interface Member { learnerId: string; name: string; joinedOn: string; rejoinCode?: string }
// What a learner gets back when they join or rejoin: who they are in the class, and what they finished.
export interface Joined { code: string; name: string; scenarios: string[]; you: { learnerId: string; name: string; rejoinCode: string; done: string[] } }
// A learner's saved work on one exercise: gzip-compressed JSON, in Base64, as the browser sent it.
export interface Work { data: string; savedOn: string }
const WORK_MAX = 30_000; // characters: Table Storage keeps up to 64 KiB of text in one column
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// Where a learner is in a lab: pages read and the quiz (Learn), tasks (Do), exercises (Challenge).
export interface LabParts {
  learn?: { read: number; pages: number; done: boolean };
  do?: { passed: number; tasks: number; done: boolean };
  challenge?: { done: number; of: number };
}
export interface Progress {
  learnerId: string; name: string; scenarioId: string; title: string;
  checks: CheckProgress[]; done: boolean; hints: number; updatedOn: string;
  // Labs only: each part's progress.
  parts?: LabParts;
  // What the learner is on now, and since when (for "may be stuck").
  current?: { title: string; since: string };
}

// No letters that look alike (I and 1, O and 0).
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
const LEARNER_ID = /^[0-9a-f]{32}$/;
const SCENARIO_ID = /^[\w-]{1,100}$/;

// Counts a learner's browser sends: whole numbers from 0 to 99.
const count = (value: unknown) => Math.max(0, Math.min(99, Math.floor(Number(value) || 0)));
function labParts(parts: any): { parts?: LabParts } {
  if (!parts || typeof parts !== "object") return {};
  const out: LabParts = {};
  if (parts.learn) out.learn = { read: count(parts.learn.read), pages: count(parts.learn.pages), done: parts.learn.done === true };
  if (parts.do) out.do = { passed: count(parts.do.passed), tasks: count(parts.do.tasks), done: parts.do.done === true };
  if (parts.challenge) out.challenge = { done: count(parts.challenge.done), of: count(parts.challenge.of) };
  return Object.keys(out).length ? { parts: out } : {};
}
// What they're on now; "since" can't be in the future or more than a week back.
function currentOf(current: any, now: Date): { current?: { title: string; since: string } } {
  const title = String(current?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return {};
  const since = Date.parse(String(current?.since ?? ""));
  const ok = Number.isFinite(since) && since <= now.getTime() && since > now.getTime() - 7 * 86_400_000;
  return { current: { title, since: new Date(ok ? since : now.getTime()).toISOString() } };
}

const text = (value: unknown, what: string, max: number): string => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > max) throw new AiError(`${what} must be 1 to ${max} characters.`, 400);
  return s;
};

export const isLearnerId = (id: unknown): id is string => typeof id === "string" && LEARNER_ID.test(id);

// Compares secrets (the trainer's key, the passcode) in constant time.
export function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function endDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const day = String(value);
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new AiError("The end date must be a date like 2026-12-31.", 400);
  return day;
}
const isOpen = (c: ClassRecord, now = new Date()) => !c.closed && (!c.openUntil || now.toISOString().slice(0, 10) <= c.openUntil);
const view = (c: ClassRecord): ClassView => ({ code: c.code, name: c.name, scenarios: c.scenarios, ...(c.openUntil ? { openUntil: c.openUntil } : {}), closed: !!c.closed, open: isOpen(c) });

export class Classes {
  constructor(private readonly store: KvStore) {}

  async create(name: unknown, scenarios: unknown, openUntil?: unknown, owner?: string): Promise<{ code: string; trainerKey: string }> {
    const list = Array.isArray(scenarios) ? scenarios.map(String) : [];
    if (!list.length || list.length > 20 || list.some((s) => !SCENARIO_ID.test(s))) throw new AiError("Pick 1 to 20 exercises for the class.", 400);
    let code = newCode();
    while (await this.store.get("class", code)) code = newCode();
    const record: ClassRecord = { code, name: text(name, "The class name", 60), scenarios: [...new Set(list)], trainerKey: randomBytes(16).toString("hex"), createdOn: new Date().toISOString() };
    const until = endDate(openUntil);
    if (until) record.openUntil = until;
    if (owner) record.owner = owner;
    await this.store.put("class", code, record);
    return { code, trainerKey: record.trainerKey };
  }

  // What a learner may see: the name and the exercises, not the key. Only while the class is open.
  async get(code: string): Promise<{ code: string; name: string; scenarios: string[] }> {
    const c = await this.find(code);
    this.mustBeOpen(c);
    return { code: c.code, name: c.name, scenarios: c.scenarios };
  }

  // A learner joins: the trainer sees them straight away, before they start an exercise. Joining again
  // (each time the page opens) keeps the same personal code.
  async join(code: string, body: any): Promise<Joined> {
    const c = await this.find(code);
    if (!isLearnerId(body?.learnerId)) throw new AiError("Not a valid learner.", 400);
    this.mustBeOpen(c);
    if (c.removed?.includes(body.learnerId)) throw new AiError("Your trainer removed you from this class.", 403);
    return this.joined(c, await this.remember(c.code, body.learnerId, text(body?.name, "Your name", 40)));
  }

  // The same learner in another browser, with their personal code: the browser takes over their learner id.
  async rejoin(code: string, rejoinCode: unknown): Promise<Joined> {
    const c = await this.find(code);
    this.mustBeOpen(c);
    const clean = String(rejoinCode ?? "").trim().toUpperCase();
    const index = /^[A-Z2-9]{6}$/.test(clean) ? await this.store.get<{ learnerId: string }>(`rejoin:${c.code}`, clean) : undefined;
    const member = index && await this.store.get<Member>(`members:${c.code}`, index.learnerId);
    if (!member) throw new AiError(`That isn't a personal code in the class ${c.name}. It's under Class in the header of the browser you joined with; your trainer can see it too.`, 404);
    if (c.removed?.includes(member.learnerId)) throw new AiError("Your trainer removed you from this class.", 403);
    return this.joined(c, member);
  }

  private async joined(c: ClassRecord, m: Member): Promise<Joined> {
    const done = (await this.store.list<Progress>(`progress:${c.code}`)).map((r) => r.value).filter((p) => p.learnerId === m.learnerId && p.done).map((p) => p.scenarioId);
    return { code: c.code, name: c.name, scenarios: c.scenarios, you: { learnerId: m.learnerId, name: m.name, rejoinCode: m.rejoinCode!, done } };
  }

  // Records the learner, with a personal code that's unique in the class.
  private async remember(code: string, learnerId: string, name: string): Promise<Member> {
    const known = await this.store.get<Member>(`members:${code}`, learnerId);
    if (known?.name === name && known.rejoinCode) return known;
    let rejoinCode = known?.rejoinCode;
    if (!rejoinCode) {
      do rejoinCode = newCode(); while (await this.store.get(`rejoin:${code}`, rejoinCode));
      await this.store.put(`rejoin:${code}`, rejoinCode, { learnerId });
    }
    const member: Member = { learnerId, name, joinedOn: known?.joinedOn ?? new Date().toISOString(), rejoinCode };
    await this.store.put(`members:${code}`, learnerId, member);
    return member;
  }

  // The learner's work on one of the class's exercises: saved as it changes, read in any browser.
  async saveWork(code: string, learnerId: unknown, scenarioId: unknown, data: unknown): Promise<void> {
    const { c, id } = await this.asMember(code, learnerId);
    this.mustBeOpen(c);
    const sid = this.classExercise(c, scenarioId);
    if (typeof data !== "string" || data.length > WORK_MAX || !BASE64.test(data)) throw new AiError("The saved work is too large or not readable, so it's kept in this browser only.", 400);
    await this.store.put(`work:${c.code}`, `${id}:${sid}`, { data, savedOn: new Date().toISOString() } satisfies Work);
  }

  async work(code: string, learnerId: unknown, scenarioId: unknown): Promise<{ work: Work | null }> {
    const { c, id } = await this.asMember(code, learnerId);
    return { work: (await this.store.get<Work>(`work:${c.code}`, `${id}:${this.classExercise(c, scenarioId)}`)) ?? null };
  }

  private async asMember(code: string, learnerId: unknown): Promise<{ c: ClassRecord; id: string }> {
    const c = await this.find(code);
    if (!isLearnerId(learnerId)) throw new AiError("Not a valid learner.", 400);
    if (c.removed?.includes(learnerId)) throw new AiError("Your trainer removed you from this class.", 403);
    if (!(await this.store.get<Member>(`members:${c.code}`, learnerId))) throw new AiError("Join the class first.", 403);
    return { c, id: learnerId };
  }

  private classExercise(c: ClassRecord, scenarioId: unknown): string {
    const id = String(scenarioId ?? "");
    if (!c.scenarios.includes(id)) throw new AiError("That exercise isn't part of the class.", 400);
    return id;
  }

  async report(code: string, body: any): Promise<void> {
    const c = await this.find(code);
    if (!isLearnerId(body?.learnerId)) throw new AiError("Not a valid learner.", 400);
    this.mustBeOpen(c);
    if (c.removed?.includes(body.learnerId)) throw new AiError("Your trainer removed you from this class, so your progress isn't sent any more.", 403);
    const scenarioId = String(body?.scenarioId ?? "");
    if (!SCENARIO_ID.test(scenarioId)) throw new AiError("Not a valid exercise.", 400);
    const checks = Array.isArray(body?.checks) ? body.checks.slice(0, 30).map((x: any) => ({ title: text(x?.title, "A check", 200), passed: x?.passed === true })) : [];
    const now = new Date();
    const p: Progress = {
      learnerId: body.learnerId, name: text(body?.name, "Your name", 40), scenarioId, title: text(body?.title, "The exercise title", 100),
      checks, done: body?.done === true, hints: Math.max(0, Math.min(99, Number(body?.hints) || 0)), updatedOn: now.toISOString(),
      ...labParts(body?.parts), ...currentOf(body?.current, now)
    };
    await this.store.put(`progress:${c.code}`, `${p.learnerId}:${scenarioId}`, p);
    // Learners who joined before joining was recorded show up once they report.
    await this.remember(c.code, p.learnerId, p.name);
  }

  async progress(code: string, who: Who): Promise<{ class: ClassView; members: Member[]; progress: Progress[] }> {
    const c = await this.asTrainer(code, who);
    const rows = await this.store.list<Progress>(`progress:${c.code}`);
    return { class: view(c), members: await this.members(c.code), progress: rows.map((r) => r.value).sort((a, b) => a.name.localeCompare(b.name)) };
  }

  private async members(code: string): Promise<Member[]> {
    return (await this.store.list<Member>(`members:${code}`)).map((r) => r.value).sort((a, b) => a.name.localeCompare(b.name));
  }

  // The trainer's changes: an end date (empty removes it), and closing or reopening the class.
  async update(code: string, who: Who, changes: { openUntil?: unknown; closed?: unknown }): Promise<ClassView> {
    const c = await this.asTrainer(code, who);
    if ("openUntil" in changes) {
      const until = endDate(changes.openUntil);
      if (until) c.openUntil = until; else delete c.openUntil;
    }
    if (typeof changes.closed === "boolean") c.closed = changes.closed;
    await this.store.put("class", c.code, c);
    return view(c);
  }

  // Takes a learner out: their progress goes, and they can't report again.
  async removeLearner(code: string, who: Who, learnerId: unknown): Promise<void> {
    const c = await this.asTrainer(code, who);
    if (!isLearnerId(learnerId)) throw new AiError("Not a valid learner.", 400);
    for (const row of await this.store.list<Progress>(`progress:${c.code}`)) {
      if (row.value.learnerId === learnerId) await this.store.remove(`progress:${c.code}`, row.key);
    }
    const member = await this.store.get<Member>(`members:${c.code}`, learnerId);
    if (member?.rejoinCode) await this.store.remove(`rejoin:${c.code}`, member.rejoinCode);
    await this.store.remove(`members:${c.code}`, learnerId);
    for (const row of await this.store.list<Work>(`work:${c.code}`)) if (row.key.startsWith(`${learnerId}:`)) await this.store.remove(`work:${c.code}`, row.key);
    c.removed = [...new Set([...(c.removed ?? []), learnerId])];
    await this.store.put("class", c.code, c);
  }

  // The class and all its progress, for good.
  async delete(code: string, who: Who): Promise<void> {
    const c = await this.asTrainer(code, who);
    for (const row of await this.store.list<Progress>(`progress:${c.code}`)) await this.store.remove(`progress:${c.code}`, row.key);
    for (const part of ["members", "rejoin", "work"]) for (const row of await this.store.list(`${part}:${c.code}`)) await this.store.remove(`${part}:${c.code}`, row.key);
    await this.store.remove("class", c.code);
  }

  // The signed-in trainer's classes, newest first.
  async ownedBy(owner: string): Promise<ClassSummary[]> {
    const mine = (await this.store.list<ClassRecord>("class")).map((r) => r.value).filter((c) => c.owner === owner);
    return Promise.all(mine.sort((a, b) => b.createdOn.localeCompare(a.createdOn)).map(async (c) => ({
      ...view(c), createdOn: c.createdOn,
      learners: (await this.members(c.code)).length
    })));
  }

  // A class made with a trainer link becomes the signed-in trainer's, if nobody else owns it yet.
  async claim(code: string, key: unknown, owner: string): Promise<ClassView> {
    const c = await this.asTrainer(code, { key });
    if (c.owner && c.owner !== owner) throw new AiError("Another trainer already has this class in their list.", 409);
    c.owner = owner;
    await this.store.put("class", c.code, c);
    return view(c);
  }

  private async asTrainer(code: string, who: Who): Promise<ClassRecord> {
    const c = await this.find(code);
    if ("owner" in who) {
      if (!c.owner || c.owner !== who.owner) throw new AiError("This class isn't in your list. Add it with its trainer link.", 403);
    } else if (!sameSecret(who.key, c.trainerKey)) throw new AiError("This isn't the trainer's link for the class.", 403);
    return c;
  }

  private mustBeOpen(c: ClassRecord): void {
    if (c.closed) throw new AiError(`The class ${c.name} is closed. Ask your trainer.`, 410);
    if (!isOpen(c)) throw new AiError(`The class ${c.name} ended on ${c.openUntil}. Ask your trainer.`, 410);
  }

  private async find(code: string): Promise<ClassRecord> {
    const clean = String(code ?? "").toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(clean)) throw new AiError("A class code has 6 letters and digits.", 400);
    const c = await this.store.get<ClassRecord>("class", clean);
    if (!c) throw new AiError(`There's no class with the code ${clean}.`, 404);
    return c;
  }
}
