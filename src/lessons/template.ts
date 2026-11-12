// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseDecisionXml } from "@toolbox/visual-routing-tester/src/ruleXml";
import { routeToQueueRuleset } from "../admin/actions";
import { simpleRule } from "../admin/rules";
import { Store } from "../simulator/store";
import { closeName, Ivr, Lesson } from "./checks";

// Lessons as templates (manual 9.4b): a lesson describes a pattern; each run picks its details from the
// simulated environment and fills in the template's {placeholders}. The checks are filled in the same
// way, so every variant is checked by code. tests/lessons/variants.test.ts plays every variant through.

// pick.choices: the new menu choices that fit a kind of line, keyed by a word in the workstream's name ("*" for any other line).
export type LessonTemplate = Omit<Lesson, "line" | "variant"> & { pick: { choices: Record<string, string[]> }; about?: string };

// A phone line a "new menu choice" lesson can use: a voice workstream with an IVR bot, a context variable
// the IVR fills, a phone number, a fallback queue, and at least two simple route-to-queue rules (the menu).
export interface Line {
  workstreamId: string;
  workstream: string;
  dial: string;
  variable: string;
  menu: { label: string; value: string; queueId: string }[];
  fallback: string;
}

const VOICE = 192440000;

export function linesWithIvr(store: Store): Line[] {
  const lines: Line[] = [];
  for (const ws of store.table("msdyn_liveworkstream")) {
    if (ws.msdyn_streamsource !== VOICE || ws.statecode !== 0 || !ws._msdyn_bot_user_value || !ws._msdyn_defaultqueue_value) continue;
    const channel = store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid && c._msdyn_phonenumberid_value);
    const number = channel && store.find("msdyn_ocphonenumber", channel._msdyn_phonenumberid_value);
    const ruleset = routeToQueueRuleset(store, ws.msdyn_liveworkstreamid);
    const rules = (ruleset ? parseDecisionXml(ruleset.msdyn_rulesetdefinition)?.rules ?? [] : []).map(simpleRule).filter(Boolean);
    const variable = rules[0]?.variable;
    const known = new Set(store.table("msdyn_ocliveworkstreamcontextvariable").filter((v) => v._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid).map((v) => v.msdyn_name));
    if (!number || rules.length < 2 || !variable || !known.has(variable) || rules.some((r) => r!.variable !== variable)) continue;
    lines.push({
      workstreamId: ws.msdyn_liveworkstreamid, workstream: ws.msdyn_name, dial: number.msdyn_phonenumber, variable,
      menu: rules.map((r) => ({ label: r!.name, value: r!.value, queueId: r!.queueId })),
      fallback: store.find("queue", ws._msdyn_defaultqueue_value)?.name ?? ""
    });
  }
  return lines;
}

// The choices that fit this line and aren't in use yet (no queue or menu option with a close name).
export function choicesFor(template: LessonTemplate, line: Line, store: Store): string[] {
  const key = Object.keys(template.pick.choices).find((k) => k !== "*" && line.workstream.toLowerCase().includes(k.toLowerCase())) ?? "*";
  const queues = store.table("queue").map((q) => String(q.name));
  return (template.pick.choices[key] ?? []).filter((c) => !queues.some((q) => closeName(q, c)) && !line.menu.some((m) => closeName(m.value, c) || closeName(m.label, c)));
}

// A small, repeatable random generator (mulberry32), so a variant can be made again from its seed.
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// "Customer Service – Voice" → "customer service line".
export const lineLabel = (workstream: string) => `${workstream.replace(/\s*–\s*Voice$/i, "").toLowerCase()} line`;
export const listOf = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}` : items[0] ?? "");

export function fill<T>(value: T, values: Record<string, string>): T {
  const text = (s: string) => s.replace(/\{(\w+)\}/g, (m, k) => values[k] ?? m);
  if (typeof value === "string") return text(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => fill(v, values)) as unknown as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [text(k), fill(v, values)])) as T;
  return value;
}

// One run of the template: a line and a choice picked with the seed, everything filled in.
// `pin` fixes the line and/or the choice (tests use it to get a known variant).
export function makeLesson(template: LessonTemplate, store: Store, seed: number, pin: { workstream?: string; choice?: string } = {}): Lesson {
  const next = random(seed);
  const lines = linesWithIvr(store).filter((l) => !pin.workstream || l.workstream === pin.workstream);
  if (!lines.length) throw new Error("No phone line with an IVR and a menu in this environment.");
  const line = lines[Math.floor(next() * lines.length)];
  const free = choicesFor(template, line, store);
  if (!free.length) throw new Error(`Every menu choice in the template is already used on the ${line.workstream} line.`);
  const pickedChoice = free[Math.floor(next() * free.length)];
  const choice = pin.choice ?? pickedChoice;
  const suggested = store.find("queue", line.menu[Math.floor(next() * line.menu.length)].queueId)?.name ?? line.fallback;
  const values: Record<string, string> = {
    choice, line: lineLabel(line.workstream), dial: line.dial, workstream: line.workstream, variable: line.variable,
    menu: listOf(line.menu.map((m) => m.label)), suggested, fallback: line.fallback
  };
  const { pick: _pick, about: _about, ...rest } = template;
  const ivr: Ivr = {
    workstream: line.workstream, variable: line.variable, prompt: "Welcome to Contoso. What is your call about?",
    options: [...line.menu.map((m) => ({ label: m.label, value: m.value })), { label: choice, value: choice }]
  };
  return { ...fill(rest, values), line: { dial: line.dial, label: `Contoso ${values.line}`, ivr }, variant: { seed, choice, workstream: line.workstream } };
}

// A new seed for a new variant.
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
