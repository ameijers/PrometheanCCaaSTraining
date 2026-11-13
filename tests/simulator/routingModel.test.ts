// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Manual 4.5 "Routing model": the Visual Routing Tester's own loadRoutingModel() runs against the
// simulator and gives the model the demo seed describes.
import { demoRaw } from "@toolbox/environment-3d-explorer/src/demoData";
import { VOICE_STREAM } from "@toolbox/environment-3d-explorer/src/graph";
import { loadRoutingModel } from "@toolbox/visual-routing-tester/src/dataverse";
import { simulate } from "@toolbox/visual-routing-tester/src/evaluator";
import { RoutingModel } from "@toolbox/visual-routing-tester/src/model";
import { createSimulator } from "../../src/simulator";
import { demoSeed } from "../../src/simulator/seeds/demo";
import { installGlobalXrm } from "./helpers";

describe("routing model", () => {
  const raw = demoRaw();
  const queueByName = new Map(raw.queues.map((q) => [q.name as string, q.queueid as string]));
  const queueName = new Map(raw.queues.map((q) => [q.queueid as string, q.name as string]));
  let model: RoutingModel;

  beforeAll(async () => {
    // Dataverse's page size: the routing tester reads one page per query and doesn't follow
    // @odata.nextLink, which is fine below 5000 rows.
    installGlobalXrm(createSimulator({ rows: demoSeed() }).xrm);
    model = await loadRoutingModel();
  });

  it("has every inbound voice workstream with its rules and fallback queue", () => {
    const voice = raw.workstreams.filter((w) => w.msdyn_streamsource === VOICE_STREAM && !w.msdyn_direction);
    expect(model.workstreams.map((w) => w.name).sort()).toEqual(voice.map((w) => w.msdyn_name).sort());
    for (const ws of model.workstreams) {
      expect(ws.fallbackQueueId).toBe(queueByName.get("Overflow"));
      expect(ws.queueRoutingRules.length).toBeGreaterThan(0);
      expect(ws.variables.map((v) => v.id).sort()).toEqual(["CustomerLanguage", "SelectedMenuItem"]);
    }
    const service = model.workstreams.find((w) => w.name === "Customer Service – Voice")!;
    expect(service.queueRoutingRules.map((r) => [r.name, queueName.get(r.targets[0].queueId!)])).toEqual([
      ["Billing", "Billing"], ["Returns", "Returns"], ["Technical", "Tier 1 Support"], ["Complaints", "Escalations"]
    ]);
  });

  it("reads overflow rules with their outcomes", () => {
    const queue = (name: string) => model.queues.find((q) => q.name === name)!;
    expect(queue("Sales").preQueueOverflowRules.map((r) => [r.trigger, r.outcome])).toEqual([["Operatinghour", "Voicemail"], ["Estimatedwaittime", "Callback"]]);
    expect(queue("Tier 1 Support").inQueueOverflowRules.map((r) => [r.outcome, r.targetQueueId])).toEqual([["Queue Transfer", queueByName.get("Tier 2 Support")]]);
  });

  it("warns only about the problem planted in the demo (a rule to a deleted queue)", () => {
    expect(model.warnings).toHaveLength(1);
    expect(model.warnings[0]).toMatch(/Resellers.*was not found/);
  });

  it("routes a call the way the demo's rules say", () => {
    const service = model.workstreams.find((w) => w.name === "Customer Service – Voice")!;
    const billing = simulate(service, model, { SelectedMenuItem: "Billing" });
    expect(billing.steps.find((s) => s.kind === "queue")?.label).toBe("Billing");
    const other = simulate(service, model, { SelectedMenuItem: "Something else" });
    expect(other.steps.find((s) => s.kind === "queue")?.label).toBe("Overflow");
  });
});
