// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Manual 4.5 "Same picture both ways": the Toolbox's own loadRaw(), reading the simulator, must give
// the same graph as buildGraph() on the demo rows directly.
import { loadLiveRows, loadRaw } from "@toolbox/environment-3d-explorer/src/dataverse";
import { demoRaw } from "@toolbox/environment-3d-explorer/src/demoData";
import { buildGraph } from "@toolbox/environment-3d-explorer/src/graph";
import { findIssues } from "@toolbox/environment-3d-explorer/src/health";
import { Graph } from "@toolbox/environment-3d-explorer/src/model";
import { createSimulator } from "../../src/simulator";
import { demoSeed, forTraining } from "../../src/simulator/seeds/demo";
import { installGlobalXrm } from "./helpers";

const sorted = (graph: Graph) => ({
  ...graph,
  nodes: [...graph.nodes].sort((a, b) => a.key.localeCompare(b.key)),
  edges: [...graph.edges].sort((a, b) => `${a.from}|${a.to}|${a.kind}|${a.label}`.localeCompare(`${b.from}|${b.to}|${b.kind}|${b.label}`))
});

describe("same picture both ways", () => {
  // A small page size, so readAll's @odata.nextLink paging runs too.
  const sim = createSimulator({ rows: demoSeed(), pageSize: 7 });
  beforeAll(() => installGlobalXrm(sim.xrm));

  it("loadRaw against the simulator builds the demo graph", async () => {
    const raw = await loadRaw();
    expect(raw.warnings).toEqual([]);
    expect(raw.unread).toEqual([]);
    const expected = buildGraph(forTraining(demoRaw()));
    expect(sorted(buildGraph(raw))).toEqual(sorted(expected));
  });

  it("the health checks find the same problems", async () => {
    const fromSimulator = findIssues(buildGraph(await loadRaw())).map((i) => i.title).sort();
    const direct = findIssues(buildGraph(forTraining(demoRaw()))).map((i) => i.title).sort();
    expect(fromSimulator).toEqual(direct);
    expect(fromSimulator.length).toBeGreaterThan(0);
  });

  it("uses only numbers from a fiction range", async () => {
    const raw = await loadRaw();
    for (const p of raw.phoneNumbers) expect(p.msdyn_phonenumber).toMatch(/^\+44 20 7946 0\d{3}$/);
  });

  it("live rows read without errors (no calls yet)", async () => {
    const graph = buildGraph(await loadRaw());
    const live = await loadLiveRows(graph, "2026-11-02T00:00:00Z");
    expect(live.agentStatuses).toEqual([]);
    expect(live.conversations).toEqual([]);
  });
});
