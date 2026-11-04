// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The first lesson, solved the way a learner does it: through the admin center's actions and the phone.
// Every task's check must be off before its step and on after it.
import { loadRaw } from "@toolbox/environment-3d-explorer/src/dataverse";
import { buildGraph } from "@toolbox/environment-3d-explorer/src/graph";
import { addRouteToQueueRule, addUsers, createQueue } from "../../src/admin/actions";
import { placeCall } from "../../src/calls/engine";
import { Lesson, runChecks } from "../../src/lessons/checks";
import { createSimulator } from "../../src/simulator";
import templateJson from "../../content/lessons/new-menu-choice.json";
import { LessonTemplate, makeLesson } from "../../src/lessons/template";
import concepts from "../../content/concepts.json";
import { installGlobalXrm } from "../simulator/helpers";

// The variant these tests know: the customer service line, with Repairs as the new choice.
const lesson: Lesson = makeLesson(templateJson as LessonTemplate, createSimulator().store, 1, { workstream: "Customer Service – Voice", choice: "Repairs" });

describe("lesson: A new menu choice", () => {
  const sim = createSimulator();
  const admin = { api: sim.api, store: sim.store };
  beforeAll(() => installGlobalXrm(sim.xrm));
  const done = async () => Object.entries(await runChecks(sim.store, lesson)).filter(([, v]) => v.passed).map(([k]) => k);
  const repairs = { dial: lesson.line.dial, answers: { SelectedMenuItem: "Repairs" } };
  const workstreamId = () => sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice")!.msdyn_liveworkstreamid;

  test("nothing is done at the start", async () => {
    expect(await done()).toEqual([]);
  });

  test("1. a Repairs call ends in the fallback queue", async () => {
    const call = await placeCall(sim.store, repairs);
    expect(call.queue?.name).toBe("Overflow");
    expect(call.steps.map((s) => s.what)).toEqual(["Phone number", "Voice channel", "Workstream", "IVR", "Route to queues", "Queue", "Outcome"]);
    expect(call.steps.find((s) => s.what === "Route to queues")!.detail).toMatch(/fallback queue/);
    expect(await done()).toEqual(["see-problem"]);
  });

  test("2. create the Repairs voice queue", async () => {
    createQueue(admin, { name: "Repairs", type: "Voice", priority: 1 });
    expect(await done()).toEqual(["see-problem", "create-queue"]);
  });

  test("3. add two users", async () => {
    const tier1 = sim.store.table("queue").find((q) => q.name === "Tier 1 Support")!.queueid;
    const users = sim.store.table("queuemembership").filter((m) => m.queueid === tier1).slice(0, 2).map((m) => m.systemuserid);
    const queueId = sim.store.table("queue").find((q) => q.name === "Repairs")!.queueid;
    addUsers(admin, queueId, users);
    expect(await done()).toEqual(["see-problem", "create-queue", "add-users"]);
  });

  test("4. add the route-to-queue rule", async () => {
    const queueId = sim.store.table("queue").find((q) => q.name === "Repairs")!.queueid;
    addRouteToQueueRule(admin, workstreamId(), { name: "Repairs", variable: "SelectedMenuItem", value: "Repairs", queueId });
    expect(await done()).toEqual(["see-problem", "create-queue", "add-users", "add-rule"]);
  });

  test("5. a new call reaches Repairs, and every task is done", async () => {
    const call = await placeCall(sim.store, repairs);
    expect(call.queue).toMatchObject({ name: "Repairs", members: 2 });
    expect(call.steps.find((s) => s.what === "Route to queues")!.detail).toBe("The rule “Repairs” matches.");
    expect(await done()).toEqual(lesson.tasks.map((t) => t.id));
  });

  test("the Toolbox's own graph shows the new route, and the waiting call is a live work item", async () => {
    const graph = buildGraph(await loadRaw());
    const queue = graph.nodes.find((n) => n.kind === "queue" && n.name === "Repairs")!;
    expect(graph.edges.some((e) => e.kind === "routes" && e.to === queue.key)).toBe(true);
    expect(sim.store.table("msdyn_ocliveworkitem").filter((w) => w.statecode === 0)).toHaveLength(2);
  });

  test("other menu choices still go where they went", async () => {
    expect((await placeCall(sim.store, { dial: lesson.line.dial, answers: { SelectedMenuItem: "Billing" } }, { record: false })).queue?.name).toBe("Billing");
  });
});

describe("the lesson's content", () => {
  const sim = createSimulator();

  test("its line, IVR variable and options exist in the training environment", () => {
    const ws = sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === lesson.line.ivr!.workstream)!;
    expect(ws).toBeDefined();
    const variables = sim.store.table("msdyn_ocliveworkstreamcontextvariable").filter((v) => v._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid).map((v) => v.msdyn_name);
    expect(variables).toContain(lesson.line.ivr!.variable);
  });

  test("every task explains itself with a concept that quotes Learn, with link and date", () => {
    const byId = new Map(concepts.concepts.map((c) => [c.id, c]));
    for (const task of lesson.tasks) {
      const concept = byId.get(task.concept);
      expect(concept).toBeDefined();
      expect(concept!.learn.url).toMatch(/^https:\/\/learn\.microsoft\.com\//);
      expect(concept!.learn.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(concept!.learn.quote.length).toBeGreaterThan(40);
      expect(task.hints.length).toBeGreaterThan(0);
    }
  });

  test("agents have names a learner can tell apart", () => {
    const names = sim.store.table("systemuser").map((u) => u.fullname);
    expect(new Set(names).size).toBe(names.length);
  });
});
