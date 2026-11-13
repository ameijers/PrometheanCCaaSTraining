// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { parseDecisionXml } from "@toolbox/visual-routing-tester/src/ruleXml";
import { routeToQueueRuleset } from "../admin/actions";
import { lineOf, placeCall } from "../calls/engine";
import { Row, Store } from "../simulator/store";
import { checkGoal, Goal } from "../scenarios/goals";
import type { CallTime } from "../calls/engine";

// Checks are data (manual 9.2): code decides whether a task is done, never the AI.
//
// They forgive small slips (manual 9.4a). A name the learner chooses, like a queue's, passes when it's
// close to the brief's ("Repair" for "Repairs"), with a friendly note. A value that has to match the
// system, like the value a rule compares with what the IVR sends, really changes where a call goes, so
// that check fails, but says exactly what's different so the learner can fix it.

export type Check =
  // A row exists with these column values. Columns in `close` may be a near miss (a name the learner typed).
  | { type: "row"; table: string; where: Record<string, string | number | boolean>; close?: string[] }
  // The queue with (about) this name has at least this many members.
  | { type: "members"; queue: string; atLeast: number }
  // A call with these IVR answers ends in the queue with (about) this name; the check places the call itself.
  | { type: "call"; dial: string; answers: Record<string, string>; expect: { queue: string } }
  // The learner made such a call (a recorded call with these answers, ending in that queue if given).
  | { type: "callMade"; answers: Record<string, string>; expect?: { queue: string }; dial?: string; workstream?: string }
  // The learner opened a part of the training (recorded by the app as "seen:<what>"), e.g. the diagram.
  | { type: "seen"; what: string }
  // The learner did something in the workspace (recorded as "did:<what>"), e.g. accepted a call.
  | { type: "did"; what: string }
  // The learner answered a question about the environment (the task's `ask`) with this value.
  | { type: "answer"; key: string; expect: string }
  // A goal from the build exercises (src/scenarios/goals.ts), e.g. a fallback queue or operation hours.
  | { type: "goal"; goal: Goal }
  // The workstream answers at least this many phone numbers (voice channels with a number).
  | { type: "numbers"; workstream: string; atLeast: number }
  // A call with these answers (at this time, if given) has a step in its trace that contains this text.
  | { type: "trace"; dial: string; answers: Record<string, string>; at?: CallTime; includes: string };

export interface Lesson {
  id: string;
  title: string;
  level: number;
  company: string;
  summary: string;
  finished: string;
  story: string[];
  line: { dial: string; label: string; ivr?: Ivr };
  tasks: Task[];
  // For a lesson made from a template: what this run picked (src/lessons/template.ts).
  variant?: { seed: number; choice: string; workstream: string };
}

export interface Ivr { workstream: string; variable: string; prompt: string; options: { label: string; value: string }[] }

export interface Task {
  id: string;
  title: string;
  do: string;
  check: Check;
  done?: string;
  concept: string;
  tab: "admin" | "diagram" | "phone" | "agent";
  hints: string[];
  // A question the learner answers in the task (check type "answer"): pick from the environment's queues or
  // workstreams, from a list, or type a number.
  ask?: { question: string; options: "queues" | "workstreams" | "people" | "profiles" | "variables" | "hours" | "number" | string[] };
}

// What the learner did, saw and answered, kept in the environment (schema.ts training_answer).
export function record(store: Store, key: string, value = "yes"): void {
  const row = store.table("training_answer").find((r) => r.key === key);
  if (row && row.value === value) return;
  if (row) store.update("training_answer", row.training_answerid, { value });
  else store.insert("training_answer", { key, value });
}
export const recorded = (store: Store, key: string): string | undefined => store.table("training_answer").find((r) => r.key === key)?.value;

export interface CheckResult {
  passed: boolean;
  // Passed with a near miss, or failed with the reason: shown to the learner.
  note?: string;
}

// ---- matching names ----

const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

// Same name, or a small slip: upper/lower case, extra spaces, or one or two letters off (one for short names).
export function closeName(typed: unknown, wanted: string): boolean {
  const [a, b] = [norm(typed), norm(wanted)];
  if (!a) return false;
  return a === b || distance(a, b) <= (b.length >= 6 ? 2 : 1);
}

const same = (a: unknown, b: unknown) => (typeof a === "string" && typeof b === "string" ? norm(a) === norm(b) : a === b);

// The queue the brief means: an exact name first, otherwise the closest near miss.
export function queueNamed(store: Store, name: string): Row | undefined {
  const queues = store.table("queue").filter((q) => q.statecode === 0);
  return queues.find((q) => same(q.name, name)) ?? queues.filter((q) => closeName(q.name, name)).sort((a, b) => distance(norm(a.name), norm(name)) - distance(norm(b.name), norm(name)))[0];
}

const nearMiss = (typed: unknown, wanted: string) => (norm(typed) !== norm(wanted) ? `You named it “${typed}”; the brief said “${wanted}”. That's fine.` : undefined);

// ---- running checks ----

export async function runCheck(store: Store, check: Check): Promise<CheckResult> {
  switch (check.type) {
    case "row": {
      const close = new Set(check.close ?? []);
      const row = store.table(check.table).find((r) => Object.entries(check.where).every(([k, v]) => (close.has(k) ? closeName(r[k], String(v)) : same(r[k], v))));
      if (!row) return { passed: false };
      const notes = [...close].map((k) => nearMiss(row[k], String(check.where[k]))).filter(Boolean);
      return { passed: true, note: notes[0] };
    }
    case "members": {
      const queue = queueNamed(store, check.queue);
      if (!queue) return { passed: false };
      const count = store.table("queuemembership").filter((m) => m.queueid === queue.queueid).length;
      return count >= check.atLeast ? { passed: true } : { passed: false, note: count ? `${queue.name} has ${count} user${count === 1 ? "" : "s"} so far.` : undefined };
    }
    case "call": {
      const queue = queueNamed(store, check.expect.queue);
      const result = await placeCall(store, { dial: check.dial, answers: check.answers }, { record: false });
      if (queue && result.queue?.id === queue.queueid) return { passed: true };
      return { passed: false, note: queue ? whyNotRouted(store, check, queue, result.queue?.name) : undefined };
    }
    case "callMade": {
      const wanted = check.expect ? queueNamed(store, check.expect.queue) : undefined;
      const ws = check.workstream ? store.table("msdyn_liveworkstream").find((w) => same(w.msdyn_name, check.workstream)) : undefined;
      const calls = store.table("msdyn_ocliveworkitem").filter((call) => {
        if (check.workstream && call._msdyn_liveworkstreamid_value !== ws?.msdyn_liveworkstreamid) return false;
        const answers = store.table("msdyn_ocliveworkitemcontextitem").filter((c) => c._msdyn_ocliveworkitemid_value === call.activityid);
        return Object.entries(check.answers).every(([k, v]) => answers.some((a) => a.msdyn_name === k && same(a.msdyn_value, v)));
      });
      if (!check.expect) return { passed: calls.length > 0 };
      if (wanted && calls.some((c) => c._msdyn_cdsqueueid_value === wanted.queueid)) return { passed: true };
      const last = calls.sort((a, b) => String(b.createdon).localeCompare(String(a.createdon)))[0];
      const lastQueue = last ? store.find("queue", last._msdyn_cdsqueueid_value)?.name : undefined;
      return { passed: false, note: lastQueue ? `Your last call like this went to ${lastQueue}.` : undefined };
    }
    case "goal": {
      const results = await checkGoal(store, check.goal);
      const failed = results.find((r) => !r.result.passed);
      return failed ? { passed: false, note: failed.result.note } : { passed: true, note: results.map((r) => r.result.note).find(Boolean) };
    }
    case "numbers": {
      const ws = store.table("msdyn_liveworkstream").find((w) => same(w.msdyn_name, check.workstream));
      const count = ws ? store.table("msdyn_ocvoicechannelsetting").filter((c) => c._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid && c._msdyn_phonenumberid_value).length : 0;
      return count >= check.atLeast ? { passed: true } : { passed: false, note: ws ? `${ws.msdyn_name} answers ${count} number${count === 1 ? "" : "s"} now.` : undefined };
    }
    case "trace": {
      const result = await placeCall(store, { dial: check.dial, answers: check.answers, at: check.at }, { record: false });
      return { passed: result.steps.some((st) => st.detail.includes(check.includes)) };
    }
    case "seen": return { passed: recorded(store, `seen:${check.what}`) !== undefined };
    case "did": return { passed: recorded(store, `did:${check.what}`) !== undefined };
    case "answer": {
      const given = recorded(store, `answer:${check.key}`);
      if (given === undefined) return { passed: false };
      const right = /^d+$/.test(check.expect) ? Number(given.trim()) === Number(check.expect) : same(given, check.expect);
      return right ? { passed: true } : { passed: false, note: `“${given}” isn't it. Look again.` };
    }
  }
}

// Why a call doesn't reach the queue yet, in the learner's terms: no rule, a rule on another variable,
// or a rule whose value doesn't match what the IVR sends.
function whyNotRouted(store: Store, check: Extract<Check, { type: "call" }>, queue: Row, endedIn?: string): string {
  const ended = endedIn ? ` The call goes to ${endedIn}.` : "";
  const workstream = lineOf(store, check.dial).workstream;
  const ruleset = workstream && routeToQueueRuleset(store, workstream.msdyn_liveworkstreamid);
  const rules = ruleset ? parseDecisionXml(ruleset.msdyn_rulesetdefinition)?.rules ?? [] : [];
  const toQueue = rules.filter((r) => r.setAttributes.some((s) => s.lhs === "assign_to.queue" && s.rhs.replace(/[{}]/g, "").toLowerCase() === queue.queueid));
  if (!toQueue.length) return `No rule routes to ${queue.name} yet.${ended}`;
  for (const [variable, value] of Object.entries(check.answers)) {
    for (const rule of toQueue) {
      const condition = rule.conditions[0];
      if (!condition) continue;
      const checks = condition.lhs.replace(/^liveworkitemcontext\./, "");
      if (checks !== variable) return `The rule “${rule.name}” checks ${checks}, but the IVR stores the caller's choice in ${variable}. Edit the rule.${ended}`;
      if (!same(condition.rhs, value)) return `The IVR sends “${value}”, but the rule “${rule.name}” checks “${condition.rhs}”. Edit the rule and change its value.${ended}`;
    }
  }
  return `A rule routes to ${queue.name}, but another rule catches the call first.${ended} Look at the order in the decision list.`;
}

export async function runChecks(store: Store, lesson: Lesson): Promise<Record<string, CheckResult>> {
  const out: Record<string, CheckResult> = {};
  for (const task of lesson.tasks) out[task.id] = await runCheck(store, task.check);
  return out;
}
