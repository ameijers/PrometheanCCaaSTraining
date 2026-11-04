// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { loadRoutingModel } from "@toolbox/visual-routing-tester/src/dataverse";
import { createSimulator, Simulator } from "../simulator";
import { Rows } from "../simulator/store";
import { answerKey, answerLabel, answerOf, callFor, faultProblems, healthIssues, optionsFor } from "./grade";
import { Scenario, shapeProblems } from "./scenario";
import { describeEnvironment, scenarioRows } from "./world";
import { checkGoals, requirement, solve } from "./goals";

// Every scenario is checked before a learner sees it (manual 8.3), whether the AI wrote it or a person:
//   1. it has the right shape;
//   2. its environment loads, and the Toolbox builds the graph and the routing model without warnings;
//   3. the Toolbox's health checks find exactly the planted faults;
//   4. each call ends where the scenario says, when the call engine places it;
//   5. each goal of "Build to requirements" or "Customer interview" fails at the start and passes after the
//      reference solution, made only of the admin center's actions, without new problems (src/scenarios/goals.ts).
// Returns what's wrong, in words the AI can act on when the scenario goes back to it.

const OLD = / \(old\)$/;

// The Toolbox finds Xrm as a global. Checks run one at a time, each with its own simulator.
let queue: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

// Runs work against its own simulator of these rows, with that simulator's Xrm in place.
export function inSimulator<T>(rows: Rows, work: (sim: Simulator) => Promise<T>): Promise<T> {
  return oneAtATime(() => withXrm(createSimulator({ rows }), work));
}

async function withXrm<T>(sim: Simulator, work: (sim: Simulator) => Promise<T>): Promise<T> {
  const g = globalThis as any;
  const before = g.Xrm;
  g.Xrm = sim.xrm;
  try {
    return await work(sim);
  } finally {
    g.Xrm = before;
  }
}

export function validateScenario(s: Scenario): Promise<string[]> {
  return oneAtATime(() => check(s));
}

async function check(s: Scenario): Promise<string[]> {
  const shape = shapeProblems(s);
  if (shape.length) return shape;

  let rows;
  try {
    rows = scenarioRows(s);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
  return withXrm(createSimulator({ rows }), async (sim) => {
    const p: string[] = [];
    const { graph } = await healthIssues();
    const model = await loadRoutingModel();
    if (graph.warnings?.length || model.warnings.length) p.push(`The environment doesn't load cleanly: ${[...(graph.warnings ?? []), ...model.warnings].join(" ")}`);

    // A rule that now routes to "<queue> (old)" no longer routes to <queue> (src/scenarios/world.ts).
    const intended = sim.store.table("queue").filter((q) => q.statecode === 1 && OLD.test(q.name)).map((q) => ({ check: "unreachable", name: q.name.replace(OLD, "") }));
    if (s.kind === "fix") p.push(...await faultProblems(s.faults ?? [], intended));
    else p.push(...await faultProblems([]));

    if (s.goals?.length) p.push(...await goalProblems(sim, s));
    const env = await describeEnvironment(sim.store);
    for (const [i, q] of (s.questions ?? []).entries()) {
      const n = i + 1;
      const line = env.lines.find((l) => l.dial === q.dial);
      if (!line) { p.push(`Call ${n}: ${q.dial} isn't one of the environment's numbers.`); continue; }
      if (q.choice && !line.ivr) p.push(`Call ${n}: ${q.dial} has no IVR, so the caller can't make a choice.`);
      if (line.choices.some((c) => c.value === q.choice && c.queues.length > 1)) p.push(`Call ${n}: the rule for “${q.choice}” picks a queue at random, so the call can't be predicted. Use another choice.`);
      const actual = answerOf(await callFor(sim.store, q));
      if (answerKey(actual) !== answerKey(q.answer)) p.push(`Call ${n}: the scenario says “${answerLabel(q.answer)}”, but the call engine says “${answerLabel(actual)}”.`);
      if (optionsFor(q, env).length < 3) p.push(`Call ${n}: there aren't enough plausible wrong answers; pick a call with more possible endings.`);
    }
    const keys = (s.questions ?? []).map((q) => `${q.dial}|${q.choice}|${JSON.stringify(q.at)}|${JSON.stringify(q.queue)}`);
    if (new Set(keys).size !== keys.length) p.push("Two calls are the same. Make every call different.");
    return p;
  });
}

// Check 5. Runs last on this simulator: the reference solution changes it.
async function goalProblems(sim: Simulator, s: Scenario): Promise<string[]> {
  const p: string[] = [];
  const goals = s.goals ?? [];
  const before = await checkGoals(sim.store, goals);
  before.forEach((checks, i) => checks.forEach((c) => { if (c.result.passed) p.push(`Goal ${i + 1} (“${requirement(goals[i])}”) is already met at the start: “${c.title}”.`); }));
  const admin = { api: sim.api, store: sim.store };
  for (const [i, g] of goals.entries()) {
    try {
      solve(admin, g);
    } catch (e) {
      p.push(`Goal ${i + 1} can't be built in the admin center: ${e instanceof Error ? e.message : String(e)}`);
      return p;
    }
  }
  const after = await checkGoals(sim.store, goals);
  after.forEach((checks, i) => checks.forEach((c) => { if (!c.result.passed) p.push(`Goal ${i + 1} isn't met even after building it: “${c.title}”.${c.result.note ? " " + c.result.note : ""}`); }));
  const { found } = await healthIssues(sim.store);
  const problems = found.filter((f) => f.issue.severity === "problem");
  if (problems.length) p.push(`Building the goals causes problems: ${problems.map((f) => `${f.issue.title} on “${f.name}”`).join("; ")}.`);
  return p;
}
