# The Toolbox's Web API surface

Every Web API call the Promethean CCaaS Toolbox makes, which the simulator has to answer. Made by `npm run surface` from the Toolbox at commit `dc98157` (186 calls). Run it again after moving the submodule. The summary below is kept by hand, and the list after it is generated.

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

## Every call, per tool

### agent-readiness-checker

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:55 | retrieveMultipleRecords | logicalName, query |
| src/dataverse.ts:82 | readAll | logicalName, `?${selectAndExpand}&$filter=${filter}` |
| src/dataverse.ts:200 | readAll | "msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,statecode,msdyn_direction,msdyn_enablevoicev2,msdyn_capacityrequired,msdyn_capacityformat" |
| src/dataverse.ts:204 | readAll | "msdyn_liveworkstream", `?$select=msdyn_liveworkstreamid&$expand=msdyn_defaultqueue($select=queueid)&$filter=${voiceRows.map((r) => `msdyn_liveworkstreamid eq ${r.msdyn_liveworkstreamid}`).join(" or ")}` |
| src/dataverse.ts:208 | readAll | "msdyn_routingconfiguration", `?$select=msdyn_routingconfigurationid,msdyn_isactiveconfiguration&$filter=_msdyn_liveworkstreamid_value eq ${workstream.msdyn_liveworkstreamid}` |
| src/dataverse.ts:216 | readAll | "msdyn_routingconfigurationstep", `?$select=msdyn_type,_msdyn_rulesetid_value&$filter=_msdyn_routingconfigurationid_value eq ${activeConfig.msdyn_routingconfigurationid}` |
| src/dataverse.ts:226 | readAll | "msdyn_decisionruleset", `?$select=msdyn_decisionrulesetid,msdyn_rulesetdefinition&$filter=${[...new Set(rulesetIds)].map((id) => `msdyn_decisionrulesetid eq ${id}`).join(" or ")}` |
| src/dataverse.ts:289 | retrieveRecord | "systemuser", cleanGuid(userId), "?$select=domainname" |
| src/dataverse.ts:297 | readAll | "role", "?$select=roleid,name&$orderby=name asc" |
| src/dataverse.ts:312 | readAll | "queuemembership", "?$select=queueid,systemuserid" |
| src/dataverse.ts:316 | readAll | "systemuserroles", `?$select=systemuserid,roleid&$filter=${roleFilter}` |
| src/dataverse.ts:330 | readAll | "teamroles", `?$select=teamid,roleid&$filter=${roleFilter}` |
| src/dataverse.ts:333 | readAll | "teammembership", `?$select=systemuserid,teamid&$filter=${relevantTeamIds.map((id) => `teamid eq ${id}`).join(" or ")}` |
| src/dataverse.ts:356 | readByIdBatches | "systemuser", "systemuserid", candidateIds, "$select=systemuserid,fullname,domainname,isdisabled,accessmode" |
| src/dataverse.ts:364 | readByIdBatches | "systemuserroles", "systemuserid", candidateIds, "$select=systemuserid,roleid" |
| src/dataverse.ts:365 | readByIdBatches | "teammembership", "systemuserid", candidateIds, "$select=systemuserid,teamid" |
| src/dataverse.ts:367 | readByIdBatches | "teamroles", "teamid", teamIds, "$select=teamid,roleid" |
| src/dataverse.ts:380 | readByIdBatches | "role", "roleid", allInvolvedRoleIds, "$select=roleid,name" |
| src/dataverse.ts:393 | readByIdBatches | "queue", "queueid", queueIds, "$select=queueid,name,statecode" |
| src/dataverse.ts:505 | readByIdBatches | "bookableresource", "_userid_value", userIds, "$select=bookableresourceid,_userid_value" |
| src/dataverse.ts:510 | readByIdBatches |  |
| src/dataverse.ts:540 | readByIdBatches | "bookableresource", "_userid_value", userIds, "$select=bookableresourceid,_userid_value" |
| src/dataverse.ts:544 | readByIdBatches | "bookableresourcecharacteristic", "_resource_value", resourceIds, "$select=_resource_value&$expand=Characteristic($select=name),RatingValue($select=name,value)" |
| src/dataverse.ts:587 | readByIdBatches |  |

### assignment-method-copier

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:26 | readAll | QUEUE_TABLE, "?$select=queueid,name,msdyn_queuetype,msdyn_assignmentstrategy,_msdyn_assignmentinputcontractid_value&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0" |
| src/dataverse.ts:27 | readAll | METHOD_TABLE, "?$select=msdyn_assignmentconfigurationid,msdyn_name,msdyn_isactiveconfiguration,_msdyn_queueid_value&$filter=statecode eq 0" |
| src/dataverse.ts:59 | readAll | METHOD_TABLE, `?$select=msdyn_assignmentconfigurationid,msdyn_name,msdyn_description,msdyn_isactiveconfiguration,_msdyn_queueid_value&$filter=msdyn_assignmentconfigurationid eq ${methodId}` |
| src/dataverse.ts:60 | readAll | STEP_TABLE, `?$select=msdyn_assignmentconfigurationstepid,msdyn_name,msdyn_type,msdyn_steporder,msdyn_isdefaultruleset,_msdyn_rulesetid_value&$filter=_msdyn_assignmentconfigurationid_value eq ${methodId} and statecode eq… |
| src/dataverse.ts:65 | readAll | RULESET_TABLE, `?$select=msdyn_decisionrulesetid,msdyn_name,msdyn_description,msdyn_rulesetdefinition,msdyn_rulesettype,msdyn_authoringmode,msdyn_isinputcollection,msdyn_persistoutputdata,msdyn_refreshinputdata,msdyn_dis… |
| src/dataverse.ts:93 | fetch | `${base}/api/data/v9.2/${path}`, { method, credentials: "include", headers, body: JSON.stringify(body) } |
| src/dataverse.ts:105 | send | "POST", ENTITY_SETS[table], payload |
| src/dataverse.ts:115 | send | "PATCH", `${ENTITY_SETS[table]}(${recordId})`, columns |

### business-unit-builder

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:41 | retrieveMultipleRecords | logicalName, next |
| src/dataverse.ts:50 | readAll | UNIT_TABLE, "?$select=businessunitid,name,isdisabled,_parentbusinessunitid_value" |
| src/dataverse.ts:62 | createRecord | UNIT_TABLE, payload |
| src/dataverse.ts:68 | readAll | "team", `?$select=teamid&$filter=isdefault eq true and _businessunitid_value eq ${unitId}` |

### capacity-profile-assignment

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:18 | readAll | "systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode,_businessunitid_value" |
| src/dataverse.ts:19 | readAll | "businessunit", "?$select=businessunitid,name" |
| src/dataverse.ts:20 | readAll | "bookableresource", "?$select=bookableresourceid,_userid_value,statecode&$filter=resourcetype eq 3" |
| src/dataverse.ts:21 | readAll | LINK_TABLE, "?$select=_msdyn_bookableresourceid_value,_msdyn_capacityprofileid_value&$filter=statecode eq 0" |
| src/dataverse.ts:22 | readAll | "msdyn_capacityprofile", "?$select=msdyn_capacityprofileid,msdyn_name,msdyn_uniquename,msdyn_defaultmaxunits,statecode" |
| src/dataverse.ts:39 | createRecord | LINK_TABLE, payload |

### context-variable-monitor

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:38 | retrieveMultipleRecords | "EntityDefinitions", `?$select=LogicalName,EntitySetName&$filter=LogicalName eq '${logicalName}'` |
| src/dataverse.ts:69 | retrieveMultipleRecords | definition.LogicalName, query |
| src/dataverse.ts:77 | read | "msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,statecode,msdyn_direction,msdyn_enablevoicev2" |
| src/dataverse.ts:86 | read | "msdyn_ocliveworkstreamcontextvariable", `?$select=msdyn_ocliveworkstreamcontextvariableid,msdyn_name,msdyn_displayname,msdyn_datatype&$filter=_msdyn_liveworkstreamid_value eq ${workstreamId}` |
| src/dataverse.ts:98 | read | "msdyn_ocliveworkitem", `?$select=activityid,msdyn_title,createdon,statecode&$filter=_msdyn_liveworkstreamid_value eq ${workstreamId}&$orderby=createdon desc&$top=${top}` |

### environment-3d-explorer

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:17 | readAll | table, `?${select}&$filter=${ids.slice(i, i + 40).map((x) => `${idColumn} eq ${x}`).join(" or ")}` |
| src/dataverse.ts:37 | readAll | "msdyn_ocphonenumber", "?$select=msdyn_ocphonenumberid,msdyn_phonenumber,statecode,msdyn_phoneinboundenabled,msdyn_phoneoutboundenabled" |
| src/dataverse.ts:38 | readAll | "msdyn_ocvoicechannelsetting", "?$select=msdyn_ocvoicechannelsettingid,msdyn_name,_msdyn_phonenumberid_value,_msdyn_liveworkstreamid_value" |
| src/dataverse.ts:39 | readAll | "msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_streamsource,_msdyn_defaultqueue_value,_msdyn_bot_user_value&$filter=statecode eq 0" |
| src/dataverse.ts:40 | readAll | "msdyn_routingconfiguration", "?$select=msdyn_routingconfigurationid,msdyn_isactiveconfiguration,_msdyn_liveworkstreamid_value" |
| src/dataverse.ts:41 | readAll | "msdyn_routingconfigurationstep", "?$select=msdyn_type,_msdyn_routingconfigurationid_value,_msdyn_rulesetid_value" |
| src/dataverse.ts:42 | readAll | "queue", "?$select=queueid,name,msdyn_queuetype,_msdyn_prequeueoverflowrulesetid_value,_msdyn_inqueueoverflowrulesetid_value,_msdyn_operatinghourid_value&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0" |
| src/dataverse.ts:43 | readAll | "queuemembership", "?$select=queueid,systemuserid" |
| src/dataverse.ts:45 | readAll | "systemuser", "?$select=systemuserid,fullname,domainname,isdisabled,_businessunitid_value&$filter=accessmode eq 0" |
| src/dataverse.ts:46 | readAll | "msdyn_ocliveworkstreamcontextvariable", "?$select=msdyn_ocliveworkstreamcontextvariableid,msdyn_name,msdyn_datatype,_msdyn_liveworkstreamid_value" |
| src/dataverse.ts:47 | readAll | "msdyn_operatinghour", "?$select=msdyn_operatinghourid,msdyn_name" |
| src/dataverse.ts:48 | readAll | "msdyn_overflowactionconfig", "?$select=msdyn_overflowactionconfigid,msdyn_name,msdyn_overflowactiontype,msdyn_overflowactiondata" |
| src/dataverse.ts:49 | readAll | "msdyn_capacityprofile", "?$select=msdyn_capacityprofileid,msdyn_name" |
| src/dataverse.ts:50 | readAll | "msdyn_liveworkstreamcapacityprofile", "?$select=_msdyn_workstream_id_value,_msdyn_capacityprofile_id_value" |
| src/dataverse.ts:51 | readAll | "businessunit", "?$select=businessunitid,name" |
| src/dataverse.ts:52 | readAll | "team", "?$select=teamid,name,isdefault" |
| src/dataverse.ts:58 | readByIds | "msdyn_decisionruleset", "msdyn_decisionrulesetid", "$select=msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition,msdyn_disabledrules", rulesetIds |
| src/dataverse.ts:62 | readByIds | "bookableresource", "_userid_value", "$select=bookableresourceid,_userid_value", agentIds |
| src/dataverse.ts:63 | readByIds |  |
| src/dataverse.ts:72 | readByIds | "systemuser", "systemuserid", "$select=systemuserid,fullname", botIds |
| src/dataverse.ts:73 | readByIds | "msdyn_decisionruleset", "msdyn_decisionrulesetid", "$select=msdyn_decisionrulesetid,msdyn_rulesetdefinition", overflowRulesetIds |
| src/dataverse.ts:74 | readByIds | "msdyn_bookableresourcecapacityprofile", "_msdyn_bookableresourceid_value", "$select=_msdyn_bookableresourceid_value,_msdyn_capacityprofileid_value", resources.map((r) => cleanId(str(r.bookableresourceid))) |
| src/dataverse.ts:75 | readByIds | "teammembership", "systemuserid", "$select=systemuserid,teamid", agentIds |
| src/dataverse.ts:96 | readByIds | "msdyn_agentstatus", "_msdyn_agentid_value", "$select=_msdyn_agentid_value,msdyn_isagentloggedin&$expand=msdyn_currentpresenceid($select=msdyn_name,msdyn_basepresencestatus)", agentIds |
| src/dataverse.ts:97 | readAll | "msdyn_ocliveworkitem", `?$select=msdyn_ocliveworkitemid,statecode,statuscode,createdon,_msdyn_cdsqueueid_value,_msdyn_activeagentid_value,_msdyn_liveworkstreamid_value&$filter=statecode eq 0 or createdon ge ${since}` |

### environment-artifact-finder

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:63 | fetch | `${base}/api/data/v9.2/${path}`, { |
| src/dataverse.ts:77 | getJson | `EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,PrimaryIdAttribute,PrimaryNameAttribute&$expand=ManyToOneRelationships($select=ReferencingAttribute,ReferencedEntity)` |
| src/dataverse.ts:101 | retrieveMultipleRecords | logicalName, query |
| src/dataverse.ts:129 | readAll | xrm, request.logicalName, buildQuery(select, expand, filter) |

### phone-number-changer

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:50 | retrieveMultipleRecords | logicalName, next |
| src/dataverse.ts:66 | readAll | CHANNEL_TABLE, "?$select=msdyn_ocvoicechannelsettingid,msdyn_name,statecode,_msdyn_liveworkstreamid_value,_msdyn_phonenumberid_value,_msdyn_calleridphonenumberid_value" |
| src/dataverse.ts:67 | readAll | "msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_direction" |
| src/dataverse.ts:68 | readAll | "msdyn_ocphonenumber", "?$select=msdyn_ocphonenumberid,msdyn_phonenumber,statecode,msdyn_phoneinboundenabled,msdyn_phoneoutboundenabled" |
| src/dataverse.ts:113 | updateRecord | CHANNEL_TABLE, channelId, columns |

### queue-builder

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:43 | retrieveMultipleRecords | logicalName, next |
| src/dataverse.ts:59 | readAll | QUEUE_TABLE, "?$select=name" |
| src/dataverse.ts:60 | readAll | "msdyn_operatinghour", "?$select=msdyn_operatinghourid,msdyn_name&$filter=statecode eq 0" |
| src/dataverse.ts:62 | readAll | "systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled&$filter=accessmode eq 0" |
| src/dataverse.ts:72 | createRecord | QUEUE_TABLE, payload |
| src/dataverse.ts:85 | fetch | `${base}/api/data/v9.2/${QUEUE_ENTITY_SET}(${queueId})/${MEMBERSHIP_RELATIONSHIP}/$ref`, { |
| src/dataverse.ts:99 | readAll | QUEUE_TABLE, `?$select=queueid,_msdyn_assignmentinputcontractid_value&$filter=queueid eq ${queueId}` |

### queue-membership

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:16 | readAll | "systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode" |
| src/dataverse.ts:17 | readAll | "bookableresource", "?$select=bookableresourceid,_userid_value,statecode&$filter=resourcetype eq 3" |
| src/dataverse.ts:18 | readAll | "msdyn_bookableresourcecapacityprofile", "?$select=_msdyn_bookableresourceid_value" |
| src/dataverse.ts:19 | readAll | "queue", "?$select=queueid,name,msdyn_isomnichannelqueue,statecode" |
| src/dataverse.ts:20 | readAll | "queuemembership", "?$select=queueid,systemuserid" |
| src/dataverse.ts:33 | fetch | `${base}/api/data/v9.2/queues(${queueId})/queuemembership_association/$ref`, { |

### route-to-queue-builder

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:30 | readAll | table, `?$select=${select}&$filter=${chunk.map((x) => `${idColumn} eq ${x}`).join(" or ")}` |
| src/dataverse.ts:37 | readAll | WORKSTREAM_TABLE, "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_streamsource,_msdyn_routingcontractid_value&$filter=statecode eq 0" |
| src/dataverse.ts:38 | readAll | VARIABLE_TABLE, "?$select=msdyn_ocliveworkstreamcontextvariableid,msdyn_name,msdyn_datatype,_msdyn_liveworkstreamid_value" |
| src/dataverse.ts:39 | readAll | CONFIG_TABLE, "?$select=msdyn_routingconfigurationid,msdyn_name,msdyn_isactiveconfiguration,_msdyn_liveworkstreamid_value" |
| src/dataverse.ts:40 | readAll | STEP_TABLE, "?$select=msdyn_type,msdyn_steporder,_msdyn_routingconfigurationid_value,_msdyn_rulesetid_value" |
| src/dataverse.ts:41 | readAll | QUEUE_TABLE, "?$select=queueid,name,msdyn_queuetype&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0" |
| src/dataverse.ts:42 | readAll | CONTRACT_TABLE, `?$select=msdyn_decisioncontractid&$filter=msdyn_name eq '${QUEUE_OUTPUT_CONTRACT_NAME}'` |
| src/dataverse.ts:46 | readByIds | RULESET_TABLE, "msdyn_decisionrulesetid", "msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition", [...new Set(queueRulesetIds)] |
| src/dataverse.ts:80 | readAll | RULESET_TABLE, `?$select=msdyn_rulesetdefinition&$filter=msdyn_decisionrulesetid eq ${rulesetId}` |
| src/dataverse.ts:86 | readAll | CONTRACT_TABLE, `?$select=msdyn_contractdefinition&$filter=msdyn_decisioncontractid eq ${contractId}` |
| src/dataverse.ts:102 | fetch | `${base}/api/data/v9.2/${path}`, { method, credentials: "include", headers, body: JSON.stringify(body) } |
| src/dataverse.ts:114 | send | "POST", ENTITY_SETS[table], payload |
| src/dataverse.ts:124 | send | "PATCH", `${ENTITY_SETS[table]}(${recordId})`, columns |

### shared

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/xrm.ts:39 | retrieveMultipleRecords | logicalName, next |

### skill-assignment

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:20 | readAll | "systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode,_businessunitid_value" |
| src/dataverse.ts:21 | readAll | "businessunit", "?$select=businessunitid,name" |
| src/dataverse.ts:22 | readAll | "bookableresource", "?$select=bookableresourceid,_userid_value,statecode&$filter=resourcetype eq 3" |
| src/dataverse.ts:23 | readAll | ASSIGNMENT_TABLE, "?$select=bookableresourcecharacteristicid,_resource_value,_characteristic_value,_ratingvalue_value&$filter=statecode eq 0" |
| src/dataverse.ts:24 | readAll | "characteristic", "?$select=characteristicid,name,characteristictype,statecode" |
| src/dataverse.ts:25 | readAll | "ratingvalue", "?$select=ratingvalueid,name,value,_ratingmodel_value" |
| src/dataverse.ts:26 | readAll | "ratingmodel", "?$select=ratingmodelid,name&$filter=statecode eq 0" |
| src/dataverse.ts:43 | createRecord | ASSIGNMENT_TABLE, payload |
| src/dataverse.ts:50 | updateRecord | ASSIGNMENT_TABLE, assignmentId, { [RATING_BIND]: `/ratingvalues(${ratingId})` } |

### team-builder

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:18 | readAll | "businessunit", "?$select=businessunitid,name,isdisabled,_parentbusinessunitid_value" |
| src/dataverse.ts:19 | readAll | "systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode" |
| src/dataverse.ts:20 | readAll | "role", "?$select=roleid,name,_businessunitid_value" |
| src/dataverse.ts:21 | readAll | "team", "?$select=teamid,name,teamtype,_businessunitid_value,azureactivedirectoryobjectid&$filter=isdefault eq false" |
| src/dataverse.ts:22 | readAll | "teamroles", "?$select=teamid,roleid" |
| src/dataverse.ts:38 | createRecord | TEAM_TABLE, payload |
| src/dataverse.ts:47 | fetch | `${base}/api/data/v9.2/teams(${teamId})/teamroles_association/$ref`, { |

### user-setup

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:23 | readAll | "systemuser", "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled,accessmode,_businessunitid_value" |
| src/dataverse.ts:24 | readAll | "businessunit", "?$select=businessunitid,name" |
| src/dataverse.ts:25 | readAll | "role", "?$select=roleid,name,_businessunitid_value" |
| src/dataverse.ts:26 | readAll | "systemuserroles", "?$select=systemuserid,roleid" |
| src/dataverse.ts:27 | readAll | "team", "?$select=teamid,name,teamtype,_businessunitid_value&$filter=isdefault eq false" |
| src/dataverse.ts:28 | readAll | "teammembership", "?$select=teamid,systemuserid" |
| src/dataverse.ts:29 | readAll | "bookableresource", "?$select=bookableresourceid,_userid_value,statecode&$filter=resourcetype eq 3" |
| src/dataverse.ts:30 | readAll | "msdyn_bookableresourcecapacityprofile", "?$select=_msdyn_bookableresourceid_value,_msdyn_capacityprofileid_value" |
| src/dataverse.ts:31 | readAll | "msdyn_capacityprofile", "?$select=msdyn_capacityprofileid,msdyn_name,msdyn_uniquename&$filter=statecode eq 0" |
| src/dataverse.ts:32 | readAll | "timezonedefinition", "?$select=timezonecode,standardname,userinterfacename" |
| src/dataverse.ts:33 | readAll | "usersettings", "?$select=systemuserid,timezonecode" |
| src/dataverse.ts:62 | fetch | `${base}/api/data/v9.2/${path}`, { |
| src/dataverse.ts:77 | post | `systemusers(${userId})/systemuserroles_association/$ref`, { "@odata.id": `${clientUrl()}/api/data/v9.2/roles(${roleId})` } |
| src/dataverse.ts:82 | post | `teams(${teamId})/Microsoft.Dynamics.CRM.AddMembersTeam`, { Members: [{ "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: userId }] } |
| src/dataverse.ts:86 | createRecord | RESOURCE_TABLE, payload |
| src/dataverse.ts:92 | createRecord | CAPACITY_LINK_TABLE, payload |

### visual-routing-tester

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:50 | retrieveMultipleRecords | "EntityDefinitions", `?$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute&$filter=LogicalName eq '${logicalName}'` |
| src/dataverse.ts:90 | retrieveMultipleRecords | definition.LogicalName, query |
| src/dataverse.ts:109 | fetch | `${clientUrl}/api/data/v9.2/LocalTimeFromUtcTime(UtcTime=${iso},TimeZoneCode=${timeZoneCode})`, { |
| src/dataverse.ts:353 | read | "msdyn_routingconfiguration", `?$select=msdyn_routingconfigurationid,msdyn_isactiveconfiguration&$filter=_msdyn_liveworkstreamid_value eq ${workstreamId}` |
| src/dataverse.ts:357 | read | "msdyn_routingconfigurationstep", `?$select=msdyn_type,msdyn_name,msdyn_steporder,_msdyn_rulesetid_value&$filter=_msdyn_routingconfigurationid_value eq ${activeConfig.msdyn_routingconfigurationid}&$orderby=msdyn_steporde… |
| src/dataverse.ts:366 | read | "msdyn_decisionruleset", `?$select=msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition,msdyn_disabledrules&$filter=${rulesetIds.map((id) => `msdyn_decisionrulesetid eq ${id}`).join(" or ")}` |
| src/dataverse.ts:379 | read | "msdyn_ocruleitem", `?$select=msdyn_ocruleitemid,msdyn_name,msdyn_priority,msdyn_condition,msdyn_expression,msdyn_rulejson,statecode,msdyn_assignedto,_msdyn_queueassignid_value,_msdyn_cdsqueueassignid_value,_msdyn_useras… |
| src/dataverse.ts:415 | read | "msdyn_operatinghour", `?$select=msdyn_operatinghourid,msdyn_calendarid&$filter=${opHourIds.map((id) => `msdyn_operatinghourid eq ${id}`).join(" or ")}` |
| src/dataverse.ts:420 | read | "calendar", `?$select=calendarid&$expand=calendar_calendar_rules&$filter=${calendarIds.map((id) => `calendarid eq ${id}`).join(" or ")}` |
| src/dataverse.ts:426 | read | "calendar", `?$select=calendarid&$expand=calendar_calendar_rules&$filter=${[...innerIds].map((id) => `calendarid eq ${id}`).join(" or ")}` |
| src/dataverse.ts:469 | readSelect | "msdyn_liveworkstream", ["msdyn_liveworkstreamid", "msdyn_name", "statecode", "msdyn_direction", "msdyn_enablevoicev2"], undefined, warnings |
| src/dataverse.ts:483 | read | "msdyn_liveworkstream", `?$select=msdyn_liveworkstreamid&$expand=msdyn_defaultqueue($select=queueid)&$filter=${idsFilter}` |
| src/dataverse.ts:495 | readSelect | "queue", ["queueid", "name", "statecode", "msdyn_assignmentstrategy", "msdyn_inqueueoverflowrulesetid", "_msdyn_prequeueoverflowrulesetid_value", "msdyn_isomnichannelqueue", "_msdyn_operatinghourid_value"], undefined, wa… |
| src/dataverse.ts:496 | read | "msdyn_decisionruleset", "?$select=msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition,msdyn_disabledrules,statecode" |
| src/dataverse.ts:497 | read | "msdyn_overflowactionconfig", "?$select=msdyn_overflowactionconfigid,msdyn_name,msdyn_overflowactiontype,msdyn_overflowactiondata" |
| src/dataverse.ts:521 | read | "msdyn_ocliveworkstreamcontextvariable", `?$select=msdyn_ocliveworkstreamcontextvariableid,msdyn_name,msdyn_displayname,msdyn_datatype,msdyn_isdisplayable&$filter=_msdyn_liveworkstreamid_value eq ${id}` |

### voice-recording-provisioner

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:45 | retrieveMultipleRecords | logicalName, next |
| src/dataverse.ts:60 | readAll | CHANNEL_TABLE, `?$select=msdyn_ocvoicechannelsettingid,msdyn_name,statecode,_msdyn_liveworkstreamid_value,_msdyn_phonenumberid_value,${RECORDING_COLUMNS.join(",")}` |
| src/dataverse.ts:61 | readAll | "msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_direction" |
| src/dataverse.ts:62 | readAll | "msdyn_ocphonenumber", "?$select=msdyn_ocphonenumberid,msdyn_phonenumber" |
| src/dataverse.ts:85 | updateRecord | CHANNEL_TABLE, channelId, columns |

### voice-workstream-builder

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:44 | retrieveMultipleRecords | logicalName, next |
| src/dataverse.ts:58 | readAll | "queue", "?$select=queueid,name&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0" |
| src/dataverse.ts:59 | readAll | "msdyn_capacityprofile", "?$select=msdyn_capacityprofileid,msdyn_name,msdyn_uniquename&$filter=statecode eq 0" |
| src/dataverse.ts:60 | readAll | "msdyn_operatinghour", "?$select=msdyn_operatinghourid,msdyn_name&$filter=statecode eq 0" |
| src/dataverse.ts:61 | readAll | "msdyn_ocphonenumber", "?$select=msdyn_ocphonenumberid,msdyn_phonenumber,statecode,msdyn_phoneinboundenabled,msdyn_phoneoutboundenabled" |
| src/dataverse.ts:62 | readAll | "msdyn_oclanguage", "?$select=msdyn_oclanguageid,msdyn_languagename,msdyn_localecode" |
| src/dataverse.ts:63 | readAll | "msdyn_ocphonemusic", "?$select=msdyn_ocphonemusicid,msdyn_name" |
| src/dataverse.ts:65 | readAll | "msdyn_liveworkstream", "?$select=msdyn_liveworkstreamid,msdyn_name" |
| src/dataverse.ts:66 | readAll | "msdyn_ocvoicechannelsetting", "?$select=msdyn_ocvoicechannelsettingid,msdyn_name,_msdyn_phonenumberid_value,_msdyn_liveworkstreamid_value" |
| src/dataverse.ts:94 | createRecord | TABLES[table].logicalName, payload |
| src/dataverse.ts:100 | readAll | "msdyn_routingconfiguration", `?$select=msdyn_routingconfigurationid&$filter=_msdyn_liveworkstreamid_value eq ${workstreamId}` |

### voicemail-builder

| Where | Call | Arguments, as written |
| --- | --- | --- |
| src/dataverse.ts:30 | readAll | table, `?$select=${select}&$filter=${ids.slice(i, i + 40).map((x) => `${idColumn} eq ${x}`).join(" or ")}` |
| src/dataverse.ts:38 | readAll | QUEUE_TABLE, "?$select=queueid,name,msdyn_queuetype,_msdyn_operatinghourid_value,_msdyn_prequeueoverflowrulesetid_value,_msdyn_inqueueoverflowrulesetid_value&$filter=msdyn_isomnichannelqueue eq true and statecode eq 0" |
| src/dataverse.ts:39 | readAll | "queuemembership", "?$select=queueid,systemuserid" |
| src/dataverse.ts:40 | readAll | WORKSTREAM_TABLE, "?$select=msdyn_liveworkstreamid,msdyn_name,msdyn_streamsource,_msdyn_masterentityroutingconfigurationid_value,_msdyn_defaultqueue_value&$filter=statecode eq 0" |
| src/dataverse.ts:42 | readAll | USER_TABLE, "?$select=systemuserid,fullname,domainname,internalemailaddress,isdisabled&$filter=accessmode eq 0" |
| src/dataverse.ts:43 | readAll | HUB_TABLE, `?$select=msdyn_masterentityroutingconfigurationid,_msdyn_rulesetid_value&$filter=msdyn_entitylogicalname eq '${VOICEMAIL_TABLE}'` |
| src/dataverse.ts:44 | readAll | OVERFLOW_ACTION_TABLE, `?$select=msdyn_overflowactionconfigid,msdyn_name&$filter=msdyn_overflowactiontype eq ${VOICEMAIL_ACTION}` |
| src/dataverse.ts:45 | readAll | CONTRACT_TABLE, `?$select=msdyn_decisioncontractid,msdyn_name&$filter=${contractNames.map((n) => `msdyn_name eq '${n}'`).join(" or ")}` |
| src/dataverse.ts:53 | readByIds | RULESET_TABLE, "msdyn_decisionrulesetid", "msdyn_decisionrulesetid,msdyn_name,msdyn_rulesetdefinition", [...new Set(rulesetIds)] |
| src/dataverse.ts:86 | readAll | RULESET_TABLE, `?$select=msdyn_rulesetdefinition&$filter=msdyn_decisionrulesetid eq ${rulesetId}` |
| src/dataverse.ts:103 | fetch | `${base}/api/data/v9.2/${path}`, { method, credentials: "include", headers, body: JSON.stringify(body) } |
| src/dataverse.ts:115 | send | "POST", ENTITY_SETS[table], payload |
| src/dataverse.ts:125 | send | "PATCH", `${ENTITY_SETS[table]}(${recordId})`, columns |
| src/dataverse.ts:130 | send | "POST", `${ENTITY_SETS[QUEUE_TABLE]}(${queueId})/${MEMBERSHIP_RELATIONSHIP}/$ref`, { "@odata.id": `${clientUrl()}/api/data/v9.2/${ENTITY_SETS[USER_TABLE]}(${userId})` } |
