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
export interface Progress {
  learnerId: string; name: string; scenarioId: string; title: string;
  checks: CheckProgress[]; done: boolean; hints: number; updatedOn: string;
}

// No letters that look alike (I and 1, O and 0).
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
const LEARNER_ID = /^[0-9a-f]{32}$/;
const SCENARIO_ID = /^[\w-]{1,100}$/;

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

  async report(code: string, body: any): Promise<void> {
    const c = await this.find(code);
    if (!isLearnerId(body?.learnerId)) throw new AiError("Not a valid learner.", 400);
    this.mustBeOpen(c);
    if (c.removed?.includes(body.learnerId)) throw new AiError("Your trainer removed you from this class, so your progress isn't sent any more.", 403);
    const scenarioId = String(body?.scenarioId ?? "");
    if (!SCENARIO_ID.test(scenarioId)) throw new AiError("Not a valid exercise.", 400);
    const checks = Array.isArray(body?.checks) ? body.checks.slice(0, 30).map((x: any) => ({ title: text(x?.title, "A check", 200), passed: x?.passed === true })) : [];
    const p: Progress = {
      learnerId: body.learnerId, name: text(body?.name, "Your name", 40), scenarioId, title: text(body?.title, "The exercise title", 100),
      checks, done: body?.done === true, hints: Math.max(0, Math.min(99, Number(body?.hints) || 0)), updatedOn: new Date().toISOString()
    };
    await this.store.put(`progress:${c.code}`, `${p.learnerId}:${scenarioId}`, p);
  }

  async progress(code: string, who: Who): Promise<{ class: ClassView; progress: Progress[] }> {
    const c = await this.asTrainer(code, who);
    const rows = await this.store.list<Progress>(`progress:${c.code}`);
    return { class: view(c), progress: rows.map((r) => r.value).sort((a, b) => a.name.localeCompare(b.name)) };
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
    c.removed = [...new Set([...(c.removed ?? []), learnerId])];
    await this.store.put("class", c.code, c);
  }

  // The class and all its progress, for good.
  async delete(code: string, who: Who): Promise<void> {
    const c = await this.asTrainer(code, who);
    for (const row of await this.store.list<Progress>(`progress:${c.code}`)) await this.store.remove(`progress:${c.code}`, row.key);
    await this.store.remove("class", c.code);
  }

  // The signed-in trainer's classes, newest first.
  async ownedBy(owner: string): Promise<ClassSummary[]> {
    const mine = (await this.store.list<ClassRecord>("class")).map((r) => r.value).filter((c) => c.owner === owner);
    return Promise.all(mine.sort((a, b) => b.createdOn.localeCompare(a.createdOn)).map(async (c) => ({
      ...view(c), createdOn: c.createdOn,
      learners: new Set((await this.store.list<Progress>(`progress:${c.code}`)).map((r) => r.value.learnerId)).size
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
