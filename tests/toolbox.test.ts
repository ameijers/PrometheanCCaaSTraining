// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Proves the @toolbox alias works: Toolbox code runs from the submodule, unchanged.
import { buildGraph } from "@toolbox/environment-3d-explorer/src/graph";
import { demoRaw } from "@toolbox/environment-3d-explorer/src/demoData";

describe("Toolbox through @toolbox", () => {
  it("builds the demo contact center graph", () => {
    const graph = buildGraph(demoRaw());
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    const kinds = new Set(graph.nodes.map((n) => n.kind));
    for (const kind of ["phone", "channel", "workstream", "queue", "agent"]) expect(kinds).toContain(kind);
  });
});
