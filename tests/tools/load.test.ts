// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Manual phase 2: every Toolbox tool loads without an error. Each test calls what the tool's App.tsx
// calls when it opens, against the training environment. (The pages themselves are checked in the
// browser by scripts/screenshot-tools.js.)
import { loadGraph, loadLiveRows } from "@toolbox/environment-3d-explorer/src/dataverse";
import { loadRoutingModel } from "@toolbox/visual-routing-tester/src/dataverse";
import { loadDefinitions, loadRecentWorkItems, loadWorkstreams } from "@toolbox/context-variable-monitor/src/dataverse";
import { loadAgentRoster, loadAllRoles, loadCurrentUserDomain } from "@toolbox/agent-readiness-checker/src/dataverse";
import { dataverseSource as artifactSource } from "@toolbox/environment-artifact-finder/src/dataverse";
import { scanEnvironment } from "@toolbox/environment-artifact-finder/src/scan";
import { dataverseSource as copierSource } from "@toolbox/assignment-method-copier/src/dataverse";
import { dataverseSource as numberSource } from "@toolbox/phone-number-changer/src/dataverse";
import { dataverseSource as recordingSource } from "@toolbox/voice-recording-provisioner/src/dataverse";
import { dataverseSource as unitSource } from "@toolbox/business-unit-builder/src/dataverse";
import { dataverseSource as queueSource } from "@toolbox/queue-builder/src/dataverse";
import { dataverseSource as voiceSource } from "@toolbox/voice-workstream-builder/src/dataverse";
import { dataverseSource as routeSource } from "@toolbox/route-to-queue-builder/src/dataverse";
import { dataverseSource as voicemailSource } from "@toolbox/voicemail-builder/src/dataverse";
import { source as teamSource } from "@toolbox/team-builder/src/dataverse";
import { source as userSource } from "@toolbox/user-setup/src/dataverse";
import { source as membershipSource } from "@toolbox/queue-membership/src/dataverse";
import { source as skillSource } from "@toolbox/skill-assignment/src/dataverse";
import { source as capacitySource } from "@toolbox/capacity-profile-assignment/src/dataverse";
import { createSimulator } from "../../src/simulator";
import { installGlobalXrm } from "../simulator/helpers";

// Anything the simulator couldn't answer shows up in a tool's warnings with one of these.
const SIMULATOR_GAP = /Simulator:|Could not find a property|was not found in the MetadataCache|isn't supported/;

beforeAll(() => {
  const sim = createSimulator({ realFetch: async () => { throw new Error("no real network in tests"); } });
  installGlobalXrm(sim.xrm);
  (globalThis as any).fetch = sim.fetch;
});

describe("every tool loads", () => {
  test("Environment Diagram, 3D Explorer and 3D Contact Center (loadGraph, loadLiveRows)", async () => {
    const graph = await loadGraph();
    expect(graph.warnings).toEqual([]);
    expect(graph.nodes.length).toBeGreaterThan(100);
    await loadLiveRows(graph, new Date(Date.now() - 3600_000).toISOString());
  });

  test("Visual Routing Tester", async () => {
    const model = await loadRoutingModel();
    expect(model.warnings.filter((w) => SIMULATOR_GAP.test(w))).toEqual([]);
    expect(model.workstreams.length).toBeGreaterThan(0);
  });

  test("Context Variable Monitor", async () => {
    const workstreams = await loadWorkstreams();
    expect(workstreams.length).toBeGreaterThan(0);
    await loadDefinitions(workstreams[0].id);
    await loadRecentWorkItems(workstreams[0].id);
  });

  test("Agent Readiness Checker", async () => {
    const [roles] = await Promise.all([loadAllRoles(), loadCurrentUserDomain()]);
    const agentRoles = roles.filter((r) => /omnichannel/i.test(r.name)).map((r) => r.roleId);
    const { agents } = await loadAgentRoster(agentRoles);
    expect(Array.isArray(agents)).toBe(true);
  });

  test("Environment Artifact Finder", async () => {
    const snapshot = await scanEnvironment(artifactSource);
    const problems = JSON.stringify(snapshot).match(new RegExp(`"[^"]*(${SIMULATOR_GAP.source})[^"]*"`, "g")) ?? [];
    expect(problems).toEqual([]);
  });

  test("Queue Assignment Method Copier, Phone Number Changer, Recording & Transcription", async () => {
    expect((await copierSource.loadQueues()).length).toBeGreaterThan(0);
    expect((await numberSource.load()).channels.length).toBeGreaterThan(0);
    expect((await recordingSource.loadChannels()).length).toBeGreaterThan(0);
  });

  test("the bulk tools' catalogs", async () => {
    await Promise.all([
      unitSource.loadCatalog(), queueSource.loadCatalog(), voiceSource.loadCatalog(), routeSource.loadCatalog(), voicemailSource.loadCatalog(),
      teamSource.loadCatalog(), userSource.loadCatalog(), membershipSource.loadCatalog(), skillSource.loadCatalog(), capacitySource.loadCatalog()
    ]);
  });
});
