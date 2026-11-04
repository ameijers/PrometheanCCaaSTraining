// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The export to the Toolbox's CSV templates (manual 9.5): build every ready-made exercise with its reference
// solution, export, and read each file back the way the Toolbox reads it.
import { ColumnDef, readRows } from "@toolbox/shared/src/columns";
import { parseCsv } from "@toolbox/voice-workstream-builder/src/csv";
import { validateProfiles } from "@toolbox/profile-builder/src/plan";
import { COLUMNS as QUEUE_COLUMNS } from "@toolbox/queue-builder/src/template";
import { COLUMNS as MEMBERSHIP_COLUMNS } from "@toolbox/queue-membership/src/template";
import { COLUMNS as RULE_COLUMNS } from "@toolbox/route-to-queue-builder/src/template";
import { COLUMNS as SKILL_COLUMNS } from "@toolbox/skill-assignment/src/template";
import { COLUMNS as UNIT_COLUMNS } from "@toolbox/business-unit-builder/src/template";
import { COLUMNS as TEAM_COLUMNS } from "@toolbox/team-builder/src/template";
import { COLUMNS as USER_COLUMNS } from "@toolbox/user-setup/src/template";
import { exportDesign } from "../../src/export/toolboxExport";
import { solve } from "../../src/scenarios/goals";
import { Scenario } from "../../src/scenarios/scenario";
import { createSimulator } from "../../src/simulator";
import readyMade from "../../content/scenarios/ready-made.json";

const start = createSimulator();
const sim = createSimulator();
const admin = { api: sim.api, store: sim.store };
const built = (readyMade.scenarios as unknown as Scenario[]).filter((s) => s.kind === "build");
for (const s of built) for (const g of s.goals ?? []) solve(admin, g);
const result = exportDesign(sim.store, start.store);
const fileFor = (name: string) => result.files.find((f) => f.fileName === name);

const COLUMNS: Record<string, [ColumnDef[], string]> = {
  "advanced-queues.csv": [QUEUE_COLUMNS, "queue_name"],
  "queue-membership.csv": [MEMBERSHIP_COLUMNS, "user"],
  "route-to-queue.csv": [RULE_COLUMNS, "workstream_name"],
  "skills.csv": [SKILL_COLUMNS, "user"],
  "business-units.csv": [UNIT_COLUMNS, "name"],
  "teams.csv": [TEAM_COLUMNS, "team_name"],
  "users.csv": [USER_COLUMNS, "user"]
};

describe("export to the Toolbox's CSV templates", () => {
  test("nothing to export when nothing was built", () => {
    expect(exportDesign(start.store, createSimulator().store).files).toEqual([]);
  });

  test.each(Object.entries(COLUMNS))("%s reads back without problems in the Toolbox", (name, [columns, key]) => {
    const f = fileFor(name);
    expect(f).toBeDefined();
    const read = readRows(parseCsv(f!.csv), columns, key);
    for (const row of read.rows) {
      for (const c of columns) {
        if (c.choices) row.choice(c.header);
        if (c.required) expect(row.cell(c.header)).not.toBe("");
      }
    }
    expect(read.issues).toEqual([]);
  });

  test("the outbound profile passes Profile Builder's own checks", () => {
    const parsed = validateProfiles(parseCsv(fileFor("outbound-profiles.csv")!.csv));
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(parsed.workstreams.map((w) => [w.name, w.outboundQueue])).toEqual([["Billing Outbound", "Billing"]]);
  });

  test("what the exercises built is in the files", () => {
    expect(fileFor("advanced-queues.csv")!.csv).toContain("Warranty,Voice,Least active");
    expect(fileFor("business-units.csv")!.csv).toContain("Contoso Parts,Contoso");
    expect(fileFor("teams.csv")!.csv).toContain("Parts Support,Owner,Contoso Parts");
    expect(fileFor("skills.csv")!.csv).toMatch(/Returns:Intermediate/);
  });

  test("what the templates can't carry is listed instead", () => {
    expect(result.notExported.some((n) => n.startsWith("Skill attachment rules on “Customer Service – Voice”"))).toBe(true);
    expect(result.notExported.some((n) => n.startsWith("The Default skill matching algorithm"))).toBe(true);
  });
});
