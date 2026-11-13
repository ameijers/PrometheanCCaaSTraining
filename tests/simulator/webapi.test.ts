// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { createSimulator, SIMULATED_URL } from "../../src/simulator";
import { FORMATTED, LOOKUP_TABLE } from "../../src/simulator/webapi";
import { Store } from "../../src/simulator/store";
import { demoSeed } from "../../src/simulator/seeds/demo";

const sim = createSimulator({ rows: demoSeed(), realFetch: async () => { throw new Error("no real network in tests"); } });
const Q = (name: string) => sim.store.table("queue").find((q) => q.name === name)!.queueid as string;

describe("reads", () => {
  it("filters with and, or, eq, ne, null, comparisons and functions", () => {
    const names = (query: string) => sim.api.retrieveMultiple("queue", query).entities.map((e) => e.name).sort();
    expect(names("?$select=name&$filter=name eq 'billing'")).toEqual(["Billing"]); // text compares ignore case
    expect(names("?$select=name&$filter=startswith(name,'Tier') and _msdyn_operatinghourid_value eq null")).toEqual(["Tier 1 Support", "Tier 2 Support"]);
    expect(names(`?$select=name&$filter=queueid eq {${Q("Sales").toUpperCase()}} or contains(name,'desk')`)).toEqual(["Dutch Desk", "Order Desk", "Partner Desk", "Sales"]);
    expect(names("?$select=name&$filter=not (msdyn_queuetype ne 192350000)")).toEqual(["Chat Sales", "Chat Support", "Social Media"]);
  });

  it("orders, limits and pages", () => {
    const top = sim.api.retrieveMultiple("queue", "?$select=name&$orderby=name desc&$top=2");
    expect(top.entities.map((e) => e.name)).toEqual(["Tier 2 Support", "Tier 1 Support"]);
    expect(top.nextLink).toBeUndefined();
    const first = sim.api.retrieveMultiple("queue", "?$select=name", 4);
    expect(first.entities).toHaveLength(4);
    expect(first.nextLink).toMatch(new RegExp(`^${SIMULATED_URL}/api/data/v9.2/queues\\?\\$select=name&\\$skiptoken=4$`));
  });

  it("returns lookups as _x_value with annotations, also when selected by their logical name", () => {
    const [sales] = sim.api.retrieveMultiple("queue", "?$select=name,msdyn_operatinghourid&$filter=name eq 'Sales'").entities;
    expect(sales._msdyn_operatinghourid_value).toMatch(/^[0-9a-f-]{36}$/);
    expect(sales[`_msdyn_operatinghourid_value${FORMATTED}`]).toBe("Business hours");
    expect(sales[`_msdyn_operatinghourid_value${LOOKUP_TABLE}`]).toBe("msdyn_operatinghour");
    expect(sales.queueid).toBe(Q("Sales"));
  });

  it("expands single-valued navigation with its own $select", () => {
    const [skill] = sim.api.retrieveMultiple("bookableresourcecharacteristic", "?$select=_resource_value&$expand=Characteristic($select=name),RatingValue($select=name,value)&$top=1").entities;
    expect(skill.Characteristic).toEqual({ characteristicid: expect.any(String), name: expect.any(String) });
    expect(skill.RatingValue).toEqual({ ratingvalueid: expect.any(String), name: expect.any(String), value: expect.any(Number) });
  });

  it("answers EntityDefinitions from the schema", () => {
    const [def] = sim.api.retrieveMultiple("EntityDefinitions", "?$select=LogicalName,EntitySetName&$filter=LogicalName eq 'msdyn_liveworkstream'").entities;
    expect(def).toMatchObject({ LogicalName: "msdyn_liveworkstream", EntitySetName: "msdyn_liveworkstreams" });
  });

  it("answers fetch to the simulated address, and passes other addresses on", async () => {
    const response = await sim.fetch(`${SIMULATED_URL}/api/data/v9.2/queues?$select=name&$filter=name eq 'Sales'`);
    expect(response.status).toBe(200);
    expect((await response.json()).value.map((v: any) => v.name)).toEqual(["Sales"]);
    await expect(sim.fetch("https://learn.microsoft.com/")).rejects.toThrow("no real network in tests");
  });
});

describe("errors in Dataverse's shape", () => {
  it("rejects an unknown column the way Dataverse does", async () => {
    await expect(sim.xrm.WebApi.retrieveMultipleRecords("queue", "?$select=nosuchcolumn"))
      .rejects.toThrow("Could not find a property named 'nosuchcolumn' on type 'Microsoft.Dynamics.CRM.queue'.");
  });

  it("rejects an unknown table and a missing record", async () => {
    await expect(sim.xrm.WebApi.retrieveMultipleRecords("nosuchtable", "")).rejects.toThrow(/nosuchtable/);
    await expect(sim.xrm.WebApi.retrieveRecord("queue", "00000000-0000-4000-8000-0000000000ff")).rejects.toThrow(/Does Not Exist/);
  });

  it("returns { error: { code, message } } from fetch", async () => {
    const response = await sim.fetch(`${SIMULATED_URL}/api/data/v9.2/queues?$select=nosuchcolumn`);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({ code: expect.any(String), message: expect.stringContaining("nosuchcolumn") });
  });
});

describe("anything not supported fails loudly", () => {
  const cases: [string, string, RegExp][] = [
    ["$apply", "?$apply=groupby((name))", /\$apply isn't supported yet/],
    ["$count", "?$count=true", /\$count isn't supported yet/],
    ["fetchXml", "?fetchXml=<fetch/>", /fetchXml isn't supported yet/],
    ["a lambda", "?$filter=queue_membership/any(m: m/systemuserid ne null)", /isn't supported yet/],
    ["a related-table filter", "?$filter=msdyn_operatinghourid/msdyn_name eq 'x'", /related table/],
    ["an unknown function", "?$filter=endswithx(name,'x')", /endswithx\(\) isn't supported yet/],
    ["$filter inside $expand", "?$expand=msdyn_operatinghourid($filter=statecode eq 0)", /\$filter inside \$expand/]
  ];
  it.each(cases)("%s", async (_what, query, message) => {
    await expect(sim.xrm.WebApi.retrieveMultipleRecords("queue", query)).rejects.toThrow(message);
  });

  it("functions and actions the Toolbox doesn't call", async () => {
    // LocalTimeFromUtcTime comes with the simulated clock (phase 3); the routing tester copes without it.
    const response = await sim.fetch(`${SIMULATED_URL}/api/data/v9.2/LocalTimeFromUtcTime(UtcTime=2026-11-02T10:00:00Z,TimeZoneCode=110)`);
    expect(response.status).toBe(501);
    expect((await response.json()).error.message).toMatch(/isn't supported yet.*request: GET/);
    const action = await sim.fetch(`${SIMULATED_URL}/api/data/v9.2/teams(${Q("Sales")})/Microsoft.Dynamics.CRM.RemoveMembersTeam`, { method: "POST", body: "{}" });
    expect(action.status).toBe(501);
  });
});

describe("writes", () => {
  const api = `${SIMULATED_URL}/api/data/v9.2`;
  const user = () => sim.store.table("systemuser")[0].systemuserid as string;

  it("creates with @odata.bind, and reads the record back", async () => {
    const hours = sim.store.table("msdyn_operatinghour")[0].msdyn_operatinghourid;
    const { id } = await sim.xrm.WebApi.createRecord("queue", { name: "Created", msdyn_queuetype: 192350002, "msdyn_operatinghourid@odata.bind": `/msdyn_operatinghours(${hours})` });
    const row = await sim.xrm.WebApi.retrieveRecord("queue", id, "?$select=name,_msdyn_operatinghourid_value,statecode");
    expect(row).toMatchObject({ name: "Created", _msdyn_operatinghourid_value: hours, statecode: 0 });
  });

  it("refuses unknown columns, wrong types and binds to missing records", async () => {
    await expect(sim.xrm.WebApi.createRecord("queue", { nosuch: 1 })).rejects.toThrow("Invalid property 'nosuch' was found in entity 'Microsoft.Dynamics.CRM.queue'.");
    await expect(sim.xrm.WebApi.createRecord("queue", { name: 5 })).rejects.toThrow(/Cannot convert the literal '5'/);
    await expect(sim.xrm.WebApi.createRecord("queue", { "msdyn_operatinghourid@odata.bind": "/msdyn_operatinghours(00000000-0000-4000-8000-0000000000ff)" }))
      .rejects.toThrow(/Does Not Exist/);
    // Dataverse's navigation property names are case-sensitive: bookableresource's is UserId.
    await expect(sim.xrm.WebApi.createRecord("bookableresource", { name: "X", "userid@odata.bind": `/systemusers(${user()})` })).rejects.toThrow(/Invalid property 'userid'/);
  });

  it("updates with PATCH and If-Match, and won't create a missing record that way", async () => {
    const ok = await sim.fetch(`${api}/queues(${Q("Sales")})`, { method: "PATCH", headers: { "If-Match": "*" }, body: JSON.stringify({ msdyn_priority: 3 }) });
    expect(ok.status).toBe(204);
    expect(sim.store.find("queue", Q("Sales"))!.msdyn_priority).toBe(3);
    const missing = await sim.fetch(`${api}/queues(00000000-0000-4000-8000-0000000000ff)`, { method: "PATCH", headers: { "If-Match": "*" }, body: "{}" });
    expect(missing.status).toBe(404);
  });

  it("returns the new record's address in OData-EntityId", async () => {
    const response = await sim.fetch(`${api}/queues`, { method: "POST", body: JSON.stringify({ name: "Posted" }) });
    expect(response.status).toBe(204);
    expect(response.headers.get("OData-EntityId")).toMatch(new RegExp(`^${api.replace(/\./g, "\\.")}/queues\\([0-9a-f-]{36}\\)$`));
  });

  it("associates with $ref once, and removes the link again", async () => {
    const body = JSON.stringify({ "@odata.id": `${api}/systemusers(${user()})` });
    const url = `${api}/queues(${Q("Billing")})/queuemembership_association/$ref`;
    const before = sim.store.table("queuemembership").length;
    expect((await sim.fetch(url, { method: "POST", body })).status).toBe(204);
    expect(sim.store.table("queuemembership").length).toBe(before + 1);
    const again = await sim.fetch(url, { method: "POST", body });
    expect(again.status).toBe(400);
    expect((await again.json()).error.message).toBe("Cannot insert duplicate key.");
    expect((await sim.fetch(`${api}/queues(${Q("Billing")})/queuemembership_association(${user()})/$ref`, { method: "DELETE" })).status).toBe(204);
    expect(sim.store.table("queuemembership").length).toBe(before);
  });

  it("adds team members with AddMembersTeam", async () => {
    const team = sim.store.table("team")[0].teamid;
    const response = await sim.fetch(`${api}/teams(${team})/Microsoft.Dynamics.CRM.AddMembersTeam`, {
      method: "POST", body: JSON.stringify({ Members: [{ "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: user() }] })
    });
    expect(response.status).toBe(204);
    expect(sim.store.table("teammembership").some((m) => m.teamid === team && m.systemuserid === user())).toBe(true);
  });
});

describe("what the platform does on its own (rules.ts)", () => {
  it("gives a new business unit a default team and its own security roles", async () => {
    const root = sim.store.table("businessunit").find((u) => !u._parentbusinessunitid_value)!.businessunitid;
    sim.store.insert("role", { name: "Basic User", _businessunitid_value: root });
    const { id } = await sim.xrm.WebApi.createRecord("businessunit", { name: "New unit", "parentbusinessunitid@odata.bind": `/businessunits(${root})` });
    expect(sim.store.table("team").filter((t) => t._businessunitid_value === id && t.isdefault)).toHaveLength(1);
    expect(sim.store.table("role").filter((r) => r._businessunitid_value === id).map((r) => r.name)).toContain("Basic User");
  });

  it("gives a new workstream a routing contract, and adds new context variables to it", async () => {
    const { id } = await sim.xrm.WebApi.createRecord("msdyn_liveworkstream", { msdyn_name: "New line", msdyn_streamsource: 192440000 });
    const contractId = sim.store.find("msdyn_liveworkstream", id)!._msdyn_routingcontractid_value;
    expect(contractId).toBeTruthy();
    await sim.xrm.WebApi.createRecord("msdyn_ocliveworkstreamcontextvariable", { msdyn_name: "Menu", "msdyn_liveworkstreamid@odata.bind": `/msdyn_liveworkstreams(${id})` });
    expect(sim.store.find("msdyn_decisioncontract", contractId)!.msdyn_contractdefinition).toContain('<variable name="Menu"');
  });

  it("fills in No for yes/no columns a create leaves out", async () => {
    const { id } = await sim.xrm.WebApi.createRecord("team", { name: "Plain" });
    expect(sim.store.find("team", id)).toMatchObject({ isdefault: false });
  });
});

describe("sessions", () => {
  it("saves to a file and loads it back", () => {
    const file = JSON.parse(JSON.stringify(sim.store.toFile()));
    const copy = new Store(Store.readFile(file));
    expect(copy.count()).toBe(sim.store.count());
    expect(() => Store.readFile({ hello: 1 })).toThrow("isn't a saved training session");
  });
});
