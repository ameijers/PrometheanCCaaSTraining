// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// "Build to requirements" (manual 9.1): goals are graded by code, and check 5 of manual 8.3 catches goals
// that are met already, can't be built, or don't fit the level.
import { addRouteToQueueRule, addUsers, createQueue } from "../../src/admin/actions";
import { createSimulator } from "../../src/simulator";
import { checkGoals } from "../../src/scenarios/goals";
import { Scenario } from "../../src/scenarios/scenario";
import { validateScenario } from "../../src/scenarios/validate";
import { scenarioRows } from "../../src/scenarios/world";
import readyMade from "../../content/scenarios/ready-made.json";
import { installGlobalXrm } from "../simulator/helpers";

const scenario = (id: string) => JSON.parse(JSON.stringify(readyMade.scenarios.find((s) => s.id === id))) as Scenario;

test("a learner's own build, with a slip in the name, meets the warranty goal step by step", async () => {
  const s = scenario("build-2-warranty");
  const sim = createSimulator({ rows: scenarioRows(s) });
  installGlobalXrm(sim.xrm);
  const admin = { api: sim.api, store: sim.store };
  const passed = async () => (await checkGoals(sim.store, s.goals!))[0].map((c) => c.result.passed);
  expect(await passed()).toEqual([false, false, false]);
  const id = createQueue(admin, { name: "Waranty", type: "Voice", priority: 2 });
  expect(await passed()).toEqual([true, false, false]);
  addUsers(admin, id, sim.store.table("msdyn_agentstatus").slice(0, 2).map((a) => a._msdyn_agentid_value));
  const ws = sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice")!.msdyn_liveworkstreamid;
  addRouteToQueueRule(admin, ws, { name: "Warranty claims", variable: "SelectedMenuItem", value: "Warranty", queueId: id });
  const checks = (await checkGoals(sim.store, s.goals!))[0];
  expect(checks.map((c) => c.result.passed)).toEqual([true, true, true]);
  expect(checks[0].result.note).toMatch(/You named it “Waranty”/);
});

describe("check 5 catches goals that don't work", () => {
  const problems = (change: (s: Scenario) => void, id = "build-1-safety-nets") => { const s = scenario(id); change(s); return validateScenario(s); };

  test("a goal that's met already", async () => {
    expect(await problems((s) => { s.goals = [{ type: "members", queue: "Partner Desk", atLeast: 2 }]; })).toEqual([expect.stringMatching(/already met at the start/)]);
  });

  test("a goal that can't be built", async () => {
    expect(await problems((s) => { s.goals = [{ type: "fallback", workstream: "Dutch Desk – Voice", queue: "No Such Queue" }]; })).toEqual([expect.stringMatching(/can't be built|isn't met even after/)]);
  });

  test("a goal above the scenario's level, or none at its level", async () => {
    expect(await problems((s) => { s.goals = [{ type: "capacity", profile: "Default voice inbound", limit: 3 }]; })).toEqual(expect.arrayContaining([expect.stringMatching(/belongs to level 4/)]));
    expect(await problems((s) => { s.goals = [{ type: "members", queue: "Billing", atLeast: 12 }]; }, "build-3-evenings")).toEqual([expect.stringMatching(/at least one goal of level 3/)]);
  });

  test("an interview with a goal no question reveals", async () => {
    expect(await problems((s) => { s.interview!.topics = s.interview!.topics.filter((t) => t.goal !== 1); }, "interview-2-warranty")).toEqual([expect.stringMatching(/No question in the interview reveals goal 2/)]);
  });
});

test("a goal naming something that isn't there gets a plain answer the AI can act on", async () => {
  const s = scenario("build-3-evenings");
  s.goals = [{ type: "operation-hours", queue: "Returns", hours: "Office hours" }];
  expect(await validateScenario(s)).toEqual([expect.stringMatching(/There's no operating hours record named “Office hours”: use “Business hours”, “Weekend desk”/)]);
});
