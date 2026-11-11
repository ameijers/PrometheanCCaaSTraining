// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Manual 9.4a: small slips don't block a learner. A queue named "Repair" is fine; a rule that checks
// "Repair" while the IVR sends "Repairs" really misroutes, so the check says exactly why, and Edit fixes it.
import { addRouteToQueueRule, addUsers, createQueue, routeToQueueRuleset } from "../../src/admin/actions";
import { deleteRouteToQueueRule, moveRouteToQueueRule, simpleRule, updateRouteToQueueRule } from "../../src/admin/rules";
import { placeCall } from "../../src/calls/engine";
import { closeName, Lesson, runChecks } from "../../src/lessons/checks";
import { createSimulator } from "../../src/simulator";
import { parseDecisionXml } from "@toolbox/visual-routing-tester/src/ruleXml";
import templateJson from "../../content/lessons/new-menu-choice.json";
import { LessonTemplate, makeLesson } from "../../src/lessons/template";
import { installGlobalXrm } from "../simulator/helpers";

// The variant these tests know: the customer service line, with Repairs as the new choice.
const lesson: Lesson = makeLesson(templateJson as LessonTemplate, createSimulator().store, 1, { workstream: "Customer Service – Voice", choice: "Repairs" });

test("close names: case, spaces and one or two letters", () => {
  expect(closeName("repairs", "Repairs")).toBe(true);
  expect(closeName(" Repairs  ", "Repairs")).toBe(true);
  expect(closeName("Repair", "Repairs")).toBe(true);
  expect(closeName("Repiars", "Repairs")).toBe(true);
  expect(closeName("Returns", "Repairs")).toBe(false);
  expect(closeName("Sale", "Sales")).toBe(true);
  expect(closeName("Bills", "Sales")).toBe(false);
});

describe("a learner who makes slips", () => {
  const sim = createSimulator();
  const admin = { api: sim.api, store: sim.store };
  beforeAll(() => installGlobalXrm(sim.xrm));
  const results = () => runChecks(sim.store, lesson);
  const ws = () => sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice")!.msdyn_liveworkstreamid;
  const repair = () => sim.store.table("queue").find((q) => q.name === "Repair")!.queueid;
  const repairsRule = () => {
    const rules = parseDecisionXml(routeToQueueRuleset(sim.store, ws())!.msdyn_rulesetdefinition)!.rules;
    return simpleRule(rules.find((r) => r.name === "Repairs")!)!;
  };

  test("a queue named “Repair” counts, with a friendly note", async () => {
    createQueue(admin, { name: "Repair", type: "Voice", priority: 1 });
    const r = await results();
    expect(r["create-queue"]).toEqual({ passed: true, note: "You named it “Repair”; the brief said “Repairs”. That's fine." });
  });

  test("its users count too", async () => {
    const tier1 = sim.store.table("queue").find((q) => q.name === "Tier 1 Support")!.queueid;
    addUsers(admin, repair(), sim.store.table("queuemembership").filter((m) => m.queueid === tier1).slice(0, 2).map((m) => m.systemuserid));
    expect((await results())["add-users"].passed).toBe(true);
  });

  test("no rule yet: the check says so", async () => {
    expect((await results())["add-rule"]).toEqual({ passed: false, note: "No rule routes to Repair yet. The call goes to Overflow." });
  });

  test("a rule with the wrong value misroutes, and the check says exactly what's different", async () => {
    addRouteToQueueRule(admin, ws(), { name: "Repairs", variable: "SelectedMenuItem", value: "Repair", queueId: repair() });
    expect((await placeCall(sim.store, { dial: lesson.line.dial, answers: { SelectedMenuItem: "Repairs" } }, { record: false })).queue?.name).toBe("Overflow");
    expect((await results())["add-rule"]).toEqual({
      passed: false,
      note: "The IVR sends “Repairs”, but the rule “Repairs” checks “Repair”. Edit the rule and change its value. The call goes to Overflow."
    });
  });

  test("the rule on the wrong context variable is explained too", async () => {
    updateRouteToQueueRule(admin, ws(), { ...repairsRule(), variable: "CustomerLanguage", value: "Repairs" });
    expect((await results())["add-rule"].note).toMatch(/checks CustomerLanguage, but the IVR stores the caller's choice in SelectedMenuItem/);
  });

  test("Edit fixes it, and upper or lower case doesn't matter", async () => {
    updateRouteToQueueRule(admin, ws(), { ...repairsRule(), variable: "SelectedMenuItem", value: "repairs" });
    expect((await results())["add-rule"]).toEqual({ passed: true });
    expect((await placeCall(sim.store, { dial: lesson.line.dial, answers: { SelectedMenuItem: "Repairs" } }, { record: false })).queue?.name).toBe("Repair");
  });
});

describe("decision list: move and delete", () => {
  const sim = createSimulator();
  const admin = { api: sim.api, store: sim.store };
  const ws = () => sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice")!.msdyn_liveworkstreamid;
  const names = () => parseDecisionXml(routeToQueueRuleset(sim.store, ws())!.msdyn_rulesetdefinition)!.rules.map((r) => r.name);

  test("move a rule up and down", () => {
    expect(names()).toEqual(["Billing", "Returns", "Technical", "Complaints"]);
    const returns = parseDecisionXml(routeToQueueRuleset(sim.store, ws())!.msdyn_rulesetdefinition)!.rules[1].id;
    moveRouteToQueueRule(admin, ws(), returns, -1);
    expect(names()).toEqual(["Returns", "Billing", "Technical", "Complaints"]);
    moveRouteToQueueRule(admin, ws(), returns, -1); // already first: nothing changes
    moveRouteToQueueRule(admin, ws(), returns, 1);
    expect(names()).toEqual(["Billing", "Returns", "Technical", "Complaints"]);
  });

  test("delete a rule", () => {
    const technical = parseDecisionXml(routeToQueueRuleset(sim.store, ws())!.msdyn_rulesetdefinition)!.rules[2].id;
    deleteRouteToQueueRule(admin, ws(), technical);
    expect(names()).toEqual(["Billing", "Returns", "Complaints"]);
  });
});
