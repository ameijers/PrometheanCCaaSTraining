// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Practice by lab: each exercise is placed after the last lab it needs, worked out from its goals,
// faults or calls (src/labs/practice.ts).
import { GOAL_TYPES } from "../../src/scenarios/goals";
import { FAULT_TYPES, Scenario } from "../../src/scenarios/scenario";
import { FAULT_LAB, GOAL_LAB, labsOf, readyAfter, subjectsOf } from "../../src/labs/practice";
import { LABS } from "../../src/labs/labs";
import readyMade from "../../content/scenarios/ready-made.json";

const all = readyMade.scenarios as Scenario[];
const after = (id: string) => readyAfter(all.find((s) => s.id === id)!);

test("every goal and fault type belongs to a lab", () => {
  for (const g of GOAL_TYPES) expect(LABS.map((l) => l.number)).toContain(GOAL_LAB[g]);
  for (const f of FAULT_TYPES) expect(LABS.map((l) => l.number)).toContain(FAULT_LAB[f]);
});

test("the ready-made exercises land after the lab they need", () => {
  expect(Object.fromEntries(all.map((s) => [s.id, readyAfter(s)]))).toEqual({
    "route-1-first-day": 1,
    "fix-1-monday-morning": 4, "build-1-safety-nets": 4, "build-5-spare-parts-line": 4,
    "build-4-spread-the-work": 5,
    "route-2-the-menu": 6,
    "fix-2-after-the-reorganisation": 7, "build-2-warranty": 7,
    "build-4-returns-skills": 8,
    "route-3-late-and-long": 9, "build-3-evenings": 9,
    "build-5-billing-callbacks": 10,
    "build-5-parts-onboarding": 11, "interview-2-warranty": 11, "interview-4-busy-support": 11
  });
});

test("an exercise says which subjects it covers", () => {
  expect(labsOf(all.find((s) => s.id === "build-1-safety-nets")!)).toEqual([3, 4]);
  expect(subjectsOf(all.find((s) => s.id === "build-1-safety-nets")!)).toBe("Workstreams, Queues and representatives");
  expect(after("route-3-late-and-long")).toBe(9);
});
