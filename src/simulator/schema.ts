// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The tables and columns the simulator knows. Every column here is one the Toolbox reads or writes
// (see docs/webapi-surface.md). A query for a column that isn't listed fails the way Dataverse does
// ("Could not find a property named ..."), so a gap shows up straight away instead of as empty data.
//
// Option-set labels are only given where the Toolbox code states them; otherwise the simulator returns
// the number without a formatted value rather than guess a label.

export type ColumnType = "string" | "memo" | "int" | "decimal" | "bool" | "option" | "lookup" | "guid" | "datetime";

export interface Column {
  type: ColumnType;
  // lookup: the table it points to.
  target?: string;
  // option: value → label, where the label is known from the Toolbox.
  labels?: Record<number, string>;
}

// A navigation property for $expand. "one": a lookup on this table. "many": rows of another table
// whose lookup points back here.
export type Navigation =
  | { kind: "one"; column: string; target: string }
  | { kind: "many"; target: string; column: string };

export interface Table {
  logicalName: string;
  entitySetName: string;
  primaryId: string;
  primaryName?: string;
  columns: Record<string, Column>;
  navigation: Record<string, Navigation>;
}

// The key a column is stored and returned under: lookups as _x_value, everything else as is.
export const storageKey = (column: string, def: Column): string => (def.type === "lookup" ? `_${column}_value` : column);

const S: Column = { type: "string" };
const M: Column = { type: "memo" };
const I: Column = { type: "int" };
const B: Column = { type: "bool" };
const G: Column = { type: "guid" };
const D: Column = { type: "datetime" };
const O = (labels?: Record<number, string>): Column => ({ type: "option", labels });
const L = (target: string): Column => ({ type: "lookup", target });

// msdyn_overflowactionconfig.msdyn_overflowactiontype. Values from environment-3d-explorer/src/graph.ts,
// labels as the Visual Routing Tester reads them (visual-routing-tester/src/dataverse.ts mapOverflowOutcome).
const OVERFLOW_ACTION_TYPES: Record<number, string> = {
  192350000: "Default", 192350001: "End Conversation", 192350002: "Transfer to Phone", 192350003: "Direct Callback",
  192350004: "Voicemail", 192350005: "Queue Transfer", 192350006: "Remain In Queue", 192350007: "Scheduled Callback"
};

// systemuser.accessmode, from agent-readiness-checker/src/model.ts.
const ACCESS_MODES: Record<number, string> = { 0: "Read-Write", 1: "Administrative", 2: "Read", 3: "Support User", 4: "Non-interactive", 5: "Delegated Admin" };

// msdyn_ocliveworkstreamcontextvariable.msdyn_datatype, from visual-routing-tester/src/dataverse.ts.
const VARIABLE_TYPES: Record<number, string> = { 192350000: "Text", 192350001: "Number", 192350002: "Boolean", 192350100: "Entity Reference" };

type Def = [entitySetName: string, primaryId: string, primaryName: string | undefined, columns: Record<string, Column>, navigation?: Record<string, Navigation>];

const DEFS: Record<string, Def> = {
  // Voice
  msdyn_ocphonenumber: ["msdyn_ocphonenumbers", "msdyn_ocphonenumberid", "msdyn_phonenumber", {
    msdyn_phonenumber: S, statecode: I, msdyn_phoneinboundenabled: B, msdyn_phoneoutboundenabled: B
  }],
  msdyn_ocvoicechannelsetting: ["msdyn_ocvoicechannelsettings", "msdyn_ocvoicechannelsettingid", "msdyn_name", {
    msdyn_name: S, statecode: I, msdyn_phonenumberid: L("msdyn_ocphonenumber"), msdyn_liveworkstreamid: L("msdyn_liveworkstream"),
    msdyn_calleridphonenumberid: L("msdyn_ocphonenumber"), msdyn_operatinghoursid: L("msdyn_operatinghour"),
    // Recording and transcription (voice-workstream-builder/src/recordingSettings.ts, voice-recording-provisioner).
    // The two modes are written as text, e.g. "192351002" (voice-workstream-builder/src/recordingSettings.ts).
    msdyn_recordingenabled: B, msdyn_recordingmode: S, msdyn_transcriptionenabled: B, msdyn_transcriptionmode: S,
    msdyn_agentrecordingcontrolsenabled: B, msdyn_agenttranscriptioncontrolsenabled: B, msdyn_enablestoprecordingtranscriptiononhold: B,
    msdyn_playrecordingtranscriptionnotifications: B, msdyn_requestuserconsentforrecording: B, msdyn_transcriptionshowbydefault: B,
    msdyn_stoptranscriptionandrecordingafterpstntransfer: B, msdyn_stoptranscriptionandrecordingafterteamstransfer: B,
    msdyn_usebridgetransferforpstntransfer: B, msdyn_usebridgetransferforteamstransfer: B,
    msdyn_agentexternalparticipanttransfercontrolenabled: B, msdyn_agentexternalteamsparticipanttransfercontrolenabled: B,
    // Outbound profiles.
    msdyn_isanonymouscallerid: B, msdyn_calleridname: S
  }],

  // Routing
  msdyn_liveworkstream: ["msdyn_liveworkstreams", "msdyn_liveworkstreamid", "msdyn_name", {
    msdyn_name: S, statecode: I, msdyn_streamsource: O(), msdyn_direction: O(), msdyn_enablevoicev2: B,
    msdyn_capacityrequired: I, msdyn_capacityformat: O(), msdyn_defaultqueue: L("queue"), msdyn_bot_user: L("systemuser"),
    msdyn_routingcontractid: L("msdyn_decisioncontract"), msdyn_masterentityroutingconfigurationid: L("msdyn_masterentityroutingconfiguration"),
    msdyn_outboundqueueid: L("queue"), msdyn_mode: O(), msdyn_workdistributionmode: O(), msdyn_allowedpresences: S, msdyn_autocloseafterinactivity: I,
    msdyn_notification: O(), msdyn_enableagentaffinity: B, msdyn_restrictdownloadrecording: B, msdyn_restrictdownloadtranscript: B,
    msdyn_conversationmode: O(), msdyn_screenpoptimeout_optionSet: O(), msdyn_blockcapacityforwrapup: I, msdyn_enableselectingfrompushbasedworkstreams: B,
    // "Default skill matching algorithm": Exact Match 192350000, Closest Match 192350001 (Learn, msdyn_liveworkstream reference).
    msdyn_matchinglogic: O()
  }, {
    msdyn_defaultqueue: { kind: "one", column: "msdyn_defaultqueue", target: "queue" },
    // Voicemail Builder binds it with a capital I (voicemail-builder/src/schema.ts).
    msdyn_masterentityroutingconfigurationId: { kind: "one", column: "msdyn_masterentityroutingconfigurationid", target: "msdyn_masterentityroutingconfiguration" }
  }],
  msdyn_routingconfiguration: ["msdyn_routingconfigurations", "msdyn_routingconfigurationid", "msdyn_name", {
    msdyn_name: S, msdyn_uniquename: S, statecode: I, msdyn_isactiveconfiguration: B, msdyn_liveworkstreamid: L("msdyn_liveworkstream")
  }],
  msdyn_routingconfigurationstep: ["msdyn_routingconfigurationsteps", "msdyn_routingconfigurationstepid", "msdyn_name", {
    msdyn_name: S, msdyn_uniquename: S, statecode: I, msdyn_type: O(), msdyn_steporder: I, msdyn_routingconfigurationid: L("msdyn_routingconfiguration"),
    msdyn_rulesetid: L("msdyn_decisionruleset")
  }],
  msdyn_decisionruleset: ["msdyn_decisionrulesets", "msdyn_decisionrulesetid", "msdyn_name", {
    msdyn_name: S, msdyn_uniquename: S, msdyn_description: M, statecode: I, msdyn_rulesetdefinition: M, msdyn_disabledrules: M,
    msdyn_rulesettype: O(), msdyn_authoringmode: O(), msdyn_isinputcollection: B, msdyn_persistoutputdata: B, msdyn_refreshinputdata: B,
    msdyn_inputcontractid: L("msdyn_decisioncontract"), msdyn_outputcontractid: L("msdyn_decisioncontract")
  }],
  msdyn_decisioncontract: ["msdyn_decisioncontracts", "msdyn_decisioncontractid", "msdyn_name", {
    msdyn_name: S, statecode: I, msdyn_contractdefinition: M
  }],
  msdyn_masterentityroutingconfiguration: ["msdyn_masterentityroutingconfigurations", "msdyn_masterentityroutingconfigurationid", "msdyn_name", {
    msdyn_name: S, msdyn_entitylogicalname: S, msdyn_rulesetid: L("msdyn_decisionruleset")
  }],
  msdyn_ocliveworkstreamcontextvariable: ["msdyn_ocliveworkstreamcontextvariables", "msdyn_ocliveworkstreamcontextvariableid", "msdyn_name", {
    msdyn_name: S, msdyn_displayname: S, msdyn_datatype: O(VARIABLE_TYPES), msdyn_isdisplayable: B, msdyn_islist: B, msdyn_ismodifiable: B,
    msdyn_issystemdefined: B, statecode: I, msdyn_liveworkstreamid: L("msdyn_liveworkstream")
  }],
  msdyn_ocruleitem: ["msdyn_ocruleitems", "msdyn_ocruleitemid", "msdyn_name", {
    msdyn_name: S, statecode: I, msdyn_priority: I, msdyn_condition: M, msdyn_expression: M, msdyn_rulejson: M, msdyn_assignedto: O(),
    msdyn_queueassignid: L("queue"), msdyn_cdsqueueassignid: L("queue"), msdyn_userassignid: L("systemuser"), msdyn_liveworkstream: L("msdyn_liveworkstream")
  }],
  msdyn_overflowactionconfig: ["msdyn_overflowactionconfigs", "msdyn_overflowactionconfigid", "msdyn_name", {
    msdyn_name: S, statecode: I, msdyn_overflowactiontype: O(OVERFLOW_ACTION_TYPES), msdyn_overflowactiondata: S
  }],
  msdyn_operatinghour: ["msdyn_operatinghours", "msdyn_operatinghourid", "msdyn_name", {
    // msdyn_calendarid is read as a plain value by the Visual Routing Tester.
    msdyn_name: S, statecode: I, msdyn_calendarid: G
  }],
  calendar: ["calendars", "calendarid", "name", { name: S }, {
    calendar_calendar_rules: { kind: "many", target: "calendarrule", column: "calendarid" }
  }],
  calendarrule: ["calendarrules", "calendarruleid", "name", {
    name: S, calendarid: L("calendar"), innercalendarid: L("calendar"), pattern: S, offset: I, duration: I, timezonecode: I,
    effectiveintervalstart: D, effectiveintervalend: D, starttime: D
  }],

  // Queues and people
  queue: ["queues", "queueid", "name", {
    name: S, statecode: I, msdyn_queuetype: O(), msdyn_isomnichannelqueue: B, msdyn_assignmentstrategy: O(),
    msdyn_prequeueoverflowrulesetid: L("msdyn_decisionruleset"), msdyn_inqueueoverflowrulesetid: L("msdyn_decisionruleset"),
    msdyn_operatinghourid: L("msdyn_operatinghour"), msdyn_assignmentinputcontractid: L("msdyn_decisioncontract"),
    msdyn_priority: I, queueviewtype: O(), description: M
  }, {
    // The pre-queue overflow lookup's navigation property is named msdyn_decisionrulesetid (voicemail-builder/src/schema.ts PREQUEUE_NAV).
    msdyn_decisionrulesetid: { kind: "one", column: "msdyn_prequeueoverflowrulesetid", target: "msdyn_decisionruleset" }
  }],
  queuemembership: ["queuememberships", "queuemembershipid", undefined, { queueid: G, systemuserid: G }],
  systemuser: ["systemusers", "systemuserid", "fullname", {
    fullname: S, domainname: S, internalemailaddress: S, isdisabled: B, accessmode: O(ACCESS_MODES), businessunitid: L("businessunit")
  }],
  businessunit: ["businessunits", "businessunitid", "name", {
    name: S, isdisabled: B, parentbusinessunitid: L("businessunit"), description: M, divisionname: S, costcenter: S, emailaddress: S, websiteurl: S,
    address1_name: S, address1_line1: S, address1_city: S, address1_postalcode: S, address1_country: S, address1_telephone1: S
  }],
  team: ["teams", "teamid", "name", {
    name: S, isdefault: B, teamtype: O(), membershiptype: O(), description: M, businessunitid: L("businessunit"), administratorid: L("systemuser"),
    azureactivedirectoryobjectid: G
  }],
  teammembership: ["teammemberships", "teammembershipid", undefined, { teamid: G, systemuserid: G }],
  role: ["roles", "roleid", "name", { name: S, businessunitid: L("businessunit") }],
  systemuserroles: ["systemuserrolescollection", "systemuserroleid", undefined, { systemuserid: G, roleid: G }],
  teamroles: ["teamrolescollection", "teamroleid", undefined, { teamid: G, roleid: G }],
  bookableresource: ["bookableresources", "bookableresourceid", "name", {
    name: S, statecode: I, resourcetype: O(), userid: L("systemuser"), timezone: I, msdyn_displayonscheduleboard: B
  }, {
    // "The navigation property is PascalCase" (user-setup/src/plan.ts).
    UserId: { kind: "one", column: "userid", target: "systemuser" }
  }],
  bookableresourcecharacteristic: ["bookableresourcecharacteristics", "bookableresourcecharacteristicid", "name", {
    name: S, statecode: I, resource: L("bookableresource"), characteristic: L("characteristic"), ratingvalue: L("ratingvalue")
  }, {
    Resource: { kind: "one", column: "resource", target: "bookableresource" },
    Characteristic: { kind: "one", column: "characteristic", target: "characteristic" },
    RatingValue: { kind: "one", column: "ratingvalue", target: "ratingvalue" }
  }],
  characteristic: ["characteristics", "characteristicid", "name", { name: S, statecode: I, characteristictype: O() }],
  ratingmodel: ["ratingmodels", "ratingmodelid", "name", { name: S, statecode: I }],
  ratingvalue: ["ratingvalues", "ratingvalueid", "name", { name: S, value: I, ratingmodel: L("ratingmodel") }],
  msdyn_capacityprofile: ["msdyn_capacityprofiles", "msdyn_capacityprofileid", "msdyn_name", {
    msdyn_name: S, statecode: I, msdyn_uniquename: S, msdyn_defaultmaxunits: I
  }],
  msdyn_bookableresourcecapacityprofile: ["msdyn_bookableresourcecapacityprofiles", "msdyn_bookableresourcecapacityprofileid", "msdyn_name", {
    msdyn_name: S, statecode: I, msdyn_maxunits: I, msdyn_bookableresourceid: L("bookableresource"), msdyn_capacityprofileid: L("msdyn_capacityprofile")
  }, { msdyn_capacityprofileid: { kind: "one", column: "msdyn_capacityprofileid", target: "msdyn_capacityprofile" } }],
  msdyn_liveworkstreamcapacityprofile: ["msdyn_liveworkstreamcapacityprofiles", "msdyn_liveworkstreamcapacityprofileid", "msdyn_name", {
    msdyn_name: S, statecode: I, msdyn_workstream_id: L("msdyn_liveworkstream"), msdyn_capacityprofile_id: L("msdyn_capacityprofile")
  }, {
    // Voice Workstream Builder binds msdyn_capacityProfile_id (voice-workstream-builder/src/voiceSchema.ts NAV).
    msdyn_capacityProfile_id: { kind: "one", column: "msdyn_capacityprofile_id", target: "msdyn_capacityprofile" }
  }],

  // Voice channel settings (voice-workstream-builder/src/voiceSchema.ts TABLES).
  msdyn_oclanguage: ["msdyn_oclanguages", "msdyn_oclanguageid", "msdyn_languagename", { msdyn_languagename: S, msdyn_localecode: S }],
  msdyn_ocphonemusic: ["msdyn_ocphonemusics", "msdyn_ocphonemusicid", "msdyn_name", { msdyn_name: S }],
  msdyn_ocvoice: ["msdyn_ocvoices", "msdyn_ocvoiceid", "msdyn_name", {
    msdyn_name: S, msdyn_voicename: S, msdyn_voicestyle: S, msdyn_speakingspeed: I, msdyn_pitch: I, msdyn_language: L("msdyn_oclanguage")
  }],
  msdyn_ocvoicechannellanguagesetting: ["msdyn_ocvoicechannellanguagesettings", "msdyn_ocvoicechannellanguagesettingid", "msdyn_name", {
    msdyn_name: S, msdyn_isprimary: B, msdyn_ocvoicechannelsettingid: L("msdyn_ocvoicechannelsetting"), msdyn_languageid: L("msdyn_oclanguage"), msdyn_ocvoiceid: L("msdyn_ocvoice"),
    msdyn_holdmusicid: L("msdyn_ocphonemusic"), msdyn_waitmusicid: L("msdyn_ocphonemusic")
  }],

  // Assignment methods (assignment-method-copier/src/schema.ts).
  msdyn_assignmentconfiguration: ["msdyn_assignmentconfigurations", "msdyn_assignmentconfigurationid", "msdyn_name", {
    msdyn_name: S, msdyn_uniquename: S, msdyn_description: M, statecode: I, msdyn_isactiveconfiguration: B, msdyn_queueid: L("queue")
  }],
  msdyn_assignmentconfigurationstep: ["msdyn_assignmentconfigurationsteps", "msdyn_assignmentconfigurationstepid", "msdyn_name", {
    msdyn_name: S, msdyn_uniquename: S, statecode: I, msdyn_type: O(), msdyn_steporder: I, msdyn_isdefaultruleset: B,
    msdyn_assignmentconfigurationid: L("msdyn_assignmentconfiguration"), msdyn_rulesetid: L("msdyn_decisionruleset")
  }],

  // User settings (user-setup/src/dataverse.ts).
  timezonedefinition: ["timezonedefinitions", "timezonedefinitionid", "standardname", { timezonecode: I, standardname: S, userinterfacename: S }],
  usersettings: ["usersettingscollection", "systemuserid", undefined, { timezonecode: I }],

  // Live activity
  msdyn_presence: ["msdyn_presences", "msdyn_presenceid", "msdyn_name", { msdyn_name: S, msdyn_basepresencestatus: O() }],
  msdyn_agentstatus: ["msdyn_agentstatuses", "msdyn_agentstatusid", undefined, {
    msdyn_agentid: L("systemuser"), msdyn_isagentloggedin: B, msdyn_isblockedbysomeprofile: B, modifiedon: D, msdyn_currentpresenceid: L("msdyn_presence")
  }, { msdyn_currentpresenceid: { kind: "one", column: "msdyn_currentpresenceid", target: "msdyn_presence" } }],
  msdyn_ocliveworkitem: ["msdyn_ocliveworkitems", "activityid", "msdyn_title", {
    msdyn_ocliveworkitemid: G, msdyn_title: S, statecode: I, statuscode: I, createdon: D, modifiedon: D,
    msdyn_cdsqueueid: L("queue"), msdyn_activeagentid: L("systemuser"), msdyn_liveworkstreamid: L("msdyn_liveworkstream")
  }],
  msdyn_ocliveworkitemcontextitem: ["msdyn_ocliveworkitemcontextitems", "msdyn_ocliveworkitemcontextitemid", "msdyn_name", {
    msdyn_name: S, msdyn_value: S, msdyn_datatype: O(), createdon: D, msdyn_ocliveworkitemid: L("msdyn_ocliveworkitem")
  }],

  // Customers (Learn, Identify customers automatically: a call is matched on a contact's mobile phone or an
  // account's phone). The Toolbox doesn't read these; the training's workspace does.
  account: ["accounts", "accountid", "name", { name: S, telephone1: S, statecode: I }],
  contact: ["contacts", "contactid", "fullname", {
    fullname: S, firstname: S, lastname: S, mobilephone: S, emailaddress1: S, statecode: I, parentcustomerid: L("account")
  }],

  // NOT a Dataverse table: what the training knows about a call besides the live work item: the number it
  // came from, the customer it was matched to, the simulated sentiment, the Copilot summary, and whether a
  // supervisor joined. The platform keeps these elsewhere (the conversation's customer, transcript and
  // summary records), with columns the training doesn't need to copy.
  training_call: ["training_calls", "training_callid", undefined, {
    workitemid: G, fromnumber: S, customerkind: S, customerid: G, summary: M, summarizedon: D, supervisorjoined: B
  }],

  // NOT a Dataverse table: the training's own record of each assignment. Unified routing keeps "the last
  // assignment time" per queue and "the time since last capacity is released" for its round robin and
  // least active methods (Learn, Assignment methods for queues), in tables whose columns Learn doesn't
  // document (it names msdyn_agentchannelstate). The training keeps them here instead of guessing them.
  training_assignment: ["training_assignments", "training_assignmentid", undefined, {
    queueid: G, agentid: G, workitemid: G, assignedon: D, releasedon: D
  }],
  // NOT a Dataverse table: what a learner did or answered in a lab (src/labs), so the lab's checks can read
  // it like the rest of the environment: "seen:diagram", "did:accept-call", "answer:<question>".
  training_answer: ["training_answers", "training_answerid", "key", { key: S, value: S }],
  // A workstream's skill attachment rules (Learn, Configure work classification rulesets): "if defined
  // condition satisfies, then attach defined skills to the work item." Learn doesn't document how the
  // platform stores them, so the training keeps them here: one condition (variable equals value) and one
  // skill with its rating per rule, in order.
  training_skillrule: ["training_skillrules", "training_skillruleid", "name", {
    name: S, workstreamid: G, ruleorder: I, variable: S, value: S, skillid: G, ratingvalueid: G
  }]
};

export const TABLES: Record<string, Table> = Object.fromEntries(Object.entries(DEFS).map(([logicalName, [entitySetName, primaryId, primaryName, columns, navigation]]) =>
  [logicalName, { logicalName, entitySetName, primaryId, primaryName, columns: { [primaryId]: G, ...columns }, navigation: navigation ?? {} }]));

export function tableByEntitySet(entitySetName: string): Table | undefined {
  return Object.values(TABLES).find((t) => t.entitySetName === entitySetName);
}
