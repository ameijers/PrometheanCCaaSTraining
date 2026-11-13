// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The trainer's progress cell: how far a learner is, and when they may be stuck.
import { ago, cellOf, describe as words, STUCK_AFTER_MS } from "../../src/classroom/ProgressCell";
import { Progress } from "../../src/classroom/client";

const NOW = Date.parse("2026-11-13T10:00:00Z");
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const base: Progress = { learnerId: "x", name: "Sam", scenarioId: "lab-queues-people", title: "Lab 4", checks: [], done: false, hints: 0, updatedOn: at(1) };

test("a lab's fraction is the average of Learn and Do", () => {
  const p = { ...base, parts: { learn: { read: 5, pages: 5, done: true }, do: { passed: 3, tasks: 6, done: false }, challenge: { done: 0, of: 1 } } };
  expect(cellOf(p, NOW)).toEqual({ state: "working", fraction: 0.75 });
  expect(words(p, NOW)).toContain("Do: 3 of 6 tasks");
});

test("on the same thing for over ten minutes, and still around: may be stuck", () => {
  const stuck = { ...base, current: { title: "Add at least two users", since: at(STUCK_AFTER_MS / 60_000 + 2) } };
  expect(cellOf(stuck, NOW).state).toBe("stuck");
  // Gone for over half an hour: away, not stuck.
  expect(cellOf({ ...stuck, updatedOn: at(45) }, NOW).state).toBe("working");
  expect(cellOf({ ...stuck, done: true }, NOW).state).toBe("done");
  expect(words(stuck, NOW)).toContain("Now on: Add at least two users (12 min)");
});

test("an exercise counts its checks; nothing yet is none", () => {
  expect(cellOf({ ...base, checks: [{ title: "a", passed: true }, { title: "b", passed: false }] }, NOW).fraction).toBe(0.5);
  expect(cellOf(undefined, NOW)).toEqual({ state: "none", fraction: 0 });
  expect([ago(at(0), NOW), ago(at(7), NOW), ago(at(130), NOW)]).toEqual(["just now", "7 min ago", "2 h ago"]);
});
