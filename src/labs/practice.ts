// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import type { Goal } from "../scenarios/goals";
import { Fault, Scenario } from "../scenarios/scenario";
import { LABS } from "./labs";

// Which labs an exercise draws on, worked out from what's in it, so ready-made and AI-written exercises
// are placed the same way: a build or interview exercise by its goals, a fix exercise by its faults, a
// "where does this call go?" exercise by what its calls depend on. An exercise suits a learner after the
// highest of those labs.

// The lab that teaches each goal of the build exercises (src/scenarios/goals.ts).
export const GOAL_LAB: Record<Goal["type"], number> = {
  "new-line": 3, fallback: 3, members: 4, "assignment-method": 5, capacity: 5, "choice-queue": 7, skills: 8,
  "operation-hours": 9, "after-hours": 9, "long-wait": 9, "outbound-profile": 10, "business-unit": 11, team: 11
};

// The lab that teaches what each planted fault breaks.
export const FAULT_LAB: Record<Fault["type"], number> = { "fallback-queue-off": 3, "no-members": 4, "rule-queue-off": 7 };

// The lab a "where does this call go?" exercise needs at each level.
const ROUTE_LEVEL_LAB: Record<number, number> = { 1: 1, 2: 6, 3: 9 };

export function labsOf(s: Scenario): number[] {
  const labs = new Set<number>();
  for (const g of s.goals ?? []) labs.add(GOAL_LAB[g.type]);
  for (const f of s.faults ?? []) labs.add(FAULT_LAB[f.type]);
  if (s.kind === "route") {
    // By the exercise's level (level 2 is "routing rules and IVR choices", level 3 "operating hours and
    // overflow"); a call at a set time or into a wait needs hours and overflow at any level.
    labs.add(ROUTE_LEVEL_LAB[s.level] ?? 1);
    if (s.questions?.some((q) => q.at || q.queue)) labs.add(9);
  }
  // Finding out what a customer needs before building it is lab 11's subject.
  if (s.kind === "interview") labs.add(11);
  if (!labs.size) labs.add(1);
  return [...labs].sort((a, b) => a - b);
}

export const readyAfter = (s: Scenario): number => Math.max(...labsOf(s));

// The lab subjects an exercise covers, in words: "Workstreams, Queues and representatives".
export const subjectsOf = (s: Scenario): string =>
  labsOf(s).map((n) => LABS.find((l) => l.number === n)?.title).filter(Boolean).join(", ");
