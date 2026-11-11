// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The full rule editor: And/Or groups, operators by field type, a percentage split, the rule hit policy and
// work classification rulesets with outputs. Each rule is saved through the simulator and then a call is
// placed, so the routing engine (the Toolbox's) is what decides where it goes.
import { createQueue, routeToQueueRuleset } from "../../src/admin/actions";
import {
  classificationRulesets, ConditionGroup, createClassificationRuleset, deleteClassificationRuleset, describeConditions, hitPolicyOf, moveClassificationRuleset,
  moveRouteToQueueRule, PRIORITY_SCORE, readRouteRule, ruleFields, rulesOf, saveClassificationRule, saveRouteRule, setHitPolicy
} from "../../src/admin/rules";
import { placeCall } from "../../src/calls/engine";
import { createSimulator } from "../../src/simulator";
import { installGlobalXrm } from "../simulator/helpers";

const MENU = "liveworkitemcontext.SelectedMenuItem";

function setup() {
  const sim = createSimulator();
  installGlobalXrm(sim.xrm);
  const admin = { api: sim.api, store: sim.store };
  const ws = sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice")!.msdyn_liveworkstreamid;
  const channel = sim.store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_liveworkstreamid_value === ws)!;
  const dial = String(sim.store.find("msdyn_ocphonenumber", channel._msdyn_phonenumberid_value)!.msdyn_phonenumber);
  const queue = (name: string) => sim.store.table("queue").find((q) => q.name === name)?.queueid ?? createQueue(admin, { name, type: "Voice", priority: 1 });
  const call = async (answers: Record<string, string>) => (await placeCall(sim.store, { dial, answers }, { record: false }));
  return { sim, admin, ws, queue, call };
}

const or = (...values: string[]): ConditionGroup => ({ logic: "OR", items: values.map((value) => ({ field: MENU, operator: "==", value })) });

describe("route-to-queue rules with groups", () => {
  test("an Or group matches either value, and the rule reads back as it was written", async () => {
    const { admin, ws, queue, call, sim } = setup();
    const sales = queue("Sales and billing");
    saveRouteRule(admin, ws, { name: "Money", conditions: { logic: "AND", items: [or("Wholesale", "Retail")] }, queues: [{ queueId: sales, percentage: "" }] });
    expect((await call({ SelectedMenuItem: "Retail" })).queue?.name).toBe("Sales and billing");
    expect((await call({ SelectedMenuItem: "Wholesale" })).queue?.name).toBe("Sales and billing");
    expect((await call({ SelectedMenuItem: "Returns" })).queue?.name).not.toBe("Sales and billing");
    const rule = readRouteRule(rulesOf(routeToQueueRuleset(sim.store, ws)).find((r) => r.name === "Money")!);
    expect(rule.conditions).toEqual({ logic: "AND", items: [or("Wholesale", "Retail")] });
    expect(describeConditions(rule.conditions)).toBe("(SelectedMenuItem equals Wholesale or SelectedMenuItem equals Retail)");
  });

  test("Contains data and Does not equal", async () => {
    const { admin, ws, queue, call } = setup();
    const any = queue("Anything but returns");
    saveRouteRule(admin, ws, {
      name: "Not returns",
      conditions: { logic: "AND", items: [{ field: MENU, operator: "not-null", value: "" }, { field: MENU, operator: "!=", value: "Returns" }] },
      queues: [{ queueId: any, percentage: "" }]
    });
    // Rules run in order; this one is last, so an earlier rule may take Technical support. Returns never comes here.
    expect((await call({ SelectedMenuItem: "Returns" })).queue?.name).not.toBe("Anything but returns");
    expect((await call({ SelectedMenuItem: "Something new" })).queue?.name).toBe("Anything but returns");
  });

  test("the editor's checks: a value, a number for a number field, an operator that fits the field", () => {
    const { admin, ws, queue } = setup();
    const q = [{ queueId: queue("Tier 1 Support"), percentage: "" }];
    const save = (conditions: ConditionGroup) => () => saveRouteRule(admin, ws, { name: "x", conditions, queues: q });
    expect(save({ logic: "AND", items: [{ field: MENU, operator: "==", value: " " }] })).toThrow("Enter a value for SelectedMenuItem.");
    expect(save({ logic: "AND", items: [{ field: PRIORITY_SCORE, operator: ">", value: "high" }] })).toThrow("Priority Score is a number: enter a number.");
    expect(save({ logic: "AND", items: [{ field: MENU, operator: ">", value: "3" }] })).toThrow("Select an operator for SelectedMenuItem.");
    expect(save({ logic: "AND", items: [{ logic: "OR", items: [] }] })).toThrow("A group has no rows");
    expect(save({ logic: "AND", items: [{ field: "", operator: "==", value: "x" }] })).toThrow("Select a field in each row.");
  });

  test("the fields: the workstream's context variables and Priority Score", () => {
    const { sim, ws } = setup();
    const fields = ruleFields(sim.store, ws);
    expect(fields.find((f) => f.lhs === MENU)).toMatchObject({ label: "SelectedMenuItem", type: "text", under: "Context item value (Conversation)" });
    expect(fields.find((f) => f.lhs === PRIORITY_SCORE)).toMatchObject({ label: "Priority Score", type: "number", under: "Conversation" });
  });
});

describe("a percentage split", () => {
  test("the percentages must total 100, with up to five queues, each once", () => {
    const { admin, ws, queue } = setup();
    const [a, b] = [queue("Vendor A"), queue("Vendor B")];
    const save = (queues: { queueId: string; percentage: string }[]) => () => saveRouteRule(admin, ws, { name: "Split", conditions: { logic: "AND", items: [] }, queues });
    expect(save([{ queueId: a, percentage: "70" }, { queueId: b, percentage: "20" }])).toThrow("add up to 90. They must total 100.");
    expect(save([{ queueId: a, percentage: "50" }, { queueId: a, percentage: "50" }])).toThrow("Each queue can be in Route to queues once.");
    expect(save([{ queueId: a, percentage: "100" }, { queueId: b, percentage: "0" }])).toThrow("from 1 to 99");
    expect(save(Array.from({ length: 6 }, (_, i) => ({ queueId: queue(`V${i}`), percentage: "10" })))).toThrow("up to 5 queues");
  });

  test("calls go to the queues of the split, and the rule reads back with its percentages", async () => {
    const { admin, ws, queue, call, sim } = setup();
    const [a, b] = [queue("Vendor A"), queue("Vendor B")];
    saveRouteRule(admin, ws, { name: "Vendors", conditions: { logic: "AND", items: [{ field: MENU, operator: "==", value: "Vendors" }] }, queues: [{ queueId: a, percentage: "70" }, { queueId: b, percentage: "30" }] });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add((await call({ SelectedMenuItem: "Vendors" })).queue!.name);
    expect([...seen].sort()).toEqual(["Vendor A", "Vendor B"]);
    const result = await call({ SelectedMenuItem: "Vendors" });
    expect(result.steps.find((s) => s.what === "Route to queues")!.detail).toContain("shares its calls by percentage (Vendor A 70%, Vendor B 30%)");
    const rule = readRouteRule(rulesOf(routeToQueueRuleset(sim.store, ws)).find((r) => r.name === "Vendors")!);
    expect(rule.queues).toEqual([{ queueId: a, percentage: "70" }, { queueId: b, percentage: "30" }]);
  });
});

describe("the rule hit policy", () => {
  test("Hit-all sends the call to the first matching rule; Hit-first too; the setting is saved", async () => {
    const { admin, ws, queue, call, sim } = setup();
    const [first, second] = [queue("First match"), queue("Second match")];
    const rule = (name: string, queueId: string) => saveRouteRule(admin, ws, { name, conditions: { logic: "AND", items: [{ field: MENU, operator: "==", value: "Both" }] }, queues: [{ queueId, percentage: "" }] });
    rule("A", first);
    rule("B", second);
    // The sample environment starts with Hit-first; Hit-all is what the admin center sets on a new ruleset.
    setHitPolicy(admin, ws, "all");
    expect(hitPolicyOf(routeToQueueRuleset(sim.store, ws))).toBe("all");
    const result = await call({ SelectedMenuItem: "Both" });
    expect(result.queue?.name).toBe("First match");
    expect(result.steps.find((s) => s.what === "Route to queues")!.detail).toContain("The rule “A” matches. The rule “B” matches too and isn't used");
    setHitPolicy(admin, ws, "first");
    expect(hitPolicyOf(routeToQueueRuleset(sim.store, ws))).toBe("first");
    expect((await call({ SelectedMenuItem: "Both" })).queue?.name).toBe("First match");
  });
});

describe("work classification", () => {
  test("a ruleset's rule sets Priority Score, and a route-to-queue rule uses it", async () => {
    const { admin, ws, queue, call, sim } = setup();
    const vip = queue("Priority callers");
    const rulesetId = createClassificationRuleset(admin, ws, { name: "Priority", description: "Who goes first" });
    saveClassificationRule(admin, ws, rulesetId, { name: "Returns are urgent", conditions: { logic: "AND", items: [{ field: MENU, operator: "==", value: "Returns" }] }, outputs: [{ field: PRIORITY_SCORE, value: "20" }] });
    saveRouteRule(admin, ws, { name: "High priority", conditions: { logic: "AND", items: [{ field: PRIORITY_SCORE, operator: ">=", value: "10" }] }, queues: [{ queueId: vip, percentage: "" }] });
    // Put the priority rule first, so it wins under Hit-all.
    const rules = rulesOf(routeToQueueRuleset(sim.store, ws));
    for (let i = 0; i < rules.length; i++) moveRouteToQueueRule(admin, ws, rules[rules.length - 1].id, -1);
    const result = await call({ SelectedMenuItem: "Returns" });
    expect(result.queue?.name).toBe("Priority callers");
    expect(result.steps.find((s) => s.what === "Work classification")!.detail).toBe("The rule “Returns are urgent” matches and sets Priority Score to 20.");
    expect((await call({ SelectedMenuItem: "Sales" })).queue?.name).not.toBe("Priority callers");
  });

  test("the rulesets run in order and a later one uses a value an earlier one set", async () => {
    const { admin, ws, queue, call } = setup();
    const gold = queue("Gold");
    const first = createClassificationRuleset(admin, ws, { name: "Tier" });
    const second = createClassificationRuleset(admin, ws, { name: "Score" });
    saveClassificationRule(admin, ws, first, { name: "Gold tier", conditions: { logic: "AND", items: [{ field: MENU, operator: "==", value: "Sales" }] }, outputs: [{ field: MENU, value: "Gold" }] });
    saveClassificationRule(admin, ws, second, { name: "Gold scores", conditions: { logic: "AND", items: [{ field: MENU, operator: "==", value: "Gold" }] }, outputs: [{ field: PRIORITY_SCORE, value: "50" }] });
    saveRouteRule(admin, ws, { name: "Gold", conditions: { logic: "AND", items: [{ field: PRIORITY_SCORE, operator: ">", value: "40" }] }, queues: [{ queueId: gold, percentage: "" }] });
    const result = await call({ SelectedMenuItem: "Sales" });
    expect(result.steps.filter((s) => s.what === "Work classification").map((s) => s.detail)).toEqual([
      "The rule “Gold tier” matches and sets SelectedMenuItem to Gold.",
      "The rule “Gold scores” matches and sets Priority Score to 50."
    ]);
    // In the other order, Score runs before Tier sets Gold, so nothing scores 50.
    moveClassificationRuleset(admin, ws, second, -1);
    const after = await call({ SelectedMenuItem: "Sales" });
    expect(after.steps.filter((s) => s.what === "Work classification").map((s) => s.detail)).toEqual(["The rule “Gold tier” matches and sets SelectedMenuItem to Gold."]);
  });

  test("outputs: at least one, up to five, each attribute once, with a value", () => {
    const { admin, ws } = setup();
    const id = createClassificationRuleset(admin, ws, { name: "Checks" });
    const save = (outputs: { field: string; value: string }[]) => () => saveClassificationRule(admin, ws, id, { name: "r", conditions: { logic: "AND", items: [] }, outputs });
    expect(save([])).toThrow("Add an attribute in Output");
    expect(save([{ field: PRIORITY_SCORE, value: "1" }, { field: PRIORITY_SCORE, value: "2" }])).toThrow("We found some duplicate attributes.");
    expect(save([{ field: PRIORITY_SCORE, value: "" }])).toThrow("Enter the value Priority Score is set to.");
    expect(save([{ field: "liveworkitemcontext.", value: "x" }])).toThrow("Select an attribute in each Output row.");
  });

  test("a ruleset can be deleted, and the workstream allows up to ten", () => {
    const { admin, ws, sim } = setup();
    const ids = Array.from({ length: 10 }, (_, i) => createClassificationRuleset(admin, ws, { name: `Set ${i + 1}` }));
    expect(() => createClassificationRuleset(admin, ws, { name: "Eleven" })).toThrow("up to 10");
    deleteClassificationRuleset(admin, ws, ids[0]);
    expect(classificationRulesets(sim.store, ws).map((r) => r.msdyn_name)[0]).toBe("Set 2");
    expect(sim.store.find("msdyn_decisionruleset", ids[0])).toBeUndefined();
  });
});
