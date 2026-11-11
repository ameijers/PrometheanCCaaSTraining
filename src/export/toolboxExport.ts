// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ColumnDef, exampleCsvFrom } from "@toolbox/shared/src/columns";
import { COLUMNS as QUEUE_COLUMNS } from "@toolbox/queue-builder/src/template";
import { COLUMNS as MEMBERSHIP_COLUMNS } from "@toolbox/queue-membership/src/template";
import { COLUMNS as RULE_COLUMNS } from "@toolbox/route-to-queue-builder/src/template";
import { COLUMNS as SKILL_COLUMNS } from "@toolbox/skill-assignment/src/template";
import { COLUMNS as CAPACITY_COLUMNS } from "@toolbox/capacity-profile-assignment/src/template";
import { COLUMNS as PROFILE_COLUMNS } from "@toolbox/profile-builder/src/template";
import { COLUMNS as UNIT_COLUMNS } from "@toolbox/business-unit-builder/src/template";
import { COLUMNS as TEAM_COLUMNS } from "@toolbox/team-builder/src/template";
import { COLUMNS as USER_COLUMNS } from "@toolbox/user-setup/src/template";
import { COLUMNS as CHANNEL_COLUMNS } from "@toolbox/voice-channel-builder/src/template";
import { COLUMNS as WORKSTREAM_COLUMNS } from "@toolbox/voice-workstream-builder/src/template";
import { CAPACITY_FORMAT, NOTIFICATION, PRESENCES, WORK_DISTRIBUTION } from "@toolbox/voice-workstream-builder/src/voiceSchema";
import { parseDecisionXml } from "@toolbox/visual-routing-tester/src/ruleXml";
import { ASSIGNMENT_LABELS, isOutbound, outboundProfiles, QUEUE_TYPE_LABELS, routeToQueueRuleset } from "../admin/actions";
import { simpleRule } from "../admin/rules";
import { skillRules } from "../calls/skills";
import { Row, Store } from "../simulator/store";

// From the training to a real environment (manual 9.5): what the learner built, as the Toolbox's own CSV
// templates, so the Toolbox can build it in a real environment. The columns come from each tool's template in
// the submodule (tools/*/src/template.ts), so the files stay in step with the Toolbox. Only what's new compared
// with the starting environment is exported: the Toolbox's tools create new things.

export interface ExportFile { tool: string; fileName: string; rows: number; csv: string }
export interface Export { files: ExportFile[]; notExported: string[] }


const file = (tool: string, fileName: string, columns: ColumnDef[], rows: Record<string, string>[]): ExportFile | undefined =>
  rows.length ? { tool, fileName, rows: rows.length, csv: exampleCsvFrom(columns, rows) } : undefined;

// E.164 for the Toolbox: "+44 20 7946 0100" becomes "+442079460100".
const e164 = (n: unknown) => String(n ?? "").replace(/[^\d+]/g, "");

export function exportDesign(store: Store, start: Store): Export {
  const isNew = (table: string, key: string) => { const old = new Set(start.table(table).map((r) => r[key])); return (r: Row) => !old.has(r[key]); };
  const signIn = (userId?: string) => { const u = userId ? store.find("systemuser", userId) : undefined; return String(u?.domainname ?? u?.internalemailaddress ?? u?.fullname ?? ""); };
  const name = (table: string, id?: string, column = "name") => (id ? String(store.find(table, id)?.[column] ?? "") : "");
  const notExported: string[] = [];
  const byUser = (pairs: [string, string][]) => {
    const map = new Map<string, string[]>();
    for (const [user, value] of pairs) map.set(user, [...(map.get(user) ?? []), value]);
    return [...map.entries()];
  };

  // Queues (Queue Builder), with their first members.
  const newQueue = isNew("queue", "queueid");
  const queues = store.table("queue").filter((q) => q.msdyn_isomnichannelqueue === true && q.statecode === 0 && newQueue(q));
  const newQueueIds = new Set(queues.map((q) => q.queueid));
  const queueRows = queues.map((q) => ({
    queue_name: String(q.name),
    queue_type: QUEUE_TYPE_LABELS[q.msdyn_queuetype] ?? "Voice",
    assignment_method: ASSIGNMENT_LABELS[q.msdyn_assignmentstrategy] ?? "Least active",
    priority: q.msdyn_priority == null ? "" : String(q.msdyn_priority),
    operating_hours: name("msdyn_operatinghour", q._msdyn_operatinghourid_value, "msdyn_name"),
    description: String(q.description ?? ""),
    members: store.table("queuemembership").filter((m) => m.queueid === q.queueid).map((m) => signIn(m.systemuserid)).join("|")
  }));

  // New members of queues that were there at the start (Queue Membership).
  const newMember = isNew("queuemembership", "queuemembershipid");
  const memberRows = byUser(store.table("queuemembership").filter((m) => newMember(m) && !newQueueIds.has(m.queueid)).map((m) => [signIn(m.systemuserid), name("queue", m.queueid)]))
    .map(([user, list]) => ({ user, queues: list.join("|") }));

  // Route-to-queue rules that are new (Route-to-Queue Builder: menu choices in SelectedMenuItem).
  const ruleRows: Record<string, string>[] = [];
  for (const ws of store.table("msdyn_liveworkstream")) {
    const now = routeToQueueRuleset(store, ws.msdyn_liveworkstreamid);
    const before = routeToQueueRuleset(start, ws.msdyn_liveworkstreamid);
    const old = new Set((before ? parseDecisionXml(before.msdyn_rulesetdefinition)?.rules ?? [] : []).map((r) => r.id));
    for (const rule of now ? parseDecisionXml(now.msdyn_rulesetdefinition)?.rules ?? [] : []) {
      if (old.has(rule.id)) continue;
      const simple = simpleRule(rule);
      if (simple && simple.variable === "SelectedMenuItem") ruleRows.push({ workstream_name: String(ws.msdyn_name), rule_name: simple.name, menu_value: simple.value, queue_name: name("queue", simple.queueId) });
      else notExported.push(`The rule “${rule.name}” on ${ws.msdyn_name}: Route-to-Queue Builder takes rules on the IVR menu choice only.`);
    }
  }

  // Skills given or changed (Skill Assignment).
  const startRating = new Map(start.table("bookableresourcecharacteristic").map((l) => [`${l._resource_value}|${l._characteristic_value}`, l._ratingvalue_value]));
  const userOfResource = (id: string) => store.find("bookableresource", id)?._userid_value as string | undefined;
  const skillRows = byUser(store.table("bookableresourcecharacteristic")
    .filter((l) => startRating.get(`${l._resource_value}|${l._characteristic_value}`) !== l._ratingvalue_value)
    .map((l) => [signIn(userOfResource(l._resource_value)), `${name("characteristic", l._characteristic_value)}${l._ratingvalue_value ? `:${name("ratingvalue", l._ratingvalue_value)}` : ""}`]))
    .map(([user, list]) => ({ user, skills: list.join("|") }));

  // Capacity profiles given to people (Capacity Profile Assignment).
  const newCapacity = isNew("msdyn_bookableresourcecapacityprofile", "msdyn_bookableresourcecapacityprofileid");
  const capacityRows = byUser(store.table("msdyn_bookableresourcecapacityprofile").filter(newCapacity)
    .map((l) => [signIn(userOfResource(l._msdyn_bookableresourceid_value)), name("msdyn_capacityprofile", l._msdyn_capacityprofileid_value, "msdyn_name")]))
    .map(([user, list]) => ({ user, capacity_profiles: list.join("|") }));

  // Outbound profiles (Profile Builder).
  const newWs = isNew("msdyn_liveworkstream", "msdyn_liveworkstreamid");
  const profileRows = outboundProfiles(store).filter(newWs).map((p) => {
    const channel = store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_liveworkstreamid_value === p.msdyn_liveworkstreamid);
    const capacity = store.table("msdyn_liveworkstreamcapacityprofile").find((l) => l._msdyn_workstream_id_value === p.msdyn_liveworkstreamid);
    const number = e164(name("msdyn_ocphonenumber", channel?._msdyn_phonenumberid_value, "msdyn_phonenumber"));
    const callerId = e164(name("msdyn_ocphonenumber", channel?._msdyn_calleridphonenumberid_value, "msdyn_phonenumber"));
    return {
      profile_name: String(p.msdyn_name), profile_type: "Outbound", phone_number: number, outbound_queue: name("queue", p._msdyn_outboundqueueid_value),
      caller_id_number: callerId && callerId !== number ? callerId : "", capacity_profile: name("msdyn_capacityprofile", capacity?._msdyn_capacityprofile_id_value, "msdyn_name")
    };
  });

  // Phone lines. Both voice tools require a language, and the training doesn't ask for one: the channel's
  // own language setting if it has one, otherwise en-US, noted.
  const channelRow = (c: Row, tool: string) => {
    const setting = store.table("msdyn_ocvoicechannellanguagesetting").find((l) => l._msdyn_ocvoicechannelsettingid_value === c.msdyn_ocvoicechannelsettingid && l.msdyn_isprimary !== false);
    const language = name("msdyn_oclanguage", setting?._msdyn_languageid_value, "msdyn_localecode");
    if (!language) notExported.push(`The language of the channel “${c.msdyn_name}”: the training doesn't set one, so the file says en-US. Change it to the line's language before you run ${tool}.`);
    return { channel_name: String(c.msdyn_name), phone_number: e164(name("msdyn_ocphonenumber", c._msdyn_phonenumberid_value, "msdyn_phonenumber")), language: language || "en-US" };
  };
  const label = (values: Record<string, number>, value: unknown) => Object.keys(values).find((k) => values[k] === Number(value)) ?? "";

  // New inbound voice workstreams with their lines (Voice Workstream Builder): one row per line, the
  // workstream's settings on its first row, as in the tool's example.
  const workstreamRows: Record<string, string>[] = [];
  for (const ws of store.table("msdyn_liveworkstream").filter((w) => newWs(w) && w.msdyn_enablevoicev2 && !isOutbound(store, w.msdyn_liveworkstreamid))) {
    const capacity = store.table("msdyn_liveworkstreamcapacityprofile").find((l) => l._msdyn_workstream_id_value === ws.msdyn_liveworkstreamid);
    const settings: Record<string, string> = {
      workstream_name: String(ws.msdyn_name), direction: "Inbound",
      work_distribution: label(WORK_DISTRIBUTION, ws.msdyn_workdistributionmode), capacity_format: label(CAPACITY_FORMAT, ws.msdyn_capacityformat),
      capacity_profile: name("msdyn_capacityprofile", capacity?._msdyn_capacityprofile_id_value, "msdyn_name"),
      capacity_units: ws.msdyn_capacityrequired == null ? "" : String(ws.msdyn_capacityrequired),
      allowed_presences: String(ws.msdyn_allowedpresences ?? "").split(",").map((v) => label(PRESENCES, v)).filter(Boolean).join("|"),
      default_queue: name("queue", ws._msdyn_defaultqueue_value), notification: label(NOTIFICATION, ws.msdyn_notification),
      agent_affinity: ws.msdyn_enableagentaffinity ? "Yes" : "No",
      restrict_recording_download: ws.msdyn_restrictdownloadrecording ? "Yes" : "No", restrict_transcript_download: ws.msdyn_restrictdownloadtranscript ? "Yes" : "No"
    };
    const lines = store.table("msdyn_ocvoicechannelsetting").filter((c) => c._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid);
    if (!lines.length) workstreamRows.push(settings);
    lines.forEach((c, i) => workstreamRows.push({ ...(i ? { workstream_name: settings.workstream_name } : settings), ...channelRow(c, "Voice Workstream Builder") }));
  }

  // New lines on inbound workstreams that were there at the start (Voice Channel Builder adds channels to
  // existing workstreams only).
  const startWsIds = new Set(start.table("msdyn_liveworkstream").map((w) => w.msdyn_liveworkstreamid));
  const newChannel = isNew("msdyn_ocvoicechannelsetting", "msdyn_ocvoicechannelsettingid");
  const channelRows = store.table("msdyn_ocvoicechannelsetting")
    .filter((c) => newChannel(c) && startWsIds.has(c._msdyn_liveworkstreamid_value) && !isOutbound(store, c._msdyn_liveworkstreamid_value))
    .map((c) => ({ workstream_name: name("msdyn_liveworkstream", c._msdyn_liveworkstreamid_value, "msdyn_name"), ...channelRow(c, "Voice Channel Builder") }));

  // Business units (Business Unit Builder) and owner teams (Team Builder), and who's in the teams (User Setup).
  const unitRows = store.table("businessunit").filter(isNew("businessunit", "businessunitid"))
    .map((u) => ({ name: String(u.name), parent_business_unit: name("businessunit", u._parentbusinessunitid_value) }));
  const teams = store.table("team").filter((t) => !t.isdefault && isNew("team", "teamid")(t));
  const teamRows = teams.map((t) => ({
    team_name: String(t.name), team_type: "Owner", business_unit: name("businessunit", t._businessunitid_value),
    administrator: signIn(t._administratorid_value), description: String(t.description ?? "")
  }));
  const startMembers = new Set(start.table("teammembership").map((m) => `${m.teamid}|${m.systemuserid}`));
  const userRows = byUser(store.table("teammembership").filter((m) => !startMembers.has(`${m.teamid}|${m.systemuserid}`) && !store.find("team", m.teamid)?.isdefault)
    .map((m) => [signIn(m.systemuserid), name("team", m.teamid)]))
    .map(([user, list]) => ({ user, teams: list.join("|") }));

  // What the templates can't carry.
  const startWs = new Map(start.table("msdyn_liveworkstream").map((w) => [w.msdyn_liveworkstreamid, w]));
  for (const ws of store.table("msdyn_liveworkstream")) {
    const before = startWs.get(ws.msdyn_liveworkstreamid);
    if (!before && !ws.msdyn_enablevoicev2) notExported.push(`The workstream “${ws.msdyn_name}”: the Toolbox creates voice workstreams only. Create it in the admin center.`);
    if (skillRules(store, ws.msdyn_liveworkstreamid).length) notExported.push(`Skill attachment rules on “${ws.msdyn_name}”: no Toolbox tool creates them. Add them in the admin center.`);
    if (before && before.msdyn_matchinglogic !== ws.msdyn_matchinglogic) notExported.push(`The Default skill matching algorithm of “${ws.msdyn_name}”: set it in the admin center.`);
    if (before && before._msdyn_defaultqueue_value !== ws._msdyn_defaultqueue_value) notExported.push(`The fallback queue of “${ws.msdyn_name}”: set it in the admin center.`);
  }
  const startQueues = new Map(start.table("queue").map((q) => [q.queueid, q]));
  for (const q of store.table("queue")) {
    const before = startQueues.get(q.queueid);
    if (!before) continue;
    if (before.msdyn_assignmentstrategy !== q.msdyn_assignmentstrategy || before._msdyn_operatinghourid_value !== q._msdyn_operatinghourid_value) notExported.push(`Changed settings of the queue “${q.name}”: the Toolbox creates queues, it doesn't change them. Change it in the admin center.`);
  }
  if (store.table("msdyn_overflowactionconfig").length !== start.table("msdyn_overflowactionconfig").length) notExported.push("Overflow handling on existing queues: Voicemail Builder sets up voicemail only. Set overflow in the admin center.");
  const startProfiles = new Map(start.table("msdyn_capacityprofile").map((p) => [p.msdyn_capacityprofileid, p]));
  for (const p of store.table("msdyn_capacityprofile")) {
    const before = startProfiles.get(p.msdyn_capacityprofileid);
    if (!before) notExported.push(`The capacity profile “${p.msdyn_name}”: no Toolbox tool creates capacity profiles. Create it in the admin center.`);
    else if (before.msdyn_defaultmaxunits !== p.msdyn_defaultmaxunits) notExported.push(`The work item limit of “${p.msdyn_name}”: set it in the admin center.`);
  }

  // In the order to run them: what a later file names must exist by then.
  const files = [
    file("Business Unit Builder", "business-units.csv", UNIT_COLUMNS, unitRows),
    file("Team Builder", "teams.csv", TEAM_COLUMNS, teamRows),
    file("User Setup", "users.csv", USER_COLUMNS, userRows),
    file("Queue Builder", "advanced-queues.csv", QUEUE_COLUMNS, queueRows),
    file("Queue Membership", "queue-membership.csv", MEMBERSHIP_COLUMNS, memberRows),
    file("Voice Workstream Builder", "voice-workstreams.csv", WORKSTREAM_COLUMNS, workstreamRows),
    file("Voice Channel Builder", "voice-channels.csv", CHANNEL_COLUMNS, channelRows),
    file("Profile Builder", "outbound-profiles.csv", PROFILE_COLUMNS, profileRows),
    file("Route-to-Queue Builder", "route-to-queue.csv", RULE_COLUMNS, ruleRows),
    file("Skill Assignment", "skills.csv", SKILL_COLUMNS, skillRows),
    file("Capacity Profile Assignment", "capacity-profiles.csv", CAPACITY_COLUMNS, capacityRows)
  ].filter((f): f is ExportFile => !!f);
  return { files, notExported: [...new Set(notExported)] };
}
