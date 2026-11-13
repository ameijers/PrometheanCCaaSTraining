// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Manual 9.4b and 8.3: every variant of a lesson template is played through by code before a learner can
// get it. Each line with an IVR, with each menu choice it allows: nothing is done at the start, everything
// is done after the steps a learner takes, and no {placeholder} is left unfilled.
import { addRouteToQueueRule, addUsers, createQueue } from "../../src/admin/actions";
import { placeCall } from "../../src/calls/engine";
import { runChecks } from "../../src/lessons/checks";
import { choicesFor, linesWithIvr, LessonTemplate, makeLesson } from "../../src/lessons/template";
import { createSimulator } from "../../src/simulator";
import templateJson from "../../content/lessons/new-menu-choice.json";
import { installGlobalXrm } from "../simulator/helpers";

const template = templateJson as LessonTemplate;

const variants = (() => {
  const store = createSimulator().store;
  return linesWithIvr(store).flatMap((line) => choicesFor(template, line, store).map((choice) => [line.workstream, choice] as [string, string]));
})();

test("there are lines with an IVR, and enough variants", () => {
  expect(new Set(variants.map(([w]) => w))).toEqual(new Set(["Customer Service – Voice", "Retail Sales – Voice", "Technical Support – Voice"]));
  expect(variants.length).toBeGreaterThanOrEqual(12);
});

test("seeds spread over the lines and choices", () => {
  const store = createSimulator().store;
  const picked = new Set(Array.from({ length: 40 }, (_, seed) => makeLesson(template, store, seed)).map((l) => `${l.variant!.workstream}|${l.variant!.choice}`));
  expect(picked.size).toBeGreaterThan(10);
});

test("the same seed gives the same variant", () => {
  const store = createSimulator().store;
  expect(makeLesson(template, store, 42)).toEqual(makeLesson(template, store, 42));
});

describe.each(variants)("%s, new choice %s", (workstream, choice) => {
  test("can be finished, step by step", async () => {
    const sim = createSimulator();
    installGlobalXrm(sim.xrm);
    const admin = { api: sim.api, store: sim.store };
    const lesson = makeLesson(template, sim.store, 7, { workstream, choice });
    const text = JSON.stringify(lesson);
    expect(text).not.toMatch(/\{(choice|line|dial|workstream|menu|variable|suggested|fallback)\}/);
    const done = async () => Object.entries(await runChecks(sim.store, lesson)).filter(([, r]) => r.passed).map(([k]) => k);
    const answers = { [lesson.line.ivr!.variable]: choice };

    expect(await done()).toEqual([]);
    const first = await placeCall(sim.store, { dial: lesson.line.dial, answers });
    expect(first.queue).toBeDefined();
    expect(await done()).toEqual(["see-problem"]);

    const queueId = createQueue(admin, { name: choice, type: "Voice", priority: 1 });
    const someone = [...new Set(sim.store.table("queuemembership").map((m) => m.systemuserid))].slice(0, 2);
    addUsers(admin, queueId, someone);
    expect(await done()).toEqual(["see-problem", "create-queue", "add-users"]);

    const wsId = sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === workstream)!.msdyn_liveworkstreamid;
    addRouteToQueueRule(admin, wsId, { name: choice, variable: lesson.line.ivr!.variable, value: choice, queueId });
    const second = await placeCall(sim.store, { dial: lesson.line.dial, answers });
    expect(second.queue?.name).toBe(choice);
    expect(await done()).toEqual(lesson.tasks.map((t) => t.id));
  });
});
