// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import * as path from "path";
import { chooseProvider } from "./ai/choose";
import { savedScenarios, writeScenario } from "./ai/scenarios";
import { LEVELS, ScenarioKind } from "../../src/scenarios/scenario";
import { ROOT, settings } from "./settings";

// npm run ai:generate -- 10
// Has the AI write scenarios across every kind and level, each checked by code (manual 8.3) and sent
// back up to three times. The ones that pass are saved in content/scenarios/generated, for a person to
// look at before they're committed. Phase 5 is done when 10 of them pass.

const GENERATED = path.join(ROOT, "content/scenarios/generated");

async function main(): Promise<void> {
  const { provider: ai, off } = chooseProvider(settings);
  if (!ai) {
    console.log(`The AI is off: ${off}.`);
    process.exit(2);
  }
  console.log(`Writing with ${ai.name}.\n`);
  const wanted = Number(process.argv[2] ?? 10);
  const plan = (Object.entries(LEVELS) as [ScenarioKind, number[]][]).flatMap(([kind, levels]) => levels.map((level) => ({ kind, level })));
  let passed = 0;
  for (let i = 0; i < wanted; i++) {
    const { kind, level } = plan[i % plan.length];
    const avoid = savedScenarios(GENERATED).filter((s) => s.kind === kind && s.level === level).map((s) => s.title);
    try {
      const written = await writeScenario(ai, kind, level, { avoid, saveDir: GENERATED });
      if (written.scenario) passed++;
      const tries = written.attempts.length;
      console.log(written.scenario
        ? `pass  ${kind} level ${level}  “${written.scenario.title}” (${tries === 1 ? "first try" : `after ${tries} tries`})`
        : `drop  ${kind} level ${level}  failed ${tries} times:\n${written.attempts.map((a, n) => `        ${n + 1}. ${a.problems.join(" | ")}`).join("\n")}`);
      for (const [n, a] of written.attempts.entries()) if (written.scenario && a.problems.length) console.log(`        try ${n + 1}: ${a.problems.join(" | ")}`);
    } catch (e) {
      console.log(`error ${kind} level ${level}  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n${passed} of ${wanted} scenarios passed every check. Saved in content/scenarios/generated.`);
  process.exit(passed === wanted ? 0 : 1);
}

void main();
