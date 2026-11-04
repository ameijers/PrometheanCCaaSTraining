# The Toolbox's Web API surface

Every Web API call the Promethean CCaaS Toolbox makes, which the simulator has to answer. Made by `npm run surface` from the Toolbox at commit `{{COMMIT}}` ({{TOTAL}} calls). Run it again after moving the submodule. The summary below is kept by hand, and the list after it is generated.

## Summary

### How the Toolbox calls the Web API

- **`Xrm.WebApi.retrieveMultipleRecords(logicalName, "?query")`** is used for almost every read, mostly through a `readAll` that follows `@odata.nextLink`. It takes the logical name (`queue`), not the entity set name (`queues`).
- **`Xrm.WebApi.retrieveRecord`**: one call, `systemuser` with `$select=domainname` (Agent Readiness Checker).
- **`Xrm.WebApi.createRecord` / `updateRecord`** are used by the bulk tools. `@odata.bind` names a navigation property, and those names are case-sensitive (`UserId`, `Resource`, `msdyn_capacityProfile_id`, `msdyn_masterentityroutingconfigurationId`).
- **`fetch(<clientUrl>/api/data/v9.2/…)`** is used for:
  - `$ref` associations: `queues(id)/queuemembership_association/$ref`, `teams(id)/teamroles_association/$ref`, `systemusers(id)/systemuserroles_association/$ref`;
  - the bound action `teams(id)/Microsoft.Dynamics.CRM.AddMembersTeam`;
  - the function `LocalTimeFromUtcTime(UtcTime=…,TimeZoneCode=…)`, in Visual Routing Tester;
  - `POST` and `PATCH` to entity sets, in Route-to-Queue Builder, Voicemail Builder and Queue Assignment Method Copier, because `Xrm.WebApi.createRecord` refused those tables;
  - `EntityDefinitions(LogicalName='…')?$expand=ManyToOneRelationships(…)`, in Environment Artifact Finder.
- **`EntityDefinitions`** is also read through `retrieveMultipleRecords` with `$filter=LogicalName eq '…'`, by Visual Routing Tester and Context Variable Monitor.

### OData the Toolbox uses

| Feature | Used as | Simulator |
| --- | --- | --- |
| `$select` | columns, including a lookup by its logical name (`msdyn_inqueueoverflowrulesetid`), which comes back as `_x_value` | yes |
| `$filter` | `eq`, `ne`, `ge`, `and`, `or`, brackets; GUIDs bare, text in quotes, `true`/`false`, `null`, numbers, an ISO date-time (`createdon ge 2026-…Z`) | yes, plus `gt`, `lt`, `le`, `not`, `contains`, `startswith`, `endswith` |
| `$expand` | single-valued navigation with its own `$select` (`msdyn_defaultqueue`, `Characteristic`, `RatingValue`, `msdyn_currentpresenceid`, `msdyn_capacityprofileid`), and one collection (`calendar_calendar_rules`) | yes |
| `$orderby` | `name asc`, `createdon desc`, `msdyn_steporder` | yes |
| `$top` | Context Variable Monitor | yes |
| Paging | `@odata.nextLink`, followed by `readAll` | yes (`$skiptoken`) |
| Formatted values | `msdyn_overflowactiontype@OData.Community.Display.V1.FormattedValue`, `msdyn_assignmentstrategy@…`, `msdyn_assignedto@…` | lookups always; option sets where the Toolbox states the labels |
| Writes | create, update (PATCH with `If-Match: *`), `@odata.bind`, `OData-EntityId` | yes, with Dataverse's errors for unknown columns, wrong types and binds to missing records |
| `$ref` | `queuemembership_association`, `teamroles_association`, `systemuserroles_association` | yes, POST and DELETE; a second identical link gives "Cannot insert duplicate key." |
| Actions | `AddMembersTeam` | yes |
| Functions | `LocalTimeFromUtcTime` | not yet: it comes with the simulated clock (phase 3). Visual Routing Tester carries on without it. |
| Anything else (`$apply`, `$count`, `fetchXml`, lambdas, filters on related tables, `$filter` inside `$expand`) | not used | fails loudly: `Simulator: … isn't supported yet` |

### Tables

The simulator's tables and columns are in [src/simulator/schema.ts](../src/simulator/schema.ts). It covers every table and column the Toolbox reads or writes. A column that isn't there fails the way Dataverse does (`Could not find a property named '…'` on reads, `Invalid property '…'` on writes). Environment Artifact Finder also asks for nine tables the simulator doesn't have yet (notification templates, saved views and others); it reports them as not in this environment and carries on.

What the platform does by itself when a record is written is in [src/simulator/rules.ts](../src/simulator/rules.ts), each with its source: a new business unit gets a default team and its own security roles, a new workstream gets a routing contract, and a new context variable is added to that contract.

### Found while building the simulator

- **Visual Routing Tester and Context Variable Monitor read one page per query.** Their own `read()` doesn't follow `@odata.nextLink`. That's fine below Dataverse's page size of 5000 rows. The routing-model test therefore uses the normal page size.
- **The demo data in `environment-3d-explorer/src/demoData.ts` writes rule conditions as `operator="equals"`.** Route-to-Queue Builder writes `operator="=="`, and Visual Routing Tester reads `==` but warns about `equals`. The training's seed writes `==` (`src/simulator/seeds/demo.ts`). A fix in the Toolbox's demo data would remove that step.
- **The demo data's phone numbers (`+31 20 555 …`) aren't in a fiction range.** The seed swaps them for Ofcom drama numbers (`+44 20 7946 0100` onwards).
- **The example CSVs use `+31201234567` and `+31201234568`**, which aren't fiction numbers either (Voice Workstream Builder and Profile Builder). The tests run them with Ofcom drama numbers instead (`tests/fixtures/examples.ts`). The tools' own sample data has two more (`+31207654321`, `+13159956114`).
- **The Voice Workstream Builder and Profile Builder examples both create "Callbacks – Outbound"**, so they can't both run in the same environment. The test runs Profile Builder's example on a fresh environment.
- **The recording and transcription modes are written as text** (`"192351002"`), not as numbers (`voice-workstream-builder/src/recordingSettings.ts`).
