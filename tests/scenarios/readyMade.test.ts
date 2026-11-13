// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The ready-made scenarios pass every check in manual 8.3, the same ones an AI-written scenario must
// pass, and the healthy environment they start from has nothing wrong in it.
import { createSimulator } from "../../src/simulator";
import { healthySeed } from "../../src/simulator/seeds/healthy";
import { healthIssues } from "../../src/scenarios/grade";
import { LEVELS, Scenario } from "../../src/scenarios/scenario";
import { validateScenario } from "../../src/scenarios/validate";
import readyMade from "../../content/scenarios/ready-made.json";
import { installGlobalXrm } from "../simulator/helpers";

const scenarios = readyMade.scenarios as Scenario[];

test("the healthy environment has no problems and no warnings", async () => {
  installGlobalXrm(createSimulator({ rows: healthySeed() }).xrm);
  const { graph, found } = await healthIssues();
  expect(found.map((f) => `${f.issue.check} on ${f.name}`)).toEqual([]);
  expect(graph.warnings ?? []).toEqual([]);
});

describe.each(scenarios.map((s) => [s.id, s] as const))("ready-made scenario %s", (_, s) => {
  test("passes every check", async () => {
    expect(await validateScenario(s)).toEqual([]);
  });
});

test("every kind and level has a ready-made scenario", () => {
  for (const [kind, levels] of Object.entries(LEVELS)) for (const level of levels) expect(scenarios.some((s) => s.kind === kind && s.level === level)).toBe(true);
});
