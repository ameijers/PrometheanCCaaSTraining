// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Grading by code: a fix scenario is solved through the admin center's own actions, and the health
// checks see each fault go; a call question is graded by the call engine. And the checks of manual 8.3
// catch what a careless writer (person or AI) gets wrong.
import { parseDecisionXml } from "@toolbox/visual-routing-tester/src/ruleXml";
import { addUsers, routeToQueueRuleset, setFallbackQueue } from "../../src/admin/actions";
import { simpleRule, updateRouteToQueueRule } from "../../src/admin/rules";
import { createSimulator } from "../../src/simulator";
import { answerKey, gradeCall, gradeFix, optionsFor } from "../../src/scenarios/grade";
import { Scenario } from "../../src/scenarios/scenario";
import { validateScenario } from "../../src/scenarios/validate";
import { describeEnvironment, scenarioRows } from "../../src/scenarios/world";
import readyMade from "../../content/scenarios/ready-made.json";
import { installGlobalXrm } from "../simulator/helpers";

const scenario = (id: string) => JSON.parse(JSON.stringify(readyMade.scenarios.find((s) => s.id === id))) as Scenario;

describe("fixing “After the reorganisation” in the admin center", () => {
  const s = scenario("fix-2-after-the-reorganisation");
  const sim = createSimulator({ rows: scenarioRows(s) });
  const admin = { api: sim.api, store: sim.store };
  beforeAll(() => installGlobalXrm(sim.xrm));
  const ws = (name: string) => sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === name)!.msdyn_liveworkstreamid;
  const queue = (name: string) => sim.store.table("queue").find((q) => q.name === name && q.statecode === 0)!.queueid;
  const fixed = async () => (await gradeFix(s.faults!)).faults.map((f) => f.fixed);

  test("at the start, every fault is there", async () => {
    expect(await fixed()).toEqual([false, false, false]);
  });

  test("each fix ticks off its fault, and the scenario is done when all are fixed", async () => {
    const ruleset = routeToQueueRuleset(sim.store, ws("Customer Service – Voice"))!;
    const returns = parseDecisionXml(ruleset.msdyn_rulesetdefinition)!.rules.find((r) => r.name === "Returns")!;
    updateRouteToQueueRule(admin, ws("Customer Service – Voice"), { ...simpleRule(returns)!, queueId: queue("Returns") });
    expect(await fixed()).toEqual([true, false, false]);

    const users = sim.store.table("systemuser").filter((u) => u.accessmode === 0 && !u.isdisabled).slice(0, 2).map((u) => u.systemuserid);
    addUsers(admin, queue("Order Desk"), users);
    expect(await fixed()).toEqual([true, true, false]);

    setFallbackQueue(admin, ws("Technical Support – Voice"), queue("Overflow"));
    expect(await gradeFix(s.faults!)).toMatchObject({ done: true, newProblems: [] });
  });

  test("a change that breaks something else shows as a new problem", async () => {
    for (const m of sim.store.table("queuemembership").filter((x) => x.queueid === queue("Escalations"))) sim.store.remove("queuemembership", m.queuemembershipid);
    const grade = await gradeFix(s.faults!);
    expect(grade.done).toBe(false);
    expect(grade.newProblems.map((p) => p.check)).toEqual(["no-members"]);
  });
});

describe("grading “Where does this call go?”", () => {
  const s = scenario("route-3-late-and-long");
  const sim = createSimulator({ rows: scenarioRows(s) });
  beforeAll(() => installGlobalXrm(sim.xrm));

  test("every call has the right answer among three or four choices", async () => {
    const env = await describeEnvironment(sim.store);
    for (const q of s.questions!) {
      const options = optionsFor(q, env);
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.map(answerKey)).toContain(answerKey(q.answer));
      expect(new Set(options.map(answerKey)).size).toBe(options.length);
    }
  });

  test("the call engine decides, and shows the trace", async () => {
    const q = s.questions![0];
    expect((await gradeCall(sim.store, q, q.answer)).correct).toBe(true);
    const wrong = await gradeCall(sim.store, q, { queue: "Sales", outcome: "Agent" });
    expect(wrong).toMatchObject({ correct: false, actual: { queue: "Sales", outcome: "Voicemail" } });
    expect(wrong.result.steps.map((x) => x.what)).toContain("Overflow");
  });
});

describe("the checks of manual 8.3 catch mistakes", () => {
  const problems = (change: (s: Scenario) => void, id = "route-2-the-menu") => {
    const s = scenario(id);
    change(s);
    return validateScenario(s);
  };

  test("a wrong answer", async () => {
    expect(await problems((s) => { s.questions![0].answer = { queue: "Billing", outcome: "Agent" }; })).toEqual([expect.stringMatching(/call engine says “It waits in “Escalations”/)]);
  });

  test("a number that isn't in the environment, or a phone number in the text", async () => {
    expect(await problems((s) => { s.questions![0].dial = "+44 20 7946 0999"; })).toEqual([expect.stringMatching(/isn't one of the environment's numbers/)]);
    expect(await problems((s) => { s.questions![0].caller = "Call me back on 020 7946 0555."; })).toEqual([expect.stringMatching(/looks like a phone number/)]);
  });

  test("a choice on a line without an IVR, or a choice whose rule picks at random", async () => {
    expect(await problems((s) => { s.questions![2].choice = "NL"; })).toEqual(expect.arrayContaining([expect.stringMatching(/has no IVR/)]));
    expect(await problems((s) => { s.questions![3].choice = "Outage"; s.questions![3].answer = { queue: "Tier 2 Support", outcome: "Agent" }; }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/picks a queue at random/)]));
  });

  test("a fault that names nothing, or the same fault twice", async () => {
    expect(await problems((s) => { s.faults![0] = { type: "no-members", queue: "Bililng" }; }, "fix-1-monday-morning")).toEqual([expect.stringMatching(/no queue named “Bililng”/)]);
    expect(await problems((s) => { s.faults = [s.faults![0], s.faults![0]]; }, "fix-1-monday-morning")).toEqual([expect.stringMatching(/Two faults are the same/)]);
  });

  test("the wrong amount or kind of work for the level", async () => {
    expect(await problems((s) => { s.questions = s.questions!.slice(0, 2); })).toEqual([expect.stringMatching(/3 to 5 calls/)]);
    expect(await problems((s) => { s.questions![0].at = { day: 1, time: "10:00" }; })).toEqual([expect.stringMatching(/belong to level 3/)]);
    expect(await problems((s) => { s.faults = [{ type: "no-members", queue: "Billing" }]; }, "fix-2-after-the-reorganisation"))
      .toEqual(expect.arrayContaining([expect.stringMatching(/2 to 4 faults/), expect.stringMatching(/rule-queue-off/)]));
  });
});
