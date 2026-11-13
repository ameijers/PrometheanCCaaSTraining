// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Manual 2.5 and 4.5: the Toolbox's tools as a test bench for the simulator (learners never see them).
// Each bulk tool's write code, tested live against Dataverse, runs its own example CSV to the end against
// the simulator, and the results show up in the Toolbox's own graph. The tools run one after the other,
// so later examples build on what earlier ones created.
//
// Each step does what the tool's App.tsx does: load the catalog, parse the CSV, plan, run.
import * as fs from "fs";
import * as path from "path";
import { buildGraph } from "@toolbox/environment-3d-explorer/src/graph";
import { loadRaw } from "@toolbox/environment-3d-explorer/src/dataverse";
import { parseCsv } from "@toolbox/voice-workstream-builder/src/csv";
import { runPlan } from "@toolbox/shared/src/runner";
import * as bu from "@toolbox/business-unit-builder/src/dataverse";
import { buildPlan as buildUnitPlan } from "@toolbox/business-unit-builder/src/plan";
import { executePlan as runUnits } from "@toolbox/business-unit-builder/src/execute";
import * as teams from "@toolbox/team-builder/src/dataverse";
import { buildTeamPlan } from "@toolbox/team-builder/src/plan";
import * as users from "@toolbox/user-setup/src/dataverse";
import { buildUserPlan } from "@toolbox/user-setup/src/plan";
import * as qb from "@toolbox/queue-builder/src/dataverse";
import { validateCsv as validateQueues } from "@toolbox/queue-builder/src/validate";
import { resolvePlan as resolveQueues } from "@toolbox/queue-builder/src/resolve";
import { executePlan as runQueues } from "@toolbox/queue-builder/src/execute";
import * as members from "@toolbox/queue-membership/src/dataverse";
import { buildMembershipPlan } from "@toolbox/queue-membership/src/plan";
import * as skills from "@toolbox/skill-assignment/src/dataverse";
import { buildCsvPlan as buildSkillPlan } from "@toolbox/skill-assignment/src/plan";
import * as capacity from "@toolbox/capacity-profile-assignment/src/dataverse";
import { buildCsvPlan as buildCapacityPlan } from "@toolbox/capacity-profile-assignment/src/plan";
import * as voice from "@toolbox/voice-workstream-builder/src/dataverse";
import { validateCsv as validateWorkstreams } from "@toolbox/voice-workstream-builder/src/validate";
import { resolvePlan as resolveWorkstreams } from "@toolbox/voice-workstream-builder/src/resolve";
import { executePlan as runWorkstreams } from "@toolbox/voice-workstream-builder/src/execute";
import { addChannels, resolveChannelPlan, validateChannels } from "@toolbox/voice-channel-builder/src/plan";
import { resolveProfiles, validateProfiles } from "@toolbox/profile-builder/src/plan";
import * as routes from "@toolbox/route-to-queue-builder/src/dataverse";
import { resolvePlan as resolveRoutes, validateCsv as validateRoutes } from "@toolbox/route-to-queue-builder/src/plan";
import { executePlan as runRoutes } from "@toolbox/route-to-queue-builder/src/execute";
import * as voicemail from "@toolbox/voicemail-builder/src/dataverse";
import { resolvePlan as resolveVoicemail, validateCsv as validateVoicemail } from "@toolbox/voicemail-builder/src/plan";
import { executePlan as runVoicemail } from "@toolbox/voicemail-builder/src/execute";
import { createSimulator, Simulator } from "../../src/simulator";
import { fictionExample } from "../fixtures/examples";
import { examplesSeed } from "../fixtures/exampleSupport";

import { installGlobalXrm } from "../simulator/helpers";

let sim: Simulator;
let counter = 0;
const newId = () => `0000e0e0-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

beforeAll(() => {
  sim = createSimulator({ rows: examplesSeed(), realFetch: async () => { throw new Error("no real network in tests"); } });
  installGlobalXrm(sim.xrm);
  // Toolbox code calls fetch for $ref, actions and some creates.
  (globalThis as any).fetch = sim.fetch;
});

const errorsOf = (issues: { severity: string; message: string; line?: number }[]) =>
  issues.filter((i) => i.severity === "error").map((i) => `line ${i.line ?? "-"}: ${i.message}`);

// A run is done when nothing failed or stopped part-way.
const failuresOf = (results: unknown) => {
  const text = JSON.stringify(results);
  const bad = text.match(/"(status|outcome)":"(failed|partial)"[^}]*/g) ?? [];
  return bad;
};

const TOOLS = path.resolve(__dirname, "../../vendor/toolbox/tools");
const csv = (tool: string) => {
  const dir = path.join(TOOLS, tool, "examples");
  return parseCsv(fictionExample(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8")));
};
const count = (table: string) => sim.store.table(table).length;

describe("each bulk tool runs its example CSV to the end", () => {
  test("Business Units Builder", async () => {
    const before = count("businessunit");
    const plan = buildUnitPlan(csv("business-unit-builder"), await bu.dataverseSource.loadCatalog());
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runUnits(plan, bu.dataverseSource))).toEqual([]);
    expect(count("businessunit")).toBeGreaterThan(before);
  });

  test("Team Builder", async () => {
    const plan = buildTeamPlan(csv("team-builder"), await teams.source.loadCatalog(), teams.writer);
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runPlan(plan))).toEqual([]);
  });

  test("User Setup", async () => {
    const plan = buildUserPlan(csv("user-setup"), await users.source.loadCatalog(), users.writer);
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runPlan(plan))).toEqual([]);
  });

  test("Queue Builder", async () => {
    const plan = resolveQueues(validateQueues(csv("queue-builder")), await qb.dataverseSource.loadCatalog());
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runQueues(plan, qb.dataverseSource))).toEqual([]);
  });

  test("Queue Membership", async () => {
    const plan = buildMembershipPlan(csv("queue-membership"), await members.source.loadCatalog(), members.writer);
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runPlan(plan))).toEqual([]);
  });

  test("Skill Assignment", async () => {
    const plan = buildSkillPlan(csv("skill-assignment"), await skills.source.loadCatalog(), skills.writer);
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runPlan(plan))).toEqual([]);
  });

  test("Capacity Profile Assignment", async () => {
    const plan = buildCapacityPlan(csv("capacity-profile-assignment"), await capacity.source.loadCatalog(), capacity.writer);
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runPlan(plan))).toEqual([]);
  });

  test("Voice Workstream Builder", async () => {
    const plan = resolveWorkstreams(validateWorkstreams(csv("voice-workstream-builder")), await voice.dataverseSource.loadCatalog());
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runWorkstreams(plan, voice.dataverseSource))).toEqual([]);
  });

  test("Voice Channel Builder", async () => {
    const before = count("msdyn_ocvoicechannelsetting");
    const plan = resolveChannelPlan(validateChannels(csv("voice-channel-builder")), await voice.dataverseSource.loadCatalog());
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await addChannels(plan, voice.dataverseSource))).toEqual([]);
    expect(count("msdyn_ocvoicechannelsetting")).toBe(before + 3);
  });

  test("Profile Builder (in an environment of its own)", async () => {
    // Its example and Voice Workstream Builder's both create "Callbacks – Outbound", so it runs on a fresh
    // training environment.
    const own = createSimulator({ rows: examplesSeed(), realFetch: async () => { throw new Error("no real network in tests"); } });
    installGlobalXrm(own.xrm);
    (globalThis as any).fetch = own.fetch;
    try {
      const plan = resolveProfiles(validateProfiles(csv("profile-builder")), await voice.dataverseSource.loadCatalog());
      expect(errorsOf(plan.issues)).toEqual([]);
      expect(failuresOf(await runWorkstreams(plan, voice.dataverseSource))).toEqual([]);
    } finally {
      installGlobalXrm(sim.xrm);
      (globalThis as any).fetch = sim.fetch;
    }
  });

  test("Route-to-Queue Builder", async () => {
    const settings = { variable: "SelectedMenuItem", defaultRulesetName: "Route to queue" };
    const plan = resolveRoutes(validateRoutes(csv("route-to-queue-builder")), await routes.dataverseSource.loadCatalog(), settings);
    expect(errorsOf(plan.issues)).toEqual([]);
    const results = await runRoutes(plan, routes.dataverseSource, { newId, pollMs: 1, sleep: async () => undefined } as any);
    expect(failuresOf(results)).toEqual([]);
  });

  test("Voicemail Builder", async () => {
    const settings = { existingRules: "skip" as const, assignmentMethod: "Highest capacity" as const };
    const plan = resolveVoicemail(validateVoicemail(csv("voicemail-builder")), await voicemail.dataverseSource.loadCatalog(), settings);
    expect(errorsOf(plan.issues)).toEqual([]);
    expect(failuresOf(await runVoicemail(plan, voicemail.dataverseSource, newId))).toEqual([]);
  });

  test("the Environment Diagram's graph shows what the tools made", async () => {
    const graph = buildGraph(await loadRaw());
    const named = (kind: string, name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name);
    // Queues (Queue Builder, Voicemail Builder) and workstreams (Voice Workstream Builder).
    for (const name of ["Sales – NL", "Support – Overflow", "Sales – Voice Voicemail Queue"]) expect(named("queue", name)).toBeDefined();
    for (const name of ["Sales – Voice", "Support – Voice", "Claims – Voice"]) expect(named("workstream", name)).toBeDefined();
    // Members (Queue Builder, Queue Membership) as agents in their queue.
    const anna = named("agent", "Anna de Vries")!;
    const salesNl = named("queue", "Sales – NL")!;
    expect(graph.edges.some((e) => e.kind === "member" && [e.from, e.to].includes(anna.key) && [e.from, e.to].includes(salesNl.key))).toBe(true);
    // Route-to-Queue Builder's rules on "Billing – Voice" route to "Billing".
    expect(graph.nodes.some((n) => n.kind === "rule" && n.name.includes("Route to invoices"))).toBe(true);
    // Business units without agents aren't drawn, so check the table.
    expect(sim.store.table("businessunit").map((u) => u.name)).toEqual(expect.arrayContaining(["Contact Center", "Contact Center NL", "Sales – Partners"]));
  });
});

test("every example CSV in the Toolbox is covered", () => {
  const tools = path.resolve(__dirname, "../../vendor/toolbox/tools");
  const withExamples = fs.readdirSync(tools).filter((t) => fs.existsSync(path.join(tools, t, "examples"))).sort();
  expect(withExamples).toEqual([
    "business-unit-builder", "capacity-profile-assignment", "profile-builder", "queue-builder", "queue-membership", "route-to-queue-builder",
    "skill-assignment", "team-builder", "user-setup", "voice-channel-builder", "voice-workstream-builder", "voicemail-builder"
  ]);
});
