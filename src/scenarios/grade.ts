// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { loadRaw } from "@toolbox/environment-3d-explorer/src/dataverse";
import { buildGraph } from "@toolbox/environment-3d-explorer/src/graph";
import { findIssues, Issue } from "@toolbox/environment-3d-explorer/src/health";
import { Graph } from "@toolbox/environment-3d-explorer/src/model";
import { CallResult, describeTime, endingOf, placeCall } from "../calls/engine";
import { Store } from "../simulator/store";
import { Answer, Fault, Question } from "./scenario";
import { Environment } from "./world";

// Grading, by code (manual principle 2): "Fix the broken contact center" with the Toolbox's health
// checks, "Where does this call go?" with the call engine. Both need the simulator's Xrm in place, the
// way the call engine does.

// ---- faults ----

// The health check that finds a fault, and the shape it's on.
export function issueOf(f: Fault): { check: string; kind: string; name: string } {
  switch (f.type) {
    case "no-members": return { check: "no-members", kind: "queue", name: f.queue };
    case "fallback-queue-off": return { check: "missing-default-queue", kind: "workstream", name: f.workstream };
    case "rule-queue-off": return { check: "missing-queue", kind: "rule", name: f.rule };
  }
}

export interface Found { issue: Issue; kind: string; name: string }

export async function healthIssues(): Promise<{ graph: Graph; found: Found[] }> {
  const graph = buildGraph(await loadRaw());
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  return { graph, found: findIssues(graph).map((issue) => ({ issue, kind: byKey.get(issue.key)?.kind ?? "", name: byKey.get(issue.key)?.name ?? "" })) };
}

const matches = (found: Found, f: Fault) => { const want = issueOf(f); return found.issue.check === want.check && found.kind === want.kind && found.name === want.name; };

// What the learner sees for a fault: nothing that gives it away until it's fixed.
export function faultTitle(f: Fault): { found: string; hints: string[]; concept: string } {
  switch (f.type) {
    case "no-members": return {
      found: `Nobody could pick up calls in “${f.queue}”: the queue had no members.`,
      hints: ["Look at the queues calls are routed to. The Diagram marks problems in red.", "One queue has no users. Open it in the admin center.", "Add users to the queue."],
      concept: "queue"
    };
    case "fallback-queue-off": return {
      found: `“${f.workstream}” sent calls nobody routes to a queue that was switched off.`,
      hints: ["Look at the workstreams: where do calls go that no rule routes?", "One workstream's fallback queue isn't an active queue anymore.", "Open the workstream and pick another fallback queue."],
      concept: "fallback-queue"
    };
    case "rule-queue-off": return {
      found: `The rule “${f.rule}” on “${f.workstream}” routed calls to a queue that was switched off.`,
      hints: ["Look at the routing rules. The Diagram marks problems in red.", "A rule routes to a queue that isn't active anymore.", "Open the workstream's route-to-queue rules, edit the rule, and pick an active queue."],
      concept: "route-to-queue"
    };
  }
}

export interface FixGrade {
  faults: { fault: Fault; fixed: boolean }[];
  // Problems that weren't planted: something the learner's changes broke.
  newProblems: Issue[];
  done: boolean;
}

export async function gradeFix(faults: Fault[]): Promise<FixGrade> {
  const { found } = await healthIssues();
  const graded = faults.map((fault) => ({ fault, fixed: !found.some((x) => matches(x, fault)) }));
  const newProblems = found.filter((x) => x.issue.severity === "problem" && !faults.some((f) => matches(x, f))).map((x) => x.issue);
  return { faults: graded, newProblems, done: graded.every((g) => g.fixed) && !newProblems.length };
}

// Check 3 of manual 8.3: the health checks find exactly the planted faults, plus any warnings listed as
// intended (a rule pointed at a switched-off queue leaves its old queue with nothing routing to it).
export async function faultProblems(faults: Fault[], intended: { check: string; name: string }[] = []): Promise<string[]> {
  const { found } = await healthIssues();
  const p: string[] = [];
  faults.forEach((f, i) => {
    const hit = found.find((x) => matches(x, f));
    if (!hit) p.push(`Fault ${i + 1} (${f.type}) isn't found by the health checks: check the names.`);
    else if (hit.issue.severity !== "problem") p.push(`Fault ${i + 1} (${f.type} on “${issueOf(f).name}”) is only a warning there, because nothing routes calls to it. Pick a queue calls are routed to.`);
  });
  const extra = found.filter((x) => !faults.some((f) => matches(x, f)) && !(x.issue.severity === "warning" && intended.some((i) => i.check === x.issue.check && i.name === x.name)));
  if (extra.length) p.push(`The health checks also find: ${extra.map((x) => `${x.issue.title} on “${x.name}”`).join("; ")}. Those weren't planted.`);
  const keys = faults.map((f) => JSON.stringify(issueOf(f)));
  if (new Set(keys).size !== keys.length) p.push("Two faults are the same. Plant each fault once.");
  return p;
}

// ---- calls ----

export const answerKey = (a: Answer) => `${a.outcome}|${a.queue ?? ""}`;

export function answerLabel(a: Answer): string {
  if (a.outcome === "Not connected") return "It doesn't reach any queue";
  if (a.outcome === "Agent") return `It waits in “${a.queue}” for a representative`;
  return `It ${endingOf(a.outcome)} from “${a.queue}”`;
}

export async function callFor(store: Store, q: Question): Promise<CallResult> {
  return placeCall(store, { dial: q.dial, answers: q.choice ? { SelectedMenuItem: q.choice } : {}, at: q.at, queue: q.queue }, { record: false });
}

export const answerOf = (r: CallResult): Answer => (r.queue && r.outcome ? { queue: r.queue.name, outcome: r.outcome } : { outcome: "Not connected" });

// What the learner sees about a call before predicting it.
export function callFacts(q: Question): string[] {
  return [
    `Calls ${q.dial}`,
    q.choice ? `Chooses “${q.choice}” in the IVR` : "Makes no menu choice",
    ...(q.at ? [`At ${describeTime(q.at)}, the contact center's local time`] : []),
    ...(q.queue?.estimatedWaitMinutes !== undefined ? [`The predicted wait is ${q.queue.estimatedWaitMinutes} minutes`] : []),
    ...(q.queue?.waitedSeconds !== undefined ? [`If the call waits in a queue, it waits ${Math.round(q.queue.waitedSeconds / 60)} minutes there`] : [])
  ];
}

// The answer choices: the right one and up to three that are close (the line's fallback queue, other
// rules' queues, the queue's overflow endings, not reaching a queue). Always in the same order for a
// question, so a reload doesn't shuffle them.
export function optionsFor(q: Question, env: Environment): Answer[] {
  const line = env.lines.find((l) => l.dial === q.dial);
  const near: Answer[] = [];
  const queueOf = (name?: string) => env.queues.find((x) => x.name === name);
  if (q.answer.queue && q.answer.outcome !== "Agent") near.push({ queue: q.answer.queue, outcome: "Agent" });
  near.push(...(queueOf(q.answer.queue)?.ends ?? []));
  if (line?.fallback) near.push({ queue: line.fallback, outcome: "Agent" });
  for (const c of line?.choices ?? []) for (const name of c.queues) { near.push({ queue: name, outcome: "Agent" }); near.push(...(queueOf(name)?.ends ?? [])); }
  near.push({ outcome: "Not connected" });
  const seen = new Set([answerKey(q.answer)]);
  const picked = near.filter((a) => (seen.has(answerKey(a)) ? false : (seen.add(answerKey(a)), true)));
  const order = (a: Answer) => hash(`${q.id}:${q.caller}:${answerKey(a)}`);
  return [q.answer, ...picked.slice(0, 3)].sort((a, b) => order(a) - order(b));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface CallGrade { correct: boolean; actual: Answer; result: CallResult }

export async function gradeCall(store: Store, q: Question, picked: Answer): Promise<CallGrade> {
  const result = await callFor(store, q);
  const actual = answerOf(result);
  return { correct: answerKey(actual) === answerKey(picked), actual, result };
}
