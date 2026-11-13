// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// AI-written scenarios kept in content/scenarios/generated (scripts/ai-generate-live.js, npm run ai:generate)
// keep passing every check of manual 8.3 with the current code, like the ready-made ones.
import * as fs from "fs";
import * as path from "path";
import { Scenario } from "../../src/scenarios/scenario";
import { validateScenario } from "../../src/scenarios/validate";

const dir = path.join(__dirname, "../../content/scenarios/generated");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];

test("there are AI-written scenarios to check", () => expect(files.length).toBeGreaterThan(0));

describe.each(files.map((f) => [f]))("AI-written scenario %s", (f) => {
  test("passes every check", async () => {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Scenario;
    expect(s.source).toBe("ai");
    expect(await validateScenario(s)).toEqual([]);
  });
});
