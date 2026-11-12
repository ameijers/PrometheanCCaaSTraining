// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The labs: their content holds together (concepts, quiz answers, challenges), and each ready lab's
// hands-on part can be done the way a learner does it, task by task.
import { addUsers, createQueue } from "../../src/admin/actions";
import { placeCall } from "../../src/calls/engine";
import { Routing } from "../../src/calls/routing";
import { LABS, labById, labLesson, labStatuses, labValues, doDoneId, learnDoneId, quizPassed } from "../../src/labs/labs";
import { record, runChecks } from "../../src/lessons/checks";
import { createSimulator } from "../../src/simulator";
import concepts from "../../content/concepts.json";
import readyMade from "../../content/scenarios/ready-made.json";
import { installGlobalXrm } from "../simulator/helpers";

const conceptIds = new Set(concepts.concepts.map((c) => c.id));
const scenarioIds = new Set(readyMade.scenarios.map((s) => s.id));

describe("lab content", () => {
  test("labs are numbered 1 to 11 in order, and every reference exists", () => {
    expect(LABS.map((l) => l.number)).toEqual(LABS.map((_, i) => i + 1));
    for (const lab of LABS) {
      for (const page of lab.learn ?? []) for (const c of page.concepts ?? []) expect(conceptIds).toContain(c);
      for (const q of lab.quiz ?? []) expect(q.answer).toBeLessThan(q.options.length);
      for (const s of lab.challenges ?? []) expect(scenarioIds).toContain(s);
      if (lab.status === "ready") {
        expect(lab.learn?.length).toBeGreaterThan(0);
        expect(lab.quiz?.length).toBeGreaterThan(0);
        expect(lab.do).toBeDefined();
      }
    }
  });

  test("the recommended next lab is the first ready lab that isn't done", () => {
    const [first, , , fourth] = LABS;
    expect(labStatuses([]).get(first.id)).toBe("next");
    expect(labStatuses([]).get(fourth.id)).toBe("open");
    expect(labStatuses([]).get("numbers")).toBe("planned");
    const s = labStatuses([learnDoneId(first), doDoneId(first), learnDoneId(fourth)]);
    expect([s.get(first.id), s.get(fourth.id), s.get("routing")]).toEqual(["done", "next", "open"]);
  });

  test("the quiz passes only with every answer right", () => {
    const lab = labById("orientation")!;
    const right = Object.fromEntries(lab.quiz!.map((q) => [q.id, q.answer]));
    expect(quizPassed(lab, right)).toBe(true);
    expect(quizPassed(lab, { ...right, [lab.quiz![0].id]: right[lab.quiz![0].id] + 1 })).toBe(false);
  });
});

function setup() {
  const sim = createSimulator();
  installGlobalXrm(sim.xrm);
  return { sim, store: sim.store, admin: { api: sim.api, store: sim.store }, routing: new Routing(sim.store) };
}

describe("lab 1: follow a call", () => {
  test("every task can be done, and a wrong answer says so", async () => {
    const { store } = setup();
    const lesson = labLesson(labById("orientation")!, store, 1);
    const v = labValues(store);
    expect(lesson.tasks[0].title).toBe(`Call the ${v.line} and choose ${v.choice1}`);
    const done = async () => Object.entries(await runChecks(store, lesson)).filter(([, r]) => r.passed).map(([k]) => k);
    expect(await done()).toEqual([]);

    await placeCall(store, { dial: v.dial, answers: { [v.variable]: v.value1 } });
    record(store, "answer:which-workstream", v.workstream);
    record(store, "answer:which-queue", "Overflow");
    const wrong = await runChecks(store, lesson);
    expect(wrong["which-queue"]).toEqual({ passed: false, note: "“Overflow” isn't it. Look again." });

    record(store, "answer:which-queue", v.queue1);
    record(store, "seen:diagram");
    await placeCall(store, { dial: v.dial, answers: { [v.variable]: v.value2 } });
    record(store, "answer:second-queue", v.queue2);
    expect(await done()).toEqual(lesson.tasks.map((t) => t.id));
  });
});

describe("lab 4: a queue and a call of your own", () => {
  test("the representative the lab names is the one who gets the call", async () => {
    const { store, admin, routing } = setup();
    const lesson = labLesson(labById("queues-people")!, store, 1);
    const v = labValues(store);
    const done = async () => Object.entries(await runChecks(store, lesson)).filter(([, r]) => r.passed).map(([k]) => k);

    record(store, "answer:count-members", v.members1);
    const queueId = createQueue(admin, { name: "Priority Customer", type: "Voice", priority: 1 });
    addUsers(admin, queueId, store.table("systemuser").filter((u) => u.accessmode === 0).slice(0, 2).map((u) => u.systemuserid));
    expect(await done()).toEqual(["count-members", "create-queue", "add-users"]);
    expect((await runChecks(store, lesson))["create-queue"].note).toMatch(/Priority Customer/);

    // Signed in as the named representative, the call is offered to them.
    const rep = store.table("systemuser").find((u) => u.fullname === v.rep)!;
    routing.signInAs(rep.systemuserid);
    const call = await placeCall(store, { dial: v.dial, answers: { [v.variable]: v.value1 } }, { record: true, now: new Date(Date.UTC(2026, 10, 3, 10, 0)), routing });
    expect(routing.offers.has(call.workItemId!)).toBe(true);
    record(store, `did:ready:${v.queue1}`);
    record(store, "did:accept-call");
    record(store, "did:close-session");
    expect(await done()).toEqual(lesson.tasks.map((t) => t.id));
  });
});

describe("lab 7: route-to-queue rules", () => {
  test("its hands-on part is the new menu choice lesson", () => {
    const { store } = setup();
    const lesson = labLesson(labById("routing")!, store, 1);
    expect(lesson.id).toBe("lab-routing");
    expect(lesson.tasks.map((t) => t.id)).toEqual(["see-problem", "create-queue", "add-users", "add-rule", "test-call"]);
  });
});
