// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { randomBytes, randomInt } from "crypto";
import { KvStore } from "./kv";
import { AiError } from "./ai/provider";

// Classes (manual 10, decision 15.5): a trainer creates a class and gets a code to hand out and a key of
// their own; learners join with the code and a display name. Nothing else about a learner is kept: their id
// is random, made in their browser. The key is needed to see the class's progress.

export interface ClassRecord { code: string; name: string; scenarios: string[]; trainerKey: string; createdOn: string }
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

export class Classes {
  constructor(private readonly store: KvStore) {}

  async create(name: unknown, scenarios: unknown): Promise<{ code: string; trainerKey: string }> {
    const list = Array.isArray(scenarios) ? scenarios.map(String) : [];
    if (!list.length || list.length > 20 || list.some((s) => !SCENARIO_ID.test(s))) throw new AiError("Pick 1 to 20 exercises for the class.", 400);
    let code = newCode();
    while (await this.store.get("class", code)) code = newCode();
    const record: ClassRecord = { code, name: text(name, "The class name", 60), scenarios: [...new Set(list)], trainerKey: randomBytes(16).toString("hex"), createdOn: new Date().toISOString() };
    await this.store.put("class", code, record);
    return { code, trainerKey: record.trainerKey };
  }

  // What a learner may see: the name and the exercises, not the key.
  async get(code: string): Promise<{ code: string; name: string; scenarios: string[] }> {
    const c = await this.find(code);
    return { code: c.code, name: c.name, scenarios: c.scenarios };
  }

  async report(code: string, body: any): Promise<void> {
    const c = await this.find(code);
    if (!isLearnerId(body?.learnerId)) throw new AiError("Not a valid learner.", 400);
    const scenarioId = String(body?.scenarioId ?? "");
    if (!SCENARIO_ID.test(scenarioId)) throw new AiError("Not a valid exercise.", 400);
    const checks = Array.isArray(body?.checks) ? body.checks.slice(0, 30).map((x: any) => ({ title: text(x?.title, "A check", 200), passed: x?.passed === true })) : [];
    const p: Progress = {
      learnerId: body.learnerId, name: text(body?.name, "Your name", 40), scenarioId, title: text(body?.title, "The exercise title", 100),
      checks, done: body?.done === true, hints: Math.max(0, Math.min(99, Number(body?.hints) || 0)), updatedOn: new Date().toISOString()
    };
    await this.store.put(`progress:${c.code}`, `${p.learnerId}:${scenarioId}`, p);
  }

  async progress(code: string, key: unknown): Promise<{ class: { code: string; name: string; scenarios: string[] }; progress: Progress[] }> {
    const c = await this.find(code);
    if (typeof key !== "string" || key !== c.trainerKey) throw new AiError("This isn't the trainer's link for the class.", 403);
    const rows = await this.store.list<Progress>(`progress:${c.code}`);
    return { class: { code: c.code, name: c.name, scenarios: c.scenarios }, progress: rows.map((r) => r.value).sort((a, b) => a.name.localeCompare(b.name)) };
  }

  private async find(code: string): Promise<ClassRecord> {
    const clean = String(code ?? "").toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(clean)) throw new AiError("A class code has 6 letters and digits.", 400);
    const c = await this.store.get<ClassRecord>("class", clean);
    if (!c) throw new AiError(`There's no class with the code ${clean}.`, 404);
    return c;
  }
}
