// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { createContext, useContext, useEffect, useState } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DrawerBody, DrawerFooter, DrawerHeader,
  DrawerHeaderTitle, Dropdown, Field, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarBody, Option,
  OptionGroup, OverlayDrawer, Radio, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Textarea, Tooltip
} from "@fluentui/react-components";
import { ASSIGNMENT_METHODS, AssignmentMethod, QueueType } from "@toolbox/queue-builder/src/queueSchema";
import pagesJson from "../../content/admin-pages/pages.json";
import { useStoreVersion, useTraining } from "../shell/context";
import { LEARNER } from "../simulator/learner";
import { Matching, matchingOf, ratingOf, skillRules } from "../calls/skills";
import { DEFAULT_CAPACITY_PROFILE } from "@toolbox/voice-workstream-builder/src/voiceSchema";
import { Row, Store } from "../simulator/store";
import {
  Admin, addUsers, ASSIGNMENT_LABELS, createQueue, QUEUE_TYPE_LABELS, routeToQueueRuleset, setAssignmentMethod, setFallbackQueue,
  channelOfNumber, findNumber, NUMBER_COUNTRIES, NumberCountry, purchaseNumber, setupWorkstream,
  addProfileUsers, createCapacityProfile, createVoiceWorkstream, addTeamMembers, createBusinessUnit, createOwnerTeam,
  addSkillRule, createOutboundProfile, createSkill, deleteSkillRule, outboundProfiles, removeUserSkill, setMatchingLogic, setUserSkills, OverflowActionKind, OverflowCondition, OverflowPair, readOverflow, saveOverflow, setOperationHours, setWorkItemLimit
} from "./actions";
import {
  ClassificationRule, classificationRulesets, createClassificationRuleset, deleteClassificationRuleset, deleteRule, describeConditions, emptyConditions, fieldLabel,
  hitPolicyOf, MAX_OUTPUTS, MAX_QUEUES, moveClassificationRuleset, moveRule, PRIORITY_SCORE, QueueShare, readClassificationRule, readRouteRule, RouteRule, ruleFields,
  rulesOf, saveClassificationRule, saveRouteRule, setHitPolicy
} from "./rules";
import { ConditionBuilder } from "./ConditionBuilder";

// The simulated Copilot Service admin center: the real menu path, page, section, button and field names
// (checked in the admin center itself, content/admin-pages/pages.json), our own look (Fluent UI), and a
// banner saying it's a training simulation. Only the Contact Center parts. Saving writes to the simulated
// environment through its Web API. Buttons for things the training doesn't cover yet are shown, disabled.

const P = pagesJson.pages;
const VOICE_QUEUE = 192350002;
const VOICE_STREAM = 192440000;
const NOT_YET = "Not part of the training yet";

type Place =
  | { page: "queues" } | { page: "advanced-queues" } | { page: "queue"; id: string } | { page: "assignment-method"; id: string }
  | { page: "workstreams" } | { page: "workstream"; id: string } | { page: "decision-list"; id: string }
  | { page: "channels" } | { page: "phone-numbers" } | { page: "overflow"; id: string }
  | { page: "user-management" } | { page: "capacity-profiles" } | { page: "capacity-profile"; id: string }
  | { page: "business-units" } | { page: "teams" }
  | { page: "skills" } | { page: "classification"; id: string } | { page: "classification-ruleset"; id: string; rulesetId: string }
  | { page: "productivity" } | { page: "outbound-profiles" };

interface AdminUi {
  store: Store;
  admin: Admin;
  go(place: Place): void;
  explain(concept: string): void;
  queueName(id?: string): string | undefined;
}

const AdminUiContext = createContext<AdminUi | undefined>(undefined);
const useUi = (): AdminUi => useContext(AdminUiContext)!;

const CONCEPT_OF: Record<Place["page"], string> = {
  queues: P.queues.concept, "advanced-queues": P["advanced-queues"].concept, queue: P.queue.concept, "assignment-method": P["assignment-method"].concept,
  workstreams: P.workstreams.concept, workstream: P.workstream.concept, "decision-list": P["decision-list"].concept,
  channels: P.channels.concept, "phone-numbers": P["phone-numbers"].concept, overflow: "overflow",
  "user-management": P["user-management"].concept, "capacity-profiles": P["capacity-profiles"].concept, "capacity-profile": P["capacity-profiles"].concept,
  "business-units": P["business-units"].concept, teams: P.teams.concept,
  skills: P.skills.concept, classification: "work-classification", "classification-ruleset": "work-classification", productivity: P.productivity.concept, "outbound-profiles": P["outbound-profiles"].concept
};

// A request to show where a record is configured ("Where is this configured?", manual 6.4). `at` makes each request new.
export interface AdminRequest { page: "queue" | "workstream"; id: string; at: number }

export function AdminCenter({ request }: { request?: AdminRequest } = {}) {
  const { sim, explain } = useTraining();
  useStoreVersion();
  const [place, setPlace] = useState<Place>({ page: "workstreams" });
  useEffect(() => { if (request) setPlace({ page: request.page, id: request.id }); }, [request?.at]);
  const store = sim.store;
  const go = (p: Place) => { setPlace(p); explain(CONCEPT_OF[p.page]); };
  const queueName = (id?: string) => (id ? store.find("queue", id)?.name : undefined);
  const ui: AdminUi = { store, admin: { api: sim.api, store }, go, explain, queueName };
  const inQueues = ["queues", "advanced-queues", "queue", "assignment-method", "overflow"].includes(place.page);
  const inUsers = ["user-management", "capacity-profiles", "capacity-profile", "skills"].includes(place.page);
  const inChannels = ["channels", "phone-numbers"].includes(place.page);
  const inProductivity = ["productivity", "outbound-profiles"].includes(place.page);
  const section = inQueues ? "queues" : inChannels ? "channels" : inUsers ? "user-management" : inProductivity ? "productivity" : "workstreams";
  // Business units and teams are in another admin center: the Power Platform admin center (level 5, onboarding).
  const ppac = place.page === "business-units" || place.page === "teams";
  const learn = ppac ? (pagesJson.ppac.learn as Record<string, string>)[place.page] : pagesJson.siteMap.flatMap((g) => g.items as { page?: string; learn?: string }[]).find((i) => i.page === section)?.learn;

  return (
    <AdminUiContext.Provider value={ui}>
      <div className="admin">
        <div className="admin-banner" role="note">
          <strong>Training simulation by Promethean Academy</strong>, not Microsoft's {ppac ? pagesJson.ppac.name : "Copilot Service admin center"}. Menus, buttons and fields have
          the real names; the look is our own. <a href={learn} target="_blank" rel="noreferrer">How it works on Microsoft Learn</a>
        </div>
        <div className="admin-body">
          <nav className="admin-sitemap" aria-label="Site map">
            <div className="admin-apps" role="group" aria-label="Admin center">
              <button className={`admin-app${ppac ? "" : " active"}`} onClick={() => go({ page: "workstreams" })}>Copilot Service admin center</button>
              <button className={`admin-app${ppac ? " active" : ""}`} onClick={() => go({ page: "business-units" })}>{pagesJson.ppac.name}</button>
            </div>
            {ppac ? (
              <div>
                <div className="admin-group">{pagesJson.ppac.path.slice(2).join(" › ")}</div>
                {pagesJson.ppac.items.map((i) => <button key={i.page} className={`admin-nav${place.page === i.page ? " active" : ""}`} onClick={() => go({ page: i.page as "business-units" | "teams" })}>{i.label}</button>)}
              </div>
            ) : pagesJson.siteMap.map((g) => (
              <div key={g.group}>
                <div className="admin-group">{g.group}</div>
                {g.items.map((i) => {
                  const active = i.page === section;
                  return i.page
                    ? <button key={i.label} className={`admin-nav${active ? " active" : ""}`} onClick={() => go({ page: i.page as "queues" | "workstreams" | "channels" | "user-management" | "productivity" })}>{i.label}</button>
                    : <button key={i.label} className="admin-nav" disabled title={NOT_YET}>{i.label}</button>;
                })}
              </div>
            ))}
          </nav>
          <section className="admin-main" aria-label="Admin center page">
            {place.page === "queues" && <QueuesHome />}
            {place.page === "advanced-queues" && <AdvancedQueues />}
            {place.page === "queue" && <QueuePage id={place.id} />}
            {place.page === "assignment-method" && <AssignmentMethodPage id={place.id} />}
            {place.page === "workstreams" && <Workstreams />}
            {place.page === "workstream" && <WorkstreamPage id={place.id} />}
            {place.page === "decision-list" && <DecisionList id={place.id} />}
            {place.page === "channels" && <ChannelsHome />}
            {place.page === "phone-numbers" && <PhoneNumbers />}
            {place.page === "overflow" && <OverflowPage id={place.id} />}
            {place.page === "user-management" && <UserManagement />}
            {place.page === "capacity-profiles" && <CapacityProfiles />}
            {place.page === "capacity-profile" && <CapacityProfilePage id={place.id} />}
            {place.page === "business-units" && <BusinessUnits />}
            {place.page === "teams" && <Teams />}
            {place.page === "skills" && <Skills />}
            {place.page === "classification" && <Classification id={place.id} />}
            {place.page === "classification-ruleset" && <ClassificationRuleset id={place.id} rulesetId={place.rulesetId} />}
            {place.page === "productivity" && <Productivity />}
            {place.page === "outbound-profiles" && <OutboundProfiles />}
          </section>
        </div>
      </div>
    </AdminUiContext.Provider>
  );
}

// ---- parts used on several pages ----

function Crumbs({ items }: { items: { label: string; to?: Place }[] }) {
  const { go } = useUi();
  return (
    <div className="admin-crumbs">
      {items.map((c, i) => (
        <span key={i}>{i > 0 && <span className="admin-crumb-sep">›</span>}{c.to ? <button className="admin-link" onClick={() => go(c.to!)}>{c.label}</button> : <span>{c.label}</span>}</span>
      ))}
    </div>
  );
}

function CommandBar({ children }: { children: React.ReactNode }) {
  return <div className="admin-commands">{children}</div>;
}

function Notice() {
  return <div className="admin-notice">{pagesJson.notice} <span className="admin-muted">({pagesJson.noticeTraining})</span></div>;
}

function Info({ concept }: { concept: string }) {
  const { explain } = useUi();
  return <button className="admin-info" title="What is this?" aria-label="What is this?" onClick={() => explain(concept)}>ⓘ</button>;
}

function Off({ children }: { children: string }) {
  return <Tooltip content={NOT_YET} relationship="description"><Button appearance="subtle" disabled>{children}</Button></Tooltip>;
}

function Facts({ items }: { items: [string, string][] }) {
  return <div className="admin-facts">{items.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>;
}

const unitName = (store: Store, user?: Row) => (user?._businessunitid_value ? store.find("businessunit", user._businessunitid_value)?.name ?? "" : "");
const profilesOf = (store: Store, userId: string) => {
  const resource = store.table("bookableresource").find((r) => r._userid_value === userId);
  if (!resource) return "";
  return store.table("msdyn_bookableresourcecapacityprofile").filter((l) => l._msdyn_bookableresourceid_value === resource.bookableresourceid)
    .map((l) => store.find("msdyn_capacityprofile", l._msdyn_capacityprofileid_value)?.msdyn_name).filter(Boolean).join(", ");
};
const rolesOf = (store: Store, userId: string) => store.table("systemuserroles").filter((r) => r.systemuserid === userId).map((r) => store.find("role", r.roleid)?.name).filter(Boolean).join(", ");
const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "–");

// ---- Queues ----

function QueuesHome() {
  const { go } = useUi();
  const def = P.queues;
  return (
    <section>
      <h1 className="admin-title">{def.title}</h1>
      <p className="admin-muted">{def.intro}</p>
      {def.cards.map((c) => (
        <div key={c.title} className="admin-card admin-row">
          <div><h2 className="admin-subtitle">{c.title}</h2><p className="admin-muted admin-tight">{c.description}</p></div>
          <Button appearance="primary" onClick={() => go({ page: "advanced-queues" })}>{c.action}</Button>
        </div>
      ))}
    </section>
  );
}

function AdvancedQueues() {
  const { store, go } = useUi();
  const def = P["advanced-queues"];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const queues = store.table("queue").filter((q) => q.msdyn_isomnichannelqueue === true && q.statecode === 0)
    .filter((q) => !search || String(q.name).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <section>
      <CommandBar>
        <Button appearance="subtle" onClick={() => setOpen(true)}>+ {def.newButton}</Button>
        <Button appearance="subtle">{def.refresh}</Button>
        <Input className="admin-command-search" placeholder={def.search} value={search} onChange={(_, v) => setSearch(v.value)} />
      </CommandBar>
      <Crumbs items={[{ label: def.crumbs[0], to: { page: "queues" } }]} />
      <h1 className="admin-title">{def.title}</h1>
      <p className="admin-muted admin-tight">Showing {queues.length} results</p>
      <Table size="small" aria-label={def.title}>
        <TableHeader><TableRow>{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {queues.map((q) => (
            <TableRow key={q.queueid}>
              <TableCell><button className="admin-link" onClick={() => go({ page: "queue", id: q.queueid })}>{q.name}</button></TableCell>
              <TableCell>{q.msdyn_priority ?? ""}</TableCell>
              <TableCell>{QUEUE_TYPE_LABELS[q.msdyn_queuetype] ?? ""}</TableCell>
              <TableCell>{LEARNER.userName}</TableCell>
              <TableCell>{date(q.createdon)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {open && <CreateQueueDialog onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); go({ page: "queue", id }); }} />}
    </section>
  );
}

function CreateQueueDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { admin, explain } = useUi();
  const d = P["advanced-queues"].createDialog;
  const [name, setName] = useState("");
  const [type, setType] = useState<QueueType | "">("");
  const [priority, setPriority] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const ready = name.trim() !== "" && type !== "" && /^\d+$/.test(priority.trim());
  const create = () => {
    try { onCreated(createQueue(admin, { name, type: type as QueueType, priority: Number(priority), description })); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="Close" onClick={onClose}>✕</Button>}>{d.title}</DialogTitle>
          <DialogContent className="admin-form">
            <p className="admin-muted admin-tight">{d.intro} <button className="admin-link" onClick={() => explain("create-queue")}>Learn more</button></p>
            <Field label={d.fields.name} required><Input value={name} onChange={(_, v) => setName(v.value)} /></Field>
            <Field label={d.fields.type} required>
              <Dropdown placeholder={d.fields.typePlaceholder} value={type} selectedOptions={type ? [type] : []} onOptionSelect={(_, o) => setType(o.optionValue as QueueType)}>
                {d.types.map((t) => <Option key={t} value={t}>{t}</Option>)}
              </Dropdown>
            </Field>
            <Field label={<span>{d.fields.priority} <Tooltip content={d.fields.priorityInfo} relationship="description"><span className="admin-info">ⓘ</span></Tooltip></span>} required>
              <Input value={priority} onChange={(_, v) => setPriority(v.value)} />
            </Field>
            <Field label={d.fields.description}><Textarea value={description} onChange={(_, v) => setDescription(v.value)} /></Field>
            <Field label={d.fields.owner}><Input value={LEARNER.userName} disabled /></Field>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions><Button appearance="primary" disabled={!ready} onClick={create}>{d.submit}</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function QueuePage({ id }: { id: string }) {
  const { store, go } = useUi();
  const def = P.queue;
  const queue = store.find("queue", id);
  const [panel, setPanel] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [search, setSearch] = useState("");
  if (!queue) return <p>This queue no longer exists.</p>;
  const pairs = readOverflow(store, queue.queueid);
  const memberIds = store.table("queuemembership").filter((m) => m.queueid === queue.queueid).map((m) => m.systemuserid);
  const members = memberIds.map((m) => store.find("systemuser", m)).filter(Boolean)
    .filter((u) => !search || String(u!.fullname).toLowerCase().includes(search.toLowerCase())) as Row[];
  const method = ASSIGNMENT_LABELS[queue.msdyn_assignmentstrategy];
  const methodInfo = P["assignment-method"].methods.find((m) => m.name === method);
  const overflow = queue._msdyn_inqueueoverflowrulesetid_value || queue._msdyn_prequeueoverflowrulesetid_value;
  return (
    <section>
      <Notice />
      <CommandBar><Button appearance="subtle">Refresh</Button></CommandBar>
      <div className="admin-row">
        <div>
          <Crumbs items={[{ label: "Queues", to: { page: "queues" } }, { label: "Advanced queues", to: { page: "advanced-queues" } }]} />
          <h1 className="admin-title">{queue.name} <Tooltip content={NOT_YET} relationship="description"><Button appearance="transparent" size="small" disabled>{def.edit}</Button></Tooltip></h1>
        </div>
        <Facts items={[[def.header.type, QUEUE_TYPE_LABELS[queue.msdyn_queuetype] ?? ""], [def.header.owner, LEARNER.userName]]} />
      </div>

      <div className="admin-card">
        <TabList selectedValue="users" size="small">
          <Tab value="users">{def.users.tabs[0]}</Tab>
          <Tab value="groups" disabled>{def.users.tabs[1]}</Tab>
        </TabList>
        <div className="admin-row admin-card-commands">
          <Input size="small" placeholder={def.users.search} value={search} onChange={(_, v) => setSearch(v.value)} />
          <span>
            <Off>{def.users.seeMore}</Off>
            <Button appearance="subtle" onClick={() => setPanel(true)}>+ {def.users.addUsers}</Button>
            <Info concept={def.users.concept} />
          </span>
        </div>
        {memberIds.length ? (
          <Table size="small" aria-label={def.users.tabs[0]}>
            <TableHeader><TableRow>{def.users.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
            <TableBody>
              {members.map((u) => (
                <TableRow key={u.systemuserid}>
                  <TableCell>{u.fullname}</TableCell><TableCell>User</TableCell><TableCell>{rolesOf(store, u.systemuserid) || "–"}</TableCell>
                  <TableCell>{profilesOf(store, u.systemuserid) || "–"}</TableCell><TableCell>–</TableCell><TableCell>{unitName(store, u)}</TableCell><TableCell>–</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="admin-muted">{def.users.empty}</p>}
        {memberIds.length > 0 && <p className="admin-muted admin-right">{members.length} of {memberIds.length}</p>}
      </div>

      <div className="admin-grid">
        <div className="admin-card">
          <div className="admin-row">
            <h2 className="admin-subtitle">{def.assignmentMethod.title} <Info concept={def.assignmentMethod.concept} /></h2>
            <Button appearance="subtle" onClick={() => go({ page: "assignment-method", id })}>{def.assignmentMethod.seeMore}</Button>
          </div>
          {method ? <><p><strong>{method}</strong> <span className="admin-tag">{def.assignmentMethod.readOnly}</span></p><p className="admin-muted admin-tight">{methodInfo?.description}</p></> : <p className="admin-muted">{def.assignmentMethod.none}</p>}
        </div>
        <div className="admin-card">
          <div className="admin-row"><h2 className="admin-subtitle">{def.overflow.title} <Info concept="overflow" /></h2><Button appearance="subtle" onClick={() => go({ page: "overflow", id })}>{def.overflow.edit}</Button></div>
          {overflow && (pairs.before.length || pairs.queued.length)
            ? <ul className="admin-pairs">{[...pairs.before, ...pairs.queued].map((pr, i) => <li key={i}>{pairLabel(store, pr)}</li>)}</ul>
            : <p className="admin-muted">{def.overflow.none}</p>}
        </div>
      </div>
      <div className="admin-card">
        <div className="admin-row"><h2 className="admin-subtitle">{def.operationHours.title} <span className="admin-optional">{def.operationHours.optional}</span></h2><Button appearance="subtle" onClick={() => setHoursOpen(true)}>{def.operationHours.button}</Button></div>
        <p className="admin-muted admin-tight">{queue._msdyn_operatinghourid_value ? `Operation hours: ${store.find("msdyn_operatinghour", queue._msdyn_operatinghourid_value)?.msdyn_name ?? ""}` : def.operationHours.text}</p>
      </div>
      <div className="admin-card admin-row">
        <h2 className="admin-subtitle">{def.metrics.title} <span className="admin-optional">{def.metrics.optional}</span></h2><Off>{def.metrics.button}</Off>
      </div>
      {panel && <AddUsersPanel queueId={queue.queueid} memberIds={memberIds} onClose={() => setPanel(false)} />}
      {hoursOpen && <OperationHoursDialog queueId={queue.queueid} onClose={() => setHoursOpen(false)} />}
    </section>
  );
}

function AddUsersPanel({ queueId, memberIds, onClose }: { queueId: string; memberIds: string[]; onClose: () => void }) {
  const { store, admin, explain } = useUi();
  const def = P.queue.addUsersPanel;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const users = store.table("systemuser")
    .filter((u) => u.accessmode === 0 && !u.isdisabled && !memberIds.includes(u.systemuserid))
    .filter((u) => !search || String(u.fullname).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => String(a.fullname).localeCompare(String(b.fullname)));
  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <OverlayDrawer open position="end" size="large" onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label="Close" onClick={onClose}>✕</Button>}>{def.title}</DrawerHeaderTitle>
        <div className="admin-row">
          <p className="admin-muted admin-tight">{def.intro} <button className="admin-link" onClick={() => explain("queue-users")}>Learn more</button></p>
          <Input size="small" placeholder={def.search} value={search} onChange={(_, v) => setSearch(v.value)} />
        </div>
      </DrawerHeader>
      <DrawerBody>
        <Table size="small" aria-label={def.title}>
          <TableHeader><TableRow><TableHeaderCell className="admin-check" />{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.systemuserid}>
                <TableCell className="admin-check"><Checkbox aria-label={`Select ${u.fullname}`} checked={picked.has(u.systemuserid)} onChange={(_, d) => toggle(u.systemuserid, !!d.checked)} /></TableCell>
                <TableCell>{u.fullname}</TableCell><TableCell>User</TableCell><TableCell>{rolesOf(store, u.systemuserid) || "–"}</TableCell>
                <TableCell>{profilesOf(store, u.systemuserid) || "–"}</TableCell><TableCell>–</TableCell><TableCell>{unitName(store, u)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DrawerBody>
      <DrawerFooter className="admin-drawer-actions">
        <Button appearance="primary" disabled={!picked.size} onClick={() => { addUsers(admin, queueId, [...picked]); onClose(); }}>{def.submit}</Button>
        <Button onClick={onClose}>{def.cancel}</Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}

function AssignmentMethodPage({ id }: { id: string }) {
  const { store, admin, go } = useUi();
  const def = P["assignment-method"];
  const queue = store.find("queue", id);
  const [choice, setChoice] = useState<string>(queue ? ASSIGNMENT_LABELS[queue.msdyn_assignmentstrategy] ?? "" : "");
  if (!queue) return <p>This queue no longer exists.</p>;
  const save = () => { if (choice && choice in ASSIGNMENT_METHODS) setAssignmentMethod(admin, id, choice as AssignmentMethod); go({ page: "queue", id }); };
  return (
    <section>
      <CommandBar><Button appearance="subtle" onClick={save}>{def.saveClose}</Button><Button appearance="subtle">{def.refresh}</Button></CommandBar>
      <Crumbs items={[{ label: "Queues", to: { page: "queues" } }, { label: "Advanced queues", to: { page: "advanced-queues" } }, { label: queue.name, to: { page: "queue", id } }]} />
      <div className="admin-row">
        <h1 className="admin-title">{def.title}</h1>
        <Tooltip content={NOT_YET} relationship="description"><Button appearance="primary" disabled>{def.createNew}</Button></Tooltip>
      </div>
      <p className="admin-muted">{def.intro}</p>
      <div className="admin-card admin-methods" role="radiogroup" aria-label={def.title}>
        {def.methods.map((m) => (
          <label key={m.name} className={`admin-method${choice === m.name ? " picked" : ""}${m.notInTraining ? " off" : ""}`}>
            <Radio value={m.name} checked={choice === m.name} disabled={!!m.notInTraining} onChange={() => setChoice(m.name)} aria-label={m.name} />
            <span><strong>{m.name}</strong> <span className="admin-tag">{def.readOnly}</span><br /><span className="admin-muted">{m.description}</span></span>
          </label>
        ))}
      </div>
    </section>
  );
}

// ---- Workstreams ----

function Workstreams() {
  const { store, go } = useUi();
  const def = P.workstreams;
  const rows = store.table("msdyn_liveworkstream").filter((w) => w.statecode === 0).sort((a, b) => String(a.msdyn_name).localeCompare(String(b.msdyn_name)));
  const [creating, setCreating] = useState(false);
  return (
    <section>
      <CommandBar><Button appearance="subtle" onClick={() => setCreating(true)}>{`+ ${def.newButton}`}</Button><Button appearance="subtle">{def.refresh}</Button></CommandBar>
      {creating && <CreateWorkstreamDialog onClose={() => setCreating(false)} />}
      <h1 className="admin-title">{def.title}</h1>
      <p className="admin-muted admin-tight">{def.view} · Showing {rows.length} results</p>
      <Table size="small" aria-label={def.title}>
        <TableHeader><TableRow>{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((w) => (
            <TableRow key={w.msdyn_liveworkstreamid}>
              <TableCell><button className="admin-link" onClick={() => go({ page: "workstream", id: w.msdyn_liveworkstreamid })}>{w.msdyn_name}</button></TableCell>
              <TableCell>{(def.directions as Record<string, string>)[String(w.msdyn_direction ?? 0)] ?? ""}</TableCell>
              <TableCell>{(def.types as Record<string, string>)[String(w.msdyn_streamsource)] ?? def.otherType}</TableCell>
              <TableCell>{w.msdyn_streamsource === VOICE_STREAM ? def.voiceChannel : "–"}</TableCell>
              <TableCell>N/A</TableCell>
              <TableCell>{LEARNER.userName}</TableCell>
              <TableCell>{date(w.createdon)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function WorkstreamPage({ id }: { id: string }) {
  const { store, admin, go, queueName } = useUi();
  const def = P.workstream;
  const rr = def.routingRules;
  const ws = store.find("msdyn_liveworkstream", id);
  const [editFallback, setEditFallback] = useState(false);
  const [editHit, setEditHit] = useState(false);
  if (!ws) return <p>This workstream no longer exists.</p>;
  const ruleset = routeToQueueRuleset(store, id);
  const hit = hitPolicyOf(ruleset);
  const classifications = classificationRulesets(store, id);
  const voice = ws.msdyn_streamsource === VOICE_STREAM;
  const queues = store.table("queue").filter((q) => q.msdyn_isomnichannelqueue === true && q.statecode === 0 && (!voice || q.msdyn_queuetype === VOICE_QUEUE))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const channels = store.table("msdyn_ocvoicechannelsetting").filter((c) => c._msdyn_liveworkstreamid_value === id);
  const capacity = store.table("msdyn_liveworkstreamcapacityprofile").filter((l) => l._msdyn_workstream_id_value === id).map((l) => store.find("msdyn_capacityprofile", l._msdyn_capacityprofile_id_value)?.msdyn_name).filter(Boolean);
  const presences = String(ws.msdyn_allowedpresences ?? "").split(",").map((p) => (def.workDistribution.presences as Record<string, string>)[p.trim()]).filter(Boolean);
  const bot = ws._msdyn_bot_user_value ? store.find("systemuser", ws._msdyn_bot_user_value) : undefined;
  const fallbackPicker = (
    <Dropdown aria-label={rr.fallbackQueue} value={queueName(ws._msdyn_defaultqueue_value) ?? ""} selectedOptions={ws._msdyn_defaultqueue_value ? [ws._msdyn_defaultqueue_value] : []}
      onOptionSelect={(_, d) => { if (d.optionValue) { setFallbackQueue(admin, id, d.optionValue); setEditFallback(false); } }}>
      {queues.map((q) => <Option key={q.queueid} value={q.queueid}>{q.name}</Option>)}
    </Dropdown>
  );
  return (
    <section>
      <Notice />
      <CommandBar><Button appearance="subtle">Refresh</Button></CommandBar>
      <div className="admin-row">
        <div>
          <Crumbs items={[{ label: "Workstreams", to: { page: "workstreams" } }]} />
          <h1 className="admin-title">{ws.msdyn_name} <Tooltip content={NOT_YET} relationship="description"><Button appearance="transparent" size="small" disabled>{def.edit}</Button></Tooltip></h1>
        </div>
        <Facts items={[[def.header.channel, voice ? P.workstreams.voiceChannel : "–"], [def.header.type, (P.workstreams.types as Record<string, string>)[String(ws.msdyn_streamsource)] ?? P.workstreams.otherType], [def.header.owner, LEARNER.userName]]} />
      </div>

      {voice && (
        <div className="admin-card">
          <h2 className="admin-subtitle">Voice</h2>
          {channels.length ? channels.map((c) => <p key={c.msdyn_ocvoicechannelsettingid} className="admin-tight">{c.msdyn_name} · {store.find("msdyn_ocphonenumber", c._msdyn_phonenumberid_value ?? "")?.msdyn_phonenumber ?? "no number"}</p>) : <p className="admin-muted">No voice channel yet.</p>}
        </div>
      )}

      <div className="admin-card">
        <h2 className="admin-subtitle">{rr.title} <Info concept={rr.concept} /></h2>
        {!ws._msdyn_defaultqueue_value && (
          <MessageBar intent="warning"><MessageBarBody>{rr.noFallback}</MessageBarBody><Button size="small" onClick={() => setEditFallback(true)}>{rr.setUpFallback}</Button></MessageBar>
        )}
        <div className="admin-section">
          <div className="admin-row">
            <div><strong>{rr.classification}</strong><p className="admin-muted admin-tight">{rr.classificationText}</p></div>
            <Button appearance="subtle" onClick={() => go({ page: "classification", id })}>{classifications.length || skillRules(store, id).length ? "See more" : `+ ${rr.createRuleset}`}</Button>
          </div>
          {classifications.length > 0 && <p className="admin-tight">{classifications.length} {rr.rulesets}{classifications.length === 1 ? "" : "s"}: {classifications.map((r) => r.msdyn_name).join(", ")}</p>}
          {skillRules(store, id).length > 0 && <p className="admin-tight">{skillRules(store, id).length} skill attachment rule{skillRules(store, id).length === 1 ? "" : "s"}</p>}
        </div>
        <div className="admin-section">
          <div className="admin-row">
            <div><strong>{rr.routeToQueues}</strong><p className="admin-muted admin-tight">{rr.routeToQueuesText}</p></div>
            {!ruleset && <Button appearance="subtle" onClick={() => go({ page: "decision-list", id })}>+ {rr.createRuleset}</Button>}
          </div>
          <div className="admin-settings">
            <span>{rr.fallbackQueue} <Info concept={rr.fallbackConcept} /></span>
            {editFallback ? fallbackPicker : <span>{queueName(ws._msdyn_defaultqueue_value) ?? "--"}</span>}
            <Button appearance="transparent" size="small" onClick={() => setEditFallback((e) => !e)}>{editFallback ? "Cancel" : "Edit"}</Button>
            {ruleset && (
              <>
                <span>{rr.hitPolicy} <Info concept="rule-hit-policy" /></span>
                {editHit
                  ? (
                    <Dropdown aria-label={rr.hitPolicy} value={rr.hitPolicies[hit ?? "all"]} selectedOptions={[hit ?? "all"]}
                      onOptionSelect={(_, d) => { if (d.optionValue) { setHitPolicy(admin, id, d.optionValue as "first" | "all"); setEditHit(false); } }}>
                      <Option value="all">{rr.hitPolicies.all}</Option>
                      <Option value="first">{rr.hitPolicies.first}</Option>
                    </Dropdown>
                  )
                  : <span>{rr.hitPolicies[hit ?? "all"]}</span>}
                <Button appearance="transparent" size="small" aria-label={`${editHit ? "Cancel" : "Edit"} ${rr.hitPolicy}`} onClick={() => setEditHit((e) => !e)}>{editHit ? "Cancel" : "Edit"}</Button>
              </>
            )}
          </div>
          {ruleset && (
            <Table size="small" aria-label={rr.routeToQueues}>
              <TableHeader><TableRow>{rr.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell><button className="admin-link" onClick={() => go({ page: "decision-list", id })}>{ruleset.msdyn_name}</button></TableCell>
                  <TableCell>{rr.rulesetType}</TableCell>
                  <TableCell>{ruleset.msdyn_description ?? ""}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="admin-grid">
        <div className="admin-card">
          <div className="admin-row"><h2 className="admin-subtitle">{def.workDistribution.title}</h2><Off>{def.workDistribution.seeMore}</Off></div>
          <dl className="admin-dl">
            <dt>{def.workDistribution.mode}</dt><dd>{(def.workDistribution.modes as Record<string, string>)[String(ws.msdyn_workdistributionmode ?? 192350000)]}</dd>
            <dt>{def.workDistribution.capacity}</dt><dd>{capacity.length ? `${def.workDistribution.profileBased}: ${capacity.join(", ")}` : "–"}</dd>
            <dt>{def.workDistribution.allowedPresences}</dt><dd>{presences.length ? presences.join(", ") : "–"}</dd>
            <dt>{def.workDistribution.matching} <Info concept="skill-matching" /></dt>
            <dd>
              <Dropdown aria-label={def.workDistribution.matching} size="small" value={matchingOf(ws) ?? def.workDistribution.matchingNone} selectedOptions={[matchingOf(ws) ?? "none"]}
                onOptionSelect={(_, d) => setMatchingLogic(admin, id, d.optionValue === "none" ? undefined : d.optionValue as Matching)}>
                <Option value="none">{def.workDistribution.matchingNone}</Option>
                {def.workDistribution.matchingOptions.map((m) => <Option key={m} value={m}>{m}</Option>)}
              </Dropdown>
            </dd>
          </dl>
        </div>
        <div className="admin-card">
          <div className="admin-row"><h2 className="admin-subtitle">{def.aiAgent.title} <span className="admin-optional">{def.aiAgent.optional}</span></h2>{!bot && <Off>{`+ ${def.aiAgent.add}`}</Off>}</div>
          <p className="admin-tight">{bot ? bot.fullname : <span className="admin-muted">No AI agent.</span>}</p>
        </div>
      </div>
      <p className="admin-muted">⌄ {def.advanced}</p>
    </section>
  );
}

function DecisionList({ id }: { id: string }) {
  const { store, admin, queueName } = useUi();
  const def = P["decision-list"];
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<RouteRule | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ws = store.find("msdyn_liveworkstream", id);
  const ruleset = routeToQueueRuleset(store, id);
  const rules = rulesOf(ruleset);
  const queuesOf = (rule: RouteRule) => rule.queues
    .map((q) => `${queueName(q.queueId) ?? "(deleted queue)"}${rule.queues.length > 1 ? ` (${q.percentage}%)` : ""}`).join(", ");
  const index = rules.findIndex((r) => r.id === selected);
  const picked = index >= 0 ? rules[index] : undefined;
  return (
    <section>
      <Crumbs items={[{ label: "Workstreams", to: { page: "workstreams" } }, { label: ws?.msdyn_name ?? "", to: { page: "workstream", id } }]} />
      <div className="admin-row">
        <h1 className="admin-title">{ruleset?.msdyn_name ?? `${ws?.msdyn_name ?? ""} route to queue`} <Tooltip content={NOT_YET} relationship="description"><Button appearance="transparent" size="small" disabled>Edit</Button></Tooltip></h1>
        <Facts items={[[def.owner, LEARNER.userName]]} />
      </div>
      <div className="admin-card">
        <div className="admin-row">
          <h2 className="admin-subtitle">{def.title}</h2>
          <span>
            <Button appearance="subtle" onClick={() => setOpen(true)}>+ {def.createRule}</Button>
            <Button appearance="subtle">{def.refresh}</Button>
            <Button appearance="subtle" disabled={!picked || index === 0} onClick={() => moveRule(admin, ruleset!, picked!.id, -1)}>↑ {def.commands[0]}</Button>
            <Button appearance="subtle" disabled={!picked || index === rules.length - 1} onClick={() => moveRule(admin, ruleset!, picked!.id, 1)}>↓ {def.commands[1]}</Button>
            <Button appearance="subtle" disabled={!picked} onClick={() => setEditing(readRouteRule(picked!))}>{def.commands[2]}</Button>
            <Button appearance="subtle" disabled={!picked} onClick={() => setConfirmDelete(true)}>{def.commands[3]}</Button>
          </span>
        </div>
        <MessageBar intent="info"><MessageBarBody>{def.info}</MessageBarBody></MessageBar>
        <Table size="small" aria-label={def.title}>
          <TableHeader><TableRow><TableHeaderCell className="admin-check" />{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
          <TableBody>
            {rules.map((r, i) => {
              const rule = readRouteRule(r);
              return (
                <TableRow key={r.id} className={r.id === selected ? "admin-selected" : undefined}>
                  <TableCell className="admin-check"><Radio aria-label={`Select ${r.name}`} checked={r.id === selected} onChange={() => setSelected(r.id)} /></TableCell>
                  <TableCell>{i + 1}</TableCell><TableCell>{r.name}</TableCell><TableCell>{describeConditions(rule.conditions)}</TableCell><TableCell>{queuesOf(rule)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!rules.length && <p className="admin-muted">No rules yet. Select {def.createRule}.</p>}
      </div>
      {open && <RouteRulePanel workstreamId={id} onClose={() => setOpen(false)} />}
      {editing && <RouteRulePanel workstreamId={id} rule={editing} onClose={() => setEditing(undefined)} />}
      {confirmDelete && picked && (
        <Dialog open onOpenChange={(_, d) => { if (!d.open) setConfirmDelete(false); }}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Delete rule</DialogTitle>
              <DialogContent>Delete the rule “{picked.name}”? Calls it routes go to the next matching rule, or to the fallback queue.</DialogContent>
              <DialogActions>
                <Button appearance="primary" onClick={() => { deleteRule(admin, ruleset!, picked.id); setSelected(undefined); setConfirmDelete(false); }}>{def.commands[3]}</Button>
                <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </section>
  );
}

// The rule panel's name, root record and conditions, shared by route-to-queue and work classification rules.
function RuleBasics({ name, setName, conditions, setConditions, workstreamId, rootText }: {
  name: string; setName(v: string): void; conditions: RouteRule["conditions"]; setConditions(c: RouteRule["conditions"]): void; workstreamId: string; rootText: string;
}) {
  const { store } = useUi();
  const d = P["decision-list"].panel;
  return (
    <>
      <Field label={d.ruleName} required><Input value={name} onChange={(_, v) => setName(v.value)} /></Field>
      <div><strong>{d.rootRecord}</strong> {d.rootRecordName}<p className="admin-muted admin-tight">{rootText}</p></div>
      <div className="admin-section">
        <h3 className="admin-subtitle">{d.conditions}</h3>
        <ConditionBuilder value={conditions} onChange={setConditions} fields={ruleFields(store, workstreamId)} />
        <p className="admin-muted admin-small">{d.simplified}</p>
      </div>
    </>
  );
}

function RouteRulePanel({ workstreamId, rule, onClose }: { workstreamId: string; rule?: RouteRule; onClose: () => void }) {
  const { store, admin, explain } = useUi();
  const d = P["decision-list"].panel;
  const queues = store.table("queue").filter((q) => q.msdyn_isomnichannelqueue === true && q.statecode === 0 && q.msdyn_queuetype === VOICE_QUEUE)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const members = (queueId: string) => store.table("queuemembership").filter((m) => m.queueid === queueId).length;
  const label = (q: Row) => `${q.name} (${members(q.queueid)} ${d.users}${members(q.queueid) === 1 ? "" : "s"})`;
  const [name, setName] = useState(rule?.name ?? "");
  const [conditions, setConditions] = useState(rule?.conditions ?? emptyConditions());
  const [shares, setShares] = useState<QueueShare[]>(rule?.queues ?? [{ queueId: "", percentage: "" }]);
  const [error, setError] = useState("");
  const split = shares.length > 1;
  const total = shares.reduce((sum, s) => sum + (Number(s.percentage) || 0), 0);
  const setShare = (i: number, change: Partial<QueueShare>) => setShares((all) => all.map((s, j) => (j === i ? { ...s, ...change } : s)));
  const save = () => {
    try {
      saveRouteRule(admin, workstreamId, { id: rule?.id, name, conditions, queues: shares });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <OverlayDrawer open position="end" size="large" onOpenChange={(_, o) => { if (!o.open) onClose(); }}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label="Close" onClick={onClose}>✕</Button>}>{rule ? rule.name : d.title}</DrawerHeaderTitle>
        <p className="admin-muted admin-tight">{d.intro} <button className="admin-link" onClick={() => explain("create-rule")}>Learn more</button></p>
      </DrawerHeader>
      <DrawerBody className="admin-form">
        <RuleBasics name={name} setName={setName} conditions={conditions} setConditions={setConditions} workstreamId={workstreamId} rootText={d.rootRecordText} />
        <div className="admin-section">
          <div className="admin-row">
            <h3 className="admin-subtitle">{d.routeToQueues} {split && <Info concept="percentage-routing" />}</h3>
            <span>
              <Button appearance="subtle" disabled={shares.length >= MAX_QUEUES} onClick={() => setShares((all) => [...all, { queueId: "", percentage: "" }])}>+ {d.addQueue}</Button>
              <Menu>
                <MenuTrigger disableButtonEnhancement><Button appearance="subtle" aria-label={d.moreCommands}>⋮</Button></MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem disabled={!split} onClick={() => setShares((all) => [{ ...all[0], percentage: "" }])}>{d.removeAllocations}</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </span>
          </div>
          {shares.map((s, i) => (
            <div key={i} className="admin-condition">
              <Field label={d.queue} required>
                <Dropdown placeholder={d.queuePlaceholder} value={queues.find((q) => q.queueid === s.queueId)?.name ?? ""} selectedOptions={s.queueId ? [s.queueId] : []}
                  onOptionSelect={(_, o) => setShare(i, { queueId: o.optionValue ?? "" })}>
                  {queues.map((q) => <Option key={q.queueid} value={q.queueid} text={String(q.name)}>{label(q)}</Option>)}
                </Dropdown>
              </Field>
              {split && (
                <Field label={d.workAllocation} required>
                  <Input type="number" min={1} max={99} value={s.percentage} onChange={(_, v) => setShare(i, { percentage: v.value })} contentAfter="%" />
                </Field>
              )}
              {split && <Button appearance="subtle" aria-label={`${d.removeQueue} ${i + 1}`} onClick={() => setShares((all) => all.filter((_, j) => j !== i))}>✕</Button>}
            </div>
          ))}
          {split && <p className={total === 100 ? "admin-muted" : "admin-warning"}>{d.total}: {total}%{total === 100 ? "" : " (must be 100)"}</p>}
        </div>
        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      </DrawerBody>
      <DrawerFooter className="admin-drawer-actions">
        <Button appearance="primary" onClick={save}>{rule ? "Save and close" : d.submit}</Button>
        <Button onClick={onClose}>{d.cancel}</Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}

// ---- Channels › Phone numbers (the number pool, manual 5.1) ----

function ChannelsHome() {
  const { go } = useUi();
  const def = P.channels;
  return (
    <section>
      <h1 className="admin-title">{def.title}</h1>
      {def.cards.map((c) => (
        <div key={c.title} className="admin-card admin-row">
          <div><h2 className="admin-subtitle">{c.title}</h2><p className="admin-muted admin-tight">{c.description}</p></div>
          <Button appearance="primary" onClick={() => go({ page: "phone-numbers" })}>{c.action}</Button>
        </div>
      ))}
    </section>
  );
}

function PhoneNumbers() {
  const { store, explain } = useUi();
  const def = P["phone-numbers"];
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const [setup, setSetup] = useState(false);
  const numbers = store.table("msdyn_ocphonenumber").filter((n) => n.statecode !== 1).sort((a, b) => String(a.msdyn_phonenumber).localeCompare(String(b.msdyn_phonenumber)));
  const chosen = selected ? store.find("msdyn_ocphonenumber", selected) : undefined;
  const ready = chosen && !channelOfNumber(store, chosen.msdyn_ocphonenumberid);
  const plan = (n: Row) => [n.msdyn_phoneinboundenabled ? def.plans.receive : "", n.msdyn_phoneoutboundenabled ? def.plans.make : ""].filter(Boolean).join(", ") || "–";
  return (
    <section>
      <Notice />
      <CommandBar>
        <Button appearance="subtle" onClick={() => setAdding(true)}>+ {def.add}</Button>
        <Button appearance="subtle" disabled={!ready} onClick={() => setSetup(true)}>{def.setup}</Button>
        <Off>{def.edit}</Off>
        <Off>{def.release}</Off>
      </CommandBar>
      <Crumbs items={[{ label: "Channels", to: { page: "channels" } }]} />
      <h1 className="admin-title">{def.title} <Info concept={def.concept} /></h1>
      <Table aria-label={def.title} size="small">
        <TableHeader><TableRow><TableHeaderCell><span className="visually-hidden">Select</span></TableHeaderCell>{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {numbers.map((n) => {
            const channel = channelOfNumber(store, n.msdyn_ocphonenumberid);
            const ws = channel?._msdyn_liveworkstreamid_value ? store.find("msdyn_liveworkstream", channel._msdyn_liveworkstreamid_value) : undefined;
            return (
              <TableRow key={n.msdyn_ocphonenumberid}>
                <TableCell><Radio aria-label={`Select ${n.msdyn_phonenumber}`} checked={selected === n.msdyn_ocphonenumberid} onChange={() => { setSelected(n.msdyn_ocphonenumberid); explain("phone-number"); }} /></TableCell>
                <TableCell>{n.msdyn_phonenumber}</TableCell>
                <TableCell>{def.carrier}</TableCell>
                <TableCell>{plan(n)}</TableCell>
                <TableCell>{ws?.msdyn_name ?? "–"}</TableCell>
                <TableCell>{channel ? def.status.connected : def.status.ready}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {adding && <AddNumberDialog onClose={(id) => { setAdding(false); if (id) setSelected(id); }} />}
      {setup && chosen && <SetupWorkstreamDialog phoneId={chosen.msdyn_ocphonenumberid} onClose={() => setSetup(false)} />}
    </section>
  );
}

function AddNumberDialog({ onClose }: { onClose(id?: string): void }) {
  const { store, admin, explain } = useUi();
  const def = P["phone-numbers"].dialog;
  const [country, setCountry] = useState<NumberCountry>("United States");
  const locations = Object.keys(NUMBER_COUNTRIES[country].locations);
  const [location, setLocation] = useState(locations[0]);
  const [receive, setReceive] = useState(true);
  const [make, setMake] = useState(false);
  const [found, setFound] = useState<string | undefined>();
  const [bought, setBought] = useState<string | undefined>();
  const [error, setError] = useState("");
  const find = () => {
    setError("");
    if (!receive && !make) { setError("Select at least one calling plan."); return; }
    const n = findNumber(store, country, location);
    if (!n) setError("There are no free numbers left in this location. Pick another one.");
    setFound(n);
  };
  const purchase = () => {
    try { setBought(purchaseNumber(admin, found!, { receive, make })); explain("phone-number"); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(bought); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{def.title}</DialogTitle>
          <DialogContent>
            {!found ? (
              <div className="admin-form">
                <h3 className="admin-subtitle">{def.features}</h3>
                <Field label={def.country}>
                  <Dropdown value={country} selectedOptions={[country]} onOptionSelect={(_, d) => { const c = d.optionValue as NumberCountry; setCountry(c); setLocation(Object.keys(NUMBER_COUNTRIES[c].locations)[0]); }}>
                    {Object.keys(NUMBER_COUNTRIES).map((c) => <Option key={c} value={c}>{c}</Option>)}
                  </Dropdown>
                </Field>
                <Field label={def.numberType}>
                  <div className="admin-choices"><Radio label={def.tollFree} disabled checked={false} /><Radio label={def.geographic} checked readOnly /></div>
                </Field>
                <Field label={def.callingPlans}>
                  <div className="admin-choices"><Checkbox label={P["phone-numbers"].plans.receive} checked={receive} onChange={(_, d) => setReceive(!!d.checked)} /><Checkbox label={P["phone-numbers"].plans.make} checked={make} onChange={(_, d) => setMake(!!d.checked)} /></div>
                </Field>
                <Field label={def.smsPlans}>
                  <div className="admin-choices"><Radio label={def.smsNone} checked readOnly /><Radio label={def.smsSend} disabled checked={false} /><Radio label={def.smsSendReceive} disabled checked={false} /></div>
                </Field>
                <Field label={def.location}>
                  <Dropdown value={location} selectedOptions={[location]} onOptionSelect={(_, d) => setLocation(String(d.optionValue))}>
                    {locations.map((l) => <Option key={l} value={l}>{l}</Option>)}
                  </Dropdown>
                </Field>
                <p className="admin-muted">{def.fiction} {def.usOnly}</p>
              </div>
            ) : (
              <div className="admin-form">
                <h3 className="admin-subtitle">{def.summary}</h3>
                <Facts items={[[def.country, country], [def.numberType, def.geographic], [def.callingPlans, [receive && P["phone-numbers"].plans.receive, make && P["phone-numbers"].plans.make].filter(Boolean).join(", ")], [def.smsPlans, def.smsNone]]} />
                <p className="admin-number">{found}</p>
                {bought && <MessageBar intent="success"><MessageBarBody>The number is yours, with the status {P["phone-numbers"].status.ready}. Select it and choose {P["phone-numbers"].setup} to put it on a voice workstream.</MessageBarBody></MessageBar>}
              </div>
            )}
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions>
            {!found && <Button appearance="primary" onClick={find}>{def.find}</Button>}
            {found && !bought && <Button appearance="primary" onClick={purchase}>{def.purchase}</Button>}
            {bought ? <Button appearance="primary" onClick={() => onClose(bought)}>{def.done}</Button> : <Button onClick={() => onClose()}>Cancel</Button>}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function SetupWorkstreamDialog({ phoneId, onClose }: { phoneId: string; onClose(): void }) {
  const { store, admin, explain } = useUi();
  const def = P["phone-numbers"].setupDialog;
  const voice = store.table("msdyn_liveworkstream").filter((w) => w.statecode === 0 && w.msdyn_streamsource === VOICE_STREAM).sort((a, b) => String(a.msdyn_name).localeCompare(String(b.msdyn_name)));
  const [ws, setWs] = useState<string | undefined>();
  const [error, setError] = useState("");
  const save = () => {
    try { setupWorkstream(admin, phoneId, ws!); explain("voice-channel"); onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{def.title}</DialogTitle>
          <DialogContent>
            <p>{def.intro}</p>
            <Field label={def.workstream} required>
              <Dropdown placeholder="Select a workstream" value={ws ? String(store.find("msdyn_liveworkstream", ws)?.msdyn_name ?? "") : ""} selectedOptions={ws ? [ws] : []} onOptionSelect={(_, d) => setWs(d.optionValue)}>
                {voice.map((w) => <Option key={w.msdyn_liveworkstreamid} value={w.msdyn_liveworkstreamid}>{w.msdyn_name}</Option>)}
              </Dropdown>
            </Field>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!ws} onClick={save}>Save and close</Button>
            <Button onClick={onClose}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---- Queue: Set operation hours, Overflow handling ----

const OF = P.queue.overflow;
const CONDITIONS = OF.conditions as Record<OverflowCondition, string>;
const UNITS = OF.units as Record<string, string>;

function pairLabel(store: Store, p: OverflowPair): string {
  const target = p.targetQueueId ? ` (${store.find("queue", p.targetQueueId)?.name ?? "a queue"})` : "";
  return `${CONDITIONS[p.condition]}${p.value !== undefined ? ` ${p.value} ${UNITS[p.condition] ?? ""}` : ""} → ${p.action}${target}`;
}

function OperationHoursDialog({ queueId, onClose }: { queueId: string; onClose(): void }) {
  const { store, admin, explain } = useUi();
  const def = P.queue.operationHoursDialog;
  const current = store.find("queue", queueId)?._msdyn_operatinghourid_value as string | undefined;
  const [hours, setHours] = useState<string | undefined>(current);
  const [error, setError] = useState("");
  const records = store.table("msdyn_operatinghour").filter((h) => h.statecode !== 1);
  const save = () => { try { setOperationHours(admin, queueId, hours!); explain("operating-hours"); onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{def.title}</DialogTitle>
          <DialogContent>
            <Field label={def.name} required>
              <Dropdown placeholder="Select an operating hour record" value={hours ? String(store.find("msdyn_operatinghour", hours)?.msdyn_name ?? "") : ""} selectedOptions={hours ? [hours] : []} onOptionSelect={(_, d) => setHours(d.optionValue)}>
                {records.map((h) => <Option key={h.msdyn_operatinghourid} value={h.msdyn_operatinghourid}>{h.msdyn_name}</Option>)}
              </Dropdown>
            </Field>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions><Button appearance="primary" disabled={!hours} onClick={save}>{def.save}</Button><Button onClick={onClose}>Cancel</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function OverflowPage({ id }: { id: string }) {
  const { store, admin, go, explain } = useUi();
  const queue = store.find("queue", id);
  const [pairs, setPairs] = useState(() => readOverflow(store, id));
  const [error, setError] = useState("");
  if (!queue) return <p>This queue no longer exists.</p>;
  const queues = store.table("queue").filter((q) => q.msdyn_isomnichannelqueue === true && q.statecode === 0 && q.queueid !== id && q.msdyn_queuetype === VOICE_QUEUE);
  const stage = (key: "before" | "queued", conditions: OverflowCondition[], actions: string[]) => (
    <div className="admin-card">
      <h2 className="admin-subtitle">{OF[key]}</h2>
      {pairs[key].map((p, i) => {
        const set = (change: Partial<OverflowPair>) => setPairs((all) => ({ ...all, [key]: all[key].map((x, j) => (j === i ? { ...x, ...change } : x)) }));
        return (
          <div key={i} className="admin-pair">
            <Field label={OF.condition}>
              <Dropdown value={CONDITIONS[p.condition]} selectedOptions={[p.condition]} onOptionSelect={(_, d) => set({ condition: d.optionValue as OverflowCondition, value: d.optionValue === "outOfHours" ? undefined : p.value })}>
                {conditions.map((c) => <Option key={c} value={c}>{CONDITIONS[c]}</Option>)}
              </Dropdown>
            </Field>
            {p.condition !== "outOfHours" && (
              <Field label={`${OF.value} (${UNITS[p.condition]})`}>
                <Input type="number" value={p.value === undefined ? "" : String(p.value)} onChange={(_, v) => set({ value: v.value === "" ? undefined : Number(v.value) })} />
              </Field>
            )}
            <Field label={OF.action}>
              <Dropdown value={p.action} selectedOptions={[p.action]} onOptionSelect={(_, d) => set({ action: d.optionValue as OverflowActionKind })}>
                {actions.map((a) => <Option key={a} value={a}>{a}</Option>)}
              </Dropdown>
            </Field>
            {p.action === "Transfer to a different queue" && (
              <Field label={OF.targetQueue}>
                <Dropdown placeholder="Select a queue" value={p.targetQueueId ? String(store.find("queue", p.targetQueueId)?.name ?? "") : ""} selectedOptions={p.targetQueueId ? [p.targetQueueId] : []} onOptionSelect={(_, d) => set({ targetQueueId: d.optionValue })}>
                  {queues.map((q) => <Option key={q.queueid} value={q.queueid}>{q.name}</Option>)}
                </Dropdown>
              </Field>
            )}
            <Button appearance="subtle" aria-label="Remove pair" onClick={() => setPairs((all) => ({ ...all, [key]: all[key].filter((_, j) => j !== i) }))}>✕</Button>
          </div>
        );
      })}
      <Button appearance="subtle" onClick={() => setPairs((all) => ({ ...all, [key]: [...all[key], { condition: conditions[0], action: actions[0] as OverflowActionKind, ...(conditions[0] === "outOfHours" ? {} : { value: 10 }) }] }))}>+ {OF.add}</Button>
    </div>
  );
  const save = () => {
    try { saveOverflow(admin, id, pairs.before, pairs.queued); explain("overflow"); go({ page: "queue", id }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <section>
      <Notice />
      <Crumbs items={[{ label: "Queues", to: { page: "queues" } }, { label: "Advanced queues", to: { page: "advanced-queues" } }, { label: queue.name, to: { page: "queue", id } }]} />
      <h1 className="admin-title">{OF.page} <Info concept="overflow" /></h1>
      {stage("before", ["outOfHours", "callsWaiting", "estimatedWait"], OF.actions)}
      {stage("queued", ["waitTime"], OF.queuedActions)}
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      <p className="admin-muted">{OF.source}</p>
      <div className="lesson-actions"><Button appearance="primary" onClick={save}>{OF.save}</Button><Button onClick={() => go({ page: "queue", id })}>Cancel</Button></div>
    </section>
  );
}

// ---- Workstreams: Create a workstream ----

function CreateWorkstreamDialog({ onClose }: { onClose(): void }) {
  const { store, admin, go } = useUi();
  const def = P.workstreams.createDialog;
  const [name, setName] = useState("");
  const [fallback, setFallback] = useState<string | undefined>();
  const [error, setError] = useState("");
  const queues = store.table("queue").filter((q) => q.msdyn_isomnichannelqueue === true && q.statecode === 0 && q.msdyn_queuetype === VOICE_QUEUE).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const create = () => { try { const id = createVoiceWorkstream(admin, name, fallback!); onClose(); go({ page: "workstream", id }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{def.title}</DialogTitle>
          <DialogContent>
            <div className="admin-form">
              <Field label={def.name} required><Input value={name} onChange={(_, v) => setName(v.value)} /></Field>
              <Field label={def.type}><Input value={def.voice} readOnly /></Field>
              <Field label={def.mode} hint={def.pushNote}><Input value={def.push} readOnly /></Field>
              <Field label={`${def.fallback} · ${def.chooseExisting}`} required>
                <Dropdown placeholder="Select a queue" value={fallback ? String(store.find("queue", fallback)?.name ?? "") : ""} selectedOptions={fallback ? [fallback] : []} onOptionSelect={(_, d) => setFallback(d.optionValue)}>
                  {queues.map((q) => <Option key={q.queueid} value={q.queueid}>{q.name}</Option>)}
                </Dropdown>
              </Field>
              <p className="admin-muted">{def.source}</p>
            </div>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions><Button appearance="primary" disabled={!name.trim() || !fallback} onClick={create}>{def.create}</Button><Button onClick={onClose}>Cancel</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---- User management › Capacity profiles ----

function UserManagement() {
  const { go } = useUi();
  const def = P["user-management"];
  return (
    <section>
      <h1 className="admin-title">{def.title}</h1>
      {def.cards.map((c) => (
        <div key={c.title} className="admin-card admin-row">
          <div><h2 className="admin-subtitle">{c.title}</h2><p className="admin-muted admin-tight">{c.description}</p></div>
          <Button appearance="primary" onClick={() => go({ page: c.page as "capacity-profiles" | "skills" })}>{c.action}</Button>
        </div>
      ))}
    </section>
  );
}

const profileUsers = (store: Store, profileId: string) => store.table("msdyn_bookableresourcecapacityprofile").filter((l) => l._msdyn_capacityprofileid_value === profileId)
  .map((l) => store.find("bookableresource", l._msdyn_bookableresourceid_value)?._userid_value).filter(Boolean).map((u) => store.find("systemuser", u)).filter(Boolean) as Row[];

function CapacityProfiles() {
  const { store, admin, go } = useUi();
  const def = P["capacity-profiles"];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("1");
  const [error, setError] = useState("");
  const profiles = store.table("msdyn_capacityprofile").sort((a, b) => String(a.msdyn_name).localeCompare(String(b.msdyn_name)));
  const create = () => { try { const id = createCapacityProfile(admin, name, Number(limit)); setOpen(false); go({ page: "capacity-profile", id }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return (
    <section>
      <CommandBar><Button appearance="subtle" onClick={() => setOpen(true)}>+ {def.createNew}</Button></CommandBar>
      <Crumbs items={[{ label: "User management", to: { page: "user-management" } }]} />
      <h1 className="admin-title">{def.title} <Info concept={def.concept} /></h1>
      <Table size="small" aria-label={def.title}>
        <TableHeader><TableRow>{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {profiles.map((p) => (
            <TableRow key={p.msdyn_capacityprofileid}>
              <TableCell><button className="admin-link" onClick={() => go({ page: "capacity-profile", id: p.msdyn_capacityprofileid })}>{p.msdyn_name}</button></TableCell>
              <TableCell>{p.msdyn_defaultmaxunits ?? "–"}</TableCell>
              <TableCell>{profileUsers(store, p.msdyn_capacityprofileid).length}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {open && (
        <Dialog open onOpenChange={(_, d) => { if (!d.open) setOpen(false); }}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{def.createDialog.title}</DialogTitle>
              <DialogContent>
                <div className="admin-form">
                  <Field label={def.createDialog.name} required><Input value={name} onChange={(_, v) => setName(v.value)} /></Field>
                  <Field label={def.createDialog.limit} required><Input type="number" value={limit} onChange={(_, v) => setLimit(v.value)} /></Field>
                  <p className="admin-muted">{def.source}</p>
                </div>
                {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
              </DialogContent>
              <DialogActions><Button appearance="primary" disabled={!name.trim()} onClick={create}>{def.createDialog.create}</Button><Button onClick={() => setOpen(false)}>Cancel</Button></DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </section>
  );
}

function CapacityProfilePage({ id }: { id: string }) {
  const { store, admin, explain } = useUi();
  const def = P["capacity-profiles"].profile;
  const profile = store.find("msdyn_capacityprofile", id);
  const [limit, setLimit] = useState(String(profile?.msdyn_defaultmaxunits ?? 1));
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  if (!profile) return <p>This capacity profile no longer exists.</p>;
  const users = profileUsers(store, id);
  const candidates = store.table("bookableresource").map((r) => store.find("systemuser", r._userid_value)).filter((u) => u && !users.some((x) => x.systemuserid === u.systemuserid)) as Row[];
  const run = (work: () => void) => { try { setError(""); work(); explain("capacity-profile"); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return (
    <section>
      <Notice />
      <Crumbs items={[{ label: "User management", to: { page: "user-management" } }, { label: P["capacity-profiles"].title, to: { page: "capacity-profiles" } }]} />
      <h1 className="admin-title">{profile.msdyn_name} <Info concept="capacity-profile" /></h1>
      <div className="admin-card">
        <h2 className="admin-subtitle">{def.details}</h2>
        <div className="admin-row admin-inline">
          <Field label={def.limit}><Input type="number" value={limit} onChange={(_, v) => setLimit(v.value)} /></Field>
          <Button onClick={() => run(() => setWorkItemLimit(admin, id, Number(limit)))}>{def.save}</Button>
        </div>
      </div>
      <div className="admin-card">
        <div className="admin-row"><h2 className="admin-subtitle">{def.users}</h2><Button appearance="subtle" onClick={() => setAdding(true)}>+ {def.addUser}</Button></div>
        {users.length ? <ul className="admin-pairs">{users.map((u) => <li key={u.systemuserid}>{u.fullname}</li>)}</ul> : <p className="admin-muted">{def.noUsers}</p>}
      </div>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      {adding && (
        <OverlayDrawer open position="end" onOpenChange={(_, d) => { if (!d.open) setAdding(false); }}>
          <DrawerHeader><DrawerHeaderTitle>{def.addUser}</DrawerHeaderTitle></DrawerHeader>
          <DrawerBody>
            {candidates.map((u) => <Checkbox key={u.systemuserid} label={u.fullname} checked={picked.has(u.systemuserid)} onChange={(_, d) => setPicked((s) => { const n = new Set(s); if (d.checked) n.add(u.systemuserid); else n.delete(u.systemuserid); return n; })} />)}
          </DrawerBody>
          <DrawerFooter><div className="admin-drawer-actions">
            <Button appearance="primary" disabled={!picked.size} onClick={() => { run(() => addProfileUsers(admin, id, [...picked])); setPicked(new Set()); setAdding(false); }}>{def.addUser}</Button>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </div></DrawerFooter>
        </OverlayDrawer>
      )}
    </section>
  );
}

// ---- Power Platform admin center: Business units, Teams ----

function PpacCrumbs() {
  return <div className="admin-crumbs">{pagesJson.ppac.path.slice(0, 4).map((c, i) => <span key={c}>{i > 0 && <span className="admin-crumb-sep">›</span>}<span>{c}</span></span>)}</div>;
}

function BusinessUnits() {
  const { store, admin, explain } = useUi();
  const def = P["business-units"];
  const units = store.table("businessunit").sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const root = units.find((u) => !u._parentbusinessunitid_value);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState<string | undefined>(root?.businessunitid);
  const [error, setError] = useState("");
  const save = () => { try { createBusinessUnit(admin, name, parent!); setOpen(false); setName(""); explain("business-unit"); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return (
    <section>
      <CommandBar><Button appearance="subtle" onClick={() => { setOpen(true); setError(""); }}>+ {def.newButton}</Button></CommandBar>
      <PpacCrumbs />
      <h1 className="admin-title">{def.title} <Info concept={def.concept} /></h1>
      <Table size="small" aria-label={def.title}>
        <TableHeader><TableRow>{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {units.map((u) => <TableRow key={u.businessunitid}><TableCell>{u.name}</TableCell><TableCell>{u._parentbusinessunitid_value ? store.find("businessunit", u._parentbusinessunitid_value)?.name : "–"}</TableCell></TableRow>)}
        </TableBody>
      </Table>
      {open && (
        <OverlayDrawer open position="end" onOpenChange={(_, d) => { if (!d.open) setOpen(false); }}>
          <DrawerHeader><DrawerHeaderTitle>{def.create.title}</DrawerHeaderTitle></DrawerHeader>
          <DrawerBody>
            <div className="admin-form">
              <Field label={def.create.name} required><Input value={name} onChange={(_, v) => setName(v.value)} /></Field>
              <Field label={def.create.parent} required>
                <Dropdown value={parent ? String(store.find("businessunit", parent)?.name ?? "") : ""} selectedOptions={parent ? [parent] : []} onOptionSelect={(_, d) => setParent(d.optionValue)}>
                  {units.map((u) => <Option key={u.businessunitid} value={u.businessunitid}>{u.name}</Option>)}
                </Dropdown>
              </Field>
              <p className="admin-muted">{pagesJson.ppac.source}</p>
              {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
            </div>
          </DrawerBody>
          <DrawerFooter><div className="admin-drawer-actions"><Button appearance="primary" disabled={!name.trim() || !parent} onClick={save}>{def.create.save}</Button><Button onClick={() => setOpen(false)}>Cancel</Button></div></DrawerFooter>
        </OverlayDrawer>
      )}
    </section>
  );
}

function Teams() {
  const { store, admin, explain } = useUi();
  const def = P.teams;
  const teams = store.table("team").sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const units = store.table("businessunit").sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const people = store.table("systemuser").filter((u) => u.accessmode === 0 && !u.isdisabled).sort((a, b) => String(a.fullname).localeCompare(String(b.fullname)));
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<string | undefined>();
  const [form, setForm] = useState({ name: "", description: "", unit: "", admin: LEARNER.userId });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const members = (teamId: string) => store.table("teammembership").filter((m) => m.teamid === teamId);
  const run = (work: () => void, then: () => void) => { try { setError(""); work(); then(); explain("team"); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const team = managing ? store.find("team", managing) : undefined;
  return (
    <section>
      <CommandBar><Button appearance="subtle" onClick={() => { setCreating(true); setError(""); }}>+ {def.newButton}</Button></CommandBar>
      <PpacCrumbs />
      <h1 className="admin-title">{def.title} <Info concept={def.concept} /></h1>
      <Table size="small" aria-label={def.title}>
        <TableHeader><TableRow>{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}<TableHeaderCell><span className="visually-hidden">Actions</span></TableHeaderCell></TableRow></TableHeader>
        <TableBody>
          {teams.map((t) => (
            <TableRow key={t.teamid}>
              <TableCell>{t.name}{t.isdefault ? <span className="admin-muted"> (default team)</span> : null}</TableCell>
              <TableCell>{(t._businessunitid_value && store.find("businessunit", t._businessunitid_value)?.name) || "–"}</TableCell>
              <TableCell>{t.teamtype === 0 ? def.create.owner : "–"}</TableCell>
              <TableCell>{t.isdefault ? "–" : members(t.teamid).length}</TableCell>
              <TableCell><Button size="small" appearance="subtle" onClick={() => { setManaging(t.teamid); setPicked(new Set()); setError(""); }}>{def.manage}</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {creating && (
        <OverlayDrawer open position="end" onOpenChange={(_, d) => { if (!d.open) setCreating(false); }}>
          <DrawerHeader><DrawerHeaderTitle>{def.create.title}</DrawerHeaderTitle></DrawerHeader>
          <DrawerBody>
            <div className="admin-form">
              <Field label={def.create.name} required><Input value={form.name} onChange={(_, v) => setForm({ ...form, name: v.value })} /></Field>
              <Field label={def.create.description}><Textarea value={form.description} onChange={(_, v) => setForm({ ...form, description: v.value })} /></Field>
              <Field label={def.create.unit} required>
                <Dropdown placeholder="Select a business unit" value={form.unit ? String(store.find("businessunit", form.unit)?.name ?? "") : ""} selectedOptions={form.unit ? [form.unit] : []} onOptionSelect={(_, d) => setForm({ ...form, unit: d.optionValue ?? "" })}>
                  {units.map((u) => <Option key={u.businessunitid} value={u.businessunitid}>{u.name}</Option>)}
                </Dropdown>
              </Field>
              <Field label={def.create.admin} required>
                <Dropdown value={String(store.find("systemuser", form.admin)?.fullname ?? "")} selectedOptions={[form.admin]} onOptionSelect={(_, d) => setForm({ ...form, admin: d.optionValue ?? LEARNER.userId })}>
                  {store.table("systemuser").filter((u) => u.accessmode === 0 && !u.isdisabled).map((u) => <Option key={u.systemuserid} value={u.systemuserid}>{u.fullname}</Option>)}
                </Dropdown>
              </Field>
              <Field label={def.create.type} hint="Access and Microsoft Entra group teams aren't part of the training."><Input value={def.create.owner} readOnly /></Field>
              {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
            </div>
          </DrawerBody>
          <DrawerFooter><div className="admin-drawer-actions">
            <Button appearance="primary" disabled={!form.name.trim() || !form.unit} onClick={() => run(() => createOwnerTeam(admin, { name: form.name, unitId: form.unit, adminId: form.admin, description: form.description }), () => { setCreating(false); setForm({ name: "", description: "", unit: "", admin: LEARNER.userId }); })}>{def.create.save}</Button>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
          </div></DrawerFooter>
        </OverlayDrawer>
      )}
      {team && (
        <OverlayDrawer open position="end" onOpenChange={(_, d) => { if (!d.open) setManaging(undefined); }}>
          <DrawerHeader><DrawerHeaderTitle>{def.manage}: {team.name}</DrawerHeaderTitle></DrawerHeader>
          <DrawerBody>
            {team.isdefault ? <p>{def.defaultTeam}</p> : (
              <>
                <p className="admin-muted">{members(team.teamid).length} members now. Tick people and select {def.addMembers}.</p>
                {people.map((u) => {
                  const already = members(team.teamid).some((m) => m.systemuserid === u.systemuserid);
                  return <Checkbox key={u.systemuserid} label={u.fullname} checked={already || picked.has(u.systemuserid)} disabled={already}
                    onChange={(_, d) => setPicked((s0) => { const n = new Set(s0); if (d.checked) n.add(u.systemuserid); else n.delete(u.systemuserid); return n; })} />;
                })}
              </>
            )}
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DrawerBody>
          <DrawerFooter><div className="admin-drawer-actions">
            {!team.isdefault && <Button appearance="primary" disabled={!picked.size} onClick={() => run(() => addTeamMembers(admin, team.teamid, [...picked]), () => setManaging(undefined))}>+ {def.addMembers}</Button>}
            <Button onClick={() => setManaging(undefined)}>Close</Button>
          </div></DrawerFooter>
        </OverlayDrawer>
      )}
    </section>
  );
}

// ---- User management › Skills hub (level 4) ----

function Skills() {
  const { store, admin } = useUi();
  const def = P.skills;
  const skills = store.table("characteristic").filter((c) => c.statecode !== 1).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const holders = (skillId: string) => store.table("bookableresourcecharacteristic").filter((l) => l._characteristic_value === skillId).length;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | undefined>();
  const create = () => { try { const id = createSkill(admin, name); setCreating(false); setName(""); setEditing(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return (
    <section>
      <CommandBar><Button appearance="subtle" onClick={() => { setCreating(true); setError(""); }}>+ {def.create}</Button></CommandBar>
      <Crumbs items={[{ label: P["user-management"].title, to: { page: "user-management" } }]} />
      <h1 className="admin-title">{def.title} <Info concept={def.concept} /></h1>
      <Table size="small" aria-label={def.title}>
        <TableHeader><TableRow>{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {skills.map((k) => (
            <TableRow key={k.characteristicid}>
              <TableCell><button className="admin-link" onClick={() => setEditing(k.characteristicid)}>{k.name}</button></TableCell>
              <TableCell>{def.createDialog.typeValue}</TableCell>
              <TableCell>{holders(k.characteristicid)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="admin-muted">{def.source}</p>
      {creating && (
        <Dialog open onOpenChange={(_, d) => { if (!d.open) setCreating(false); }}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{def.createDialog.title}</DialogTitle>
              <DialogContent className="admin-form">
                <Field label={def.createDialog.type} hint={def.createDialog.typeHint}><Input value={def.createDialog.typeValue} readOnly /></Field>
                <Field label={def.createDialog.name} required><Input value={name} onChange={(_, v) => setName(v.value)} /></Field>
                {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
              </DialogContent>
              <DialogActions>
                <Button appearance="primary" disabled={!name.trim()} onClick={create}>{def.createDialog.create}</Button>
                <Button onClick={() => setCreating(false)}>Cancel</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {editing && <EditSkillPanel skillId={editing} onClose={() => setEditing(undefined)} />}
    </section>
  );
}

function EditSkillPanel({ skillId, onClose }: { skillId: string; onClose(): void }) {
  const { store, admin, explain } = useUi();
  const def = P.skills.edit;
  const skill = store.find("characteristic", skillId);
  const ratings = store.table("ratingvalue").sort((a, b) => a.value - b.value);
  const ratingName = (userId: string) => ratings.find((r) => r.value === ratingOf(store, userId, skillId))?.name;
  const people = store.table("systemuser").filter((u) => u.accessmode === 0 && !u.isdisabled && store.table("bookableresource").some((r) => r._userid_value === u.systemuserid))
    .sort((a, b) => String(a.fullname).localeCompare(String(b.fullname)));
  const holders = people.filter((u) => ratingOf(store, u.systemuserid, skillId) > 0);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const run = (work: () => void) => { try { setError(""); work(); explain("skill"); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const toggle = (set: Set<string>, id: string, on: boolean) => { const n = new Set(set); if (on) n.add(id); else n.delete(id); return n; };
  if (!skill) return null;
  return (
    <OverlayDrawer open position="end" size="medium" onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DrawerHeader><DrawerHeaderTitle>{def.title}: {skill.name}</DrawerHeaderTitle></DrawerHeader>
      <DrawerBody>
        <div className="admin-row">
          <h3 className="admin-subtitle">{def.users}</h3>
          <span>
            <Button size="small" onClick={() => { setAdding(true); setPicked(new Set()); }}>+ {def.add}</Button>
            <Menu>
              <MenuTrigger disableButtonEnhancement><Button size="small" disabled={!ticked.size}>{def.update} ⌄</Button></MenuTrigger>
              <MenuPopover><MenuList>
                {ratings.map((r) => <MenuItem key={r.ratingvalueid} onClick={() => run(() => { setUserSkills(admin, skillId, [...ticked], r.ratingvalueid); setTicked(new Set()); })}>{r.name}</MenuItem>)}
              </MenuList></MenuPopover>
            </Menu>
            <Button size="small" disabled={!ticked.size} onClick={() => run(() => { ticked.forEach((u) => removeUserSkill(admin, skillId, u)); setTicked(new Set()); })}>{def.remove}</Button>
          </span>
        </div>
        {adding ? (
          <div className="admin-card">
            {people.filter((u) => !holders.includes(u)).map((u) => (
              <Checkbox key={u.systemuserid} label={u.fullname} checked={picked.has(u.systemuserid)} onChange={(_, d) => setPicked((s0) => toggle(s0, u.systemuserid, !!d.checked))} />
            ))}
            <div className="admin-drawer-actions">
              <Button appearance="primary" disabled={!picked.size} onClick={() => run(() => { setUserSkills(admin, skillId, [...picked], ratings[0].ratingvalueid); setAdding(false); })}>{def.addSelected}</Button>
              <Button onClick={() => setAdding(false)}>Cancel</Button>
            </div>
            <p className="admin-muted">{def.added}</p>
          </div>
        ) : (
          <Table size="small" aria-label={def.users}>
            <TableHeader><TableRow><TableHeaderCell className="admin-check"><span className="visually-hidden">Select</span></TableHeaderCell><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>{def.proficiency}</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {holders.map((u) => (
                <TableRow key={u.systemuserid}>
                  <TableCell className="admin-check"><Checkbox aria-label={`Select ${u.fullname}`} checked={ticked.has(u.systemuserid)} onChange={(_, d) => setTicked((s0) => toggle(s0, u.systemuserid, !!d.checked))} /></TableCell>
                  <TableCell>{u.fullname}</TableCell>
                  <TableCell>{ratingName(u.systemuserid) ?? "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!holders.length && !adding && <p className="admin-muted">Nobody has this skill yet. Select {def.add}.</p>}
        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      </DrawerBody>
      <DrawerFooter><div className="admin-drawer-actions"><Button onClick={onClose}>Close</Button></div></DrawerFooter>
    </OverlayDrawer>
  );
}

// ---- Workstream › Work classification: rulesets (Learn, Configure work classification rulesets) ----
//
// As in the admin center (docs/admin-center-check.md): a page listing the rulesets with Create new, the
// commands Move up, Move down, Edit, Delete, Copy ruleset and Paste ruleset below once a row is ticked, and
// each ruleset's own decision list. The training's skill attachment rules are listed below them.

function Classification({ id }: { id: string }) {
  const { store, admin, go } = useUi();
  const def = P.classification;
  const ws = store.find("msdyn_liveworkstream", id);
  const rulesets = classificationRulesets(store, id);
  const rules = skillRules(store, id);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pickedSet, setPickedSet] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const at = rulesets.findIndex((r) => r.msdyn_decisionrulesetid === pickedSet);
  const name = (table: string, rowId: string) => String(store.find(table, rowId)?.name ?? "(deleted)");
  const [c0, c1, c2, c3, c4, c5] = def.rulesetCommands;
  return (
    <section>
      <CommandBar>
        {at >= 0 ? (
          <>
            <Button appearance="subtle" disabled={at === 0} onClick={() => moveClassificationRuleset(admin, id, pickedSet!, -1)}>↑ {c0}</Button>
            <Button appearance="subtle" disabled={at === rulesets.length - 1} onClick={() => moveClassificationRuleset(admin, id, pickedSet!, 1)}>↓ {c1}</Button>
            <Button appearance="subtle" onClick={() => go({ page: "classification-ruleset", id, rulesetId: pickedSet! })}>{c2}</Button>
            <Button appearance="subtle" onClick={() => { deleteClassificationRuleset(admin, id, pickedSet!); setPickedSet(undefined); }}>{c3}</Button>
            <Off>{c4}</Off>
            <Off>{c5}</Off>
          </>
        ) : <Button appearance="subtle">{def.refresh}</Button>}
      </CommandBar>
      <Crumbs items={[{ label: "Workstreams", to: { page: "workstreams" } }, { label: ws?.msdyn_name ?? "", to: { page: "workstream", id } }]} />
      <div className="admin-row">
        <h1 className="admin-title">{def.title} <Info concept="work-classification" /></h1>
        <Button appearance="primary" onClick={() => setCreating(true)}>{def.createNew}</Button>
      </div>
      <div className="admin-card">
      <Table size="small" aria-label={def.title}>
        <TableHeader><TableRow><TableHeaderCell className="admin-check"><span className="visually-hidden">Select</span></TableHeaderCell>{def.rulesetColumns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {rulesets.map((r, i) => (
            <TableRow key={r.msdyn_decisionrulesetid} className={r.msdyn_decisionrulesetid === pickedSet ? "admin-selected" : undefined}>
              <TableCell className="admin-check"><Checkbox aria-label={`Select ${r.msdyn_name}`} checked={r.msdyn_decisionrulesetid === pickedSet} onChange={(_, d) => setPickedSet(d.checked ? r.msdyn_decisionrulesetid : undefined)} /></TableCell>
              <TableCell>{i + 1}</TableCell>
              <TableCell><button className="admin-link" onClick={() => go({ page: "classification-ruleset", id, rulesetId: r.msdyn_decisionrulesetid })}>{r.msdyn_name}</button></TableCell>
              <TableCell>{def.rulesetType}</TableCell>
              <TableCell>{r.msdyn_description ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!rulesets.length && <p className="admin-muted">{def.noRulesets}</p>}
      </div>

      <div className="admin-card">
        <div className="admin-row">
          <h2 className="admin-subtitle">{def.skillRules} <Info concept={def.concept} /></h2>
          <span>
            <Button appearance="subtle" onClick={() => setOpen(true)}>+ {def.createRule}</Button>
            <Button appearance="subtle" disabled={!selected} onClick={() => { deleteSkillRule(admin, selected!); setSelected(undefined); }}>{def.delete}</Button>
          </span>
        </div>
        <p className="admin-muted admin-tight">{def.skillRulesText}</p>
        <MessageBar intent="info"><MessageBarBody>{def.simplified}</MessageBarBody></MessageBar>
        <Table size="small" aria-label={def.skillRules}>
          <TableHeader><TableRow><TableHeaderCell className="admin-check"><span className="visually-hidden">Select</span></TableHeaderCell>{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
          <TableBody>
            {rules.map((r, i) => (
              <TableRow key={r.training_skillruleid} className={r.training_skillruleid === selected ? "admin-selected" : undefined}>
                <TableCell className="admin-check"><Radio aria-label={`Select ${r.name}`} checked={r.training_skillruleid === selected} onChange={() => setSelected(r.training_skillruleid)} /></TableCell>
                <TableCell>{i + 1}</TableCell><TableCell>{r.name}</TableCell><TableCell>{r.variable} equals {r.value}</TableCell>
                <TableCell>{name("characteristic", r.skillid)} ({name("ratingvalue", r.ratingvalueid)})</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rules.length && <p className="admin-muted">No rules yet. Select {def.createRule}.</p>}
        {matchingOf(ws) ? null : <p className="admin-muted">Skills only count when the workstream's Default skill matching algorithm is set (Work distribution).</p>}
      </div>
      {open && <SkillRulePanel workstreamId={id} onClose={() => setOpen(false)} />}
      {creating && <CreateRulesetDialog workstreamId={id} onClose={() => setCreating(false)} />}
    </section>
  );
}

function CreateRulesetDialog({ workstreamId, onClose }: { workstreamId: string; onClose(): void }) {
  const { admin, go, explain } = useUi();
  const d = P.classification.createDialog;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const create = () => {
    try {
      const rulesetId = createClassificationRuleset(admin, workstreamId, { name, description });
      onClose();
      go({ page: "classification-ruleset", id: workstreamId, rulesetId });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Dialog open onOpenChange={(_, o) => { if (!o.open) onClose(); }}>
      <DialogSurface className="admin-wide-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="Close" onClick={onClose}>✕</Button>}>{d.title}</DialogTitle>
          <DialogContent className="admin-two-columns">
            <div>
              <h3 className="admin-subtitle">{d.ruleType}</h3>
              <div className="admin-condition" role="radiogroup" aria-label={d.ruleType}>
                <Radio checked label={d.logical} value="logical" />
                <Tooltip content={NOT_YET} relationship="description"><Radio disabled label={d.ml} value="ml" /></Tooltip>
              </div>
              <p className="admin-muted"><strong>{d.logical}</strong><br />{d.logicalText}</p>
            </div>
            <div className="admin-form">
              <Field label={d.template}>
                <Dropdown value={d.templates[0]} selectedOptions={[d.templates[0]]}>
                  <Option value={d.templates[0]}>{d.templates[0]}</Option>
                  {d.templates.slice(1).map((t) => <Option key={t} value={t} disabled>{t}</Option>)}
                </Dropdown>
              </Field>
              <Field label={d.name} required><Input value={name} onChange={(_, v) => setName(v.value)} /></Field>
              <Field label={d.description}><Textarea value={description} onChange={(_, v) => setDescription(v.value)} /></Field>
              {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
            </div>
          </DialogContent>
          <DialogActions>
            <button className="admin-link" onClick={() => explain("work-classification")}>Learn more</button>
            <Button appearance="primary" disabled={!name.trim()} onClick={create}>{d.create}</Button>
            <Button onClick={onClose}>{d.cancel}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function ClassificationRuleset({ id, rulesetId }: { id: string; rulesetId: string }) {
  const { store, admin } = useUi();
  const def = P.classification.ruleset;
  const ws = store.find("msdyn_liveworkstream", id);
  const ruleset = store.find("msdyn_decisionruleset", rulesetId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClassificationRule | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  if (!ruleset) return <p>This ruleset no longer exists.</p>;
  const rules = rulesOf(ruleset);
  const index = rules.findIndex((r) => r.id === selected);
  const picked = index >= 0 ? rules[index] : undefined;
  const outputs = (rule: ClassificationRule) => rule.outputs.map((o) => `${fieldLabel(o.field)} = ${o.value}`).join(", ");
  return (
    <section>
      <Crumbs items={[{ label: "Workstreams", to: { page: "workstreams" } }, { label: ws?.msdyn_name ?? "", to: { page: "workstream", id } }, { label: P.classification.title, to: { page: "classification", id } }]} />
      <div className="admin-row">
        <h1 className="admin-title">{ruleset.msdyn_name} <Tooltip content={NOT_YET} relationship="description"><Button appearance="transparent" size="small" disabled>Edit</Button></Tooltip></h1>
        <Facts items={[[def.ruleType, P.classification.createDialog.logical], [def.owner, LEARNER.userName]]} />
      </div>
      <div className="admin-card">
        <div className="admin-row">
          <h2 className="admin-subtitle">{def.decisionList}</h2>
          <span>
            <Button appearance="subtle" onClick={() => setOpen(true)}>+ {def.createRule}</Button>
            {rules.length > 0 && (
              <>
                <Button appearance="subtle" disabled={!picked || index === 0} onClick={() => moveRule(admin, ruleset, picked!.id, -1)}>↑ {def.commands[0]}</Button>
                <Button appearance="subtle" disabled={!picked || index === rules.length - 1} onClick={() => moveRule(admin, ruleset, picked!.id, 1)}>↓ {def.commands[1]}</Button>
                <Button appearance="subtle" disabled={!picked} onClick={() => setEditing(readClassificationRule(picked!))}>{def.commands[2]}</Button>
                <Button appearance="subtle" disabled={!picked} onClick={() => { deleteRule(admin, ruleset, picked!.id); setSelected(undefined); }}>{def.commands[3]}</Button>
              </>
            )}
          </span>
        </div>
        {rules.length ? (
          <>
            <MessageBar intent="info"><MessageBarBody>{def.info}</MessageBarBody></MessageBar>
            <Table size="small" aria-label={def.decisionList}>
              <TableHeader><TableRow><TableHeaderCell className="admin-check" />{def.columns.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
              <TableBody>
                {rules.map((r, i) => {
                  const rule = readClassificationRule(r);
                  return (
                    <TableRow key={r.id} className={r.id === selected ? "admin-selected" : undefined}>
                      <TableCell className="admin-check"><Radio aria-label={`Select ${r.name}`} checked={r.id === selected} onChange={() => setSelected(r.id)} /></TableCell>
                      <TableCell>{i + 1}</TableCell><TableCell>{r.name}</TableCell><TableCell>{describeConditions(rule.conditions)}</TableCell><TableCell>{outputs(rule)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        ) : (
          <div className="admin-empty">
            <p><strong>{def.empty}</strong></p>
            <Button appearance="primary" onClick={() => setOpen(true)}>+ {def.createRule}</Button>
          </div>
        )}
      </div>
      {open && <ClassificationRulePanel workstreamId={id} rulesetId={rulesetId} onClose={() => setOpen(false)} />}
      {editing && <ClassificationRulePanel workstreamId={id} rulesetId={rulesetId} rule={editing} onClose={() => setEditing(undefined)} />}
    </section>
  );
}

function ClassificationRulePanel({ workstreamId, rulesetId, rule, onClose }: { workstreamId: string; rulesetId: string; rule?: ClassificationRule; onClose(): void }) {
  const { store, admin, explain } = useUi();
  const d = P.classification.rulePanel;
  const variables = ruleFields(store, workstreamId).filter((f) => f.lhs !== PRIORITY_SCORE);
  const CONTEXT = "liveworkitemcontext.";
  const [name, setName] = useState(rule?.name ?? "");
  const [conditions, setConditions] = useState(rule?.conditions ?? emptyConditions());
  const [outputs, setOutputs] = useState(rule?.outputs ?? [{ field: "", value: "" }]);
  const [error, setError] = useState("");
  const setOutput = (i: number, change: Partial<{ field: string; value: string }>) => setOutputs((all) => all.map((o, j) => (j === i ? { ...o, ...change } : o)));
  const duplicates = new Set(outputs.map((o) => o.field)).size !== outputs.length;
  const save = () => {
    try {
      saveClassificationRule(admin, workstreamId, rulesetId, { id: rule?.id, name, conditions, outputs });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <OverlayDrawer open position="end" size="large" onOpenChange={(_, o) => { if (!o.open) onClose(); }}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label="Close" onClick={onClose}>✕</Button>}>{rule ? rule.name : d.title}</DrawerHeaderTitle>
        <p className="admin-muted admin-tight">{d.intro} <button className="admin-link" onClick={() => explain("work-classification")}>Learn more</button></p>
      </DrawerHeader>
      <DrawerBody className="admin-form">
        <RuleBasics name={name} setName={setName} conditions={conditions} setConditions={setConditions} workstreamId={workstreamId} rootText={d.rootRecordText} />
        <div className="admin-section">
          <div className="admin-row">
            <h3 className="admin-subtitle">{d.output}</h3>
            <Button appearance="subtle" disabled={outputs.length >= MAX_OUTPUTS} onClick={() => setOutputs((all) => [...all, { field: "", value: "" }])}>+ {d.addAttribute}</Button>
          </div>
          {duplicates && <MessageBar intent="error"><MessageBarBody>{d.duplicates}</MessageBarBody></MessageBar>}
          {outputs.map((o, i) => {
            const context = o.field.startsWith(CONTEXT);
            const first = o.field === PRIORITY_SCORE ? d.priorityScore : context ? d.contextItem : "";
            return (
              <div key={i} className="admin-condition">
                <Button appearance="subtle" aria-label={`Delete output ${i + 1}`} onClick={() => setOutputs((all) => all.filter((_, j) => j !== i))}>🗑</Button>
                <Dropdown aria-label={d.attribute} placeholder={d.attribute} value={first} selectedOptions={first ? [o.field === PRIORITY_SCORE ? PRIORITY_SCORE : CONTEXT] : []}
                  onOptionSelect={(_, v) => setOutput(i, { field: v.optionValue ?? "", value: "" })}>
                  <OptionGroup label="Attributes"><Option value={PRIORITY_SCORE}>{d.priorityScore}</Option></OptionGroup>
                  <OptionGroup label="Related entities"><Option value={CONTEXT}>{d.contextItem}</Option></OptionGroup>
                </Dropdown>
                {context && (
                  <Dropdown aria-label={d.variable} placeholder={d.variable} value={o.field === CONTEXT ? "" : fieldLabel(o.field)} selectedOptions={o.field === CONTEXT ? [] : [o.field]}
                    onOptionSelect={(_, v) => setOutput(i, { field: v.optionValue ?? CONTEXT })}>
                    {variables.map((f) => <Option key={f.lhs} value={f.lhs}>{f.label}</Option>)}
                  </Dropdown>
                )}
                <span>{d.setTo}</span>
                <Input aria-label={`${first || "Output"} value`} disabled={!first || o.field === CONTEXT} type={o.field === PRIORITY_SCORE ? "number" : "text"} value={o.value} onChange={(_, v) => setOutput(i, { value: v.value })} />
              </div>
            );
          })}
          <p className="admin-muted admin-small">{d.simplified}</p>
        </div>
        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      </DrawerBody>
      <DrawerFooter className="admin-drawer-actions">
        <Button appearance="primary" onClick={save}>{rule ? "Save and close" : P["decision-list"].panel.submit}</Button>
        <Button onClick={onClose}>{P["decision-list"].panel.cancel}</Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}

function SkillRulePanel({ workstreamId, onClose }: { workstreamId: string; onClose(): void }) {
  const { store, admin, explain } = useUi();
  const d = P.classification.panel;
  const variables = store.table("msdyn_ocliveworkstreamcontextvariable").filter((v) => v._msdyn_liveworkstreamid_value === workstreamId).map((v) => String(v.msdyn_name));
  const skills = store.table("characteristic").filter((c) => c.statecode !== 1).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const ratings = store.table("ratingvalue").sort((a, b) => a.value - b.value);
  const [f, setF] = useState({ name: "", variable: "", value: "", skillId: "", ratingId: "" });
  const [error, setError] = useState("");
  const save = () => { try { addSkillRule(admin, workstreamId, f); explain("skill-attachment"); onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return (
    <OverlayDrawer open position="end" size="medium" onOpenChange={(_, o) => { if (!o.open) onClose(); }}>
      <DrawerHeader><DrawerHeaderTitle>{d.title}</DrawerHeaderTitle></DrawerHeader>
      <DrawerBody className="admin-form">
        <Field label={d.ruleName} required><Input value={f.name} onChange={(_, v) => setF({ ...f, name: v.value })} /></Field>
        <h3 className="admin-subtitle">{d.conditions}</h3>
        <div className="admin-condition">
          <Dropdown aria-label="Field" placeholder="Field" value={f.variable} selectedOptions={f.variable ? [f.variable] : []} onOptionSelect={(_, o) => setF({ ...f, variable: o.optionValue ?? "" })}>
            {variables.map((v) => <Option key={v} value={v}>{v}</Option>)}
          </Dropdown>
          <Input aria-label="Operator" value={d.operator} readOnly />
          <Input aria-label="Value" placeholder="Value" value={f.value} onChange={(_, v) => setF({ ...f, value: v.value })} />
        </div>
        <h3 className="admin-subtitle">{d.output}</h3>
        <Field label={d.skill} required>
          <Dropdown placeholder="Select a skill" value={skills.find((k) => k.characteristicid === f.skillId)?.name ?? ""} selectedOptions={f.skillId ? [f.skillId] : []} onOptionSelect={(_, o) => setF({ ...f, skillId: o.optionValue ?? "" })}>
            {skills.map((k) => <Option key={k.characteristicid} value={k.characteristicid}>{k.name}</Option>)}
          </Dropdown>
        </Field>
        <Field label={d.proficiency} required>
          <Dropdown placeholder="Select a proficiency" value={ratings.find((r) => r.ratingvalueid === f.ratingId)?.name ?? ""} selectedOptions={f.ratingId ? [f.ratingId] : []} onOptionSelect={(_, o) => setF({ ...f, ratingId: o.optionValue ?? "" })}>
            {ratings.map((r) => <Option key={r.ratingvalueid} value={r.ratingvalueid}>{r.name}</Option>)}
          </Dropdown>
        </Field>
        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      </DrawerBody>
      <DrawerFooter><div className="admin-drawer-actions"><Button appearance="primary" onClick={save}>{d.create}</Button><Button onClick={onClose}>Cancel</Button></div></DrawerFooter>
    </OverlayDrawer>
  );
}

// ---- Productivity › Outbound and inbound profiles (level 5) ----

function Productivity() {
  const { go } = useUi();
  const def = P.productivity;
  return (
    <section>
      <h1 className="admin-title">{def.title}</h1>
      {def.cards.map((c) => (
        <div key={c.title} className="admin-card admin-row">
          <div><h2 className="admin-subtitle">{c.title}</h2><p className="admin-muted admin-tight">{c.description}</p></div>
          <Button appearance="primary" onClick={() => go({ page: "outbound-profiles" })}>{c.action}</Button>
        </div>
      ))}
    </section>
  );
}

function OutboundProfiles() {
  const { store, admin, explain, queueName } = useUi();
  const def = P["outbound-profiles"];
  const c = def.create;
  const profiles = outboundProfiles(store).sort((a, b) => String(a.msdyn_name).localeCompare(String(b.msdyn_name)));
  const numberOf = (wsId: string) => {
    const ch = store.table("msdyn_ocvoicechannelsetting").find((x) => x._msdyn_liveworkstreamid_value === wsId);
    return ch?._msdyn_phonenumberid_value ? store.find("msdyn_ocphonenumber", ch._msdyn_phonenumberid_value)?.msdyn_phonenumber : undefined;
  };
  const shared = store.table("msdyn_ocphonenumber").filter((n) => n.msdyn_phoneoutboundenabled).sort((a, b) => String(a.msdyn_phonenumber).localeCompare(String(b.msdyn_phonenumber)));
  const queues = store.table("queue").filter((q) => q.msdyn_isomnichannelqueue === true && q.statecode === 0 && q.msdyn_queuetype === VOICE_QUEUE).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const capacity = store.table("msdyn_capacityprofile").sort((a, b) => String(a.msdyn_name).localeCompare(String(b.msdyn_name)));
  const defaultCapacity = capacity.find((p) => p.msdyn_uniquename === DEFAULT_CAPACITY_PROFILE.Outbound)?.msdyn_capacityprofileid ?? "";
  const empty = { name: "", phoneId: "", queueId: "", capacityProfileId: defaultCapacity, callerIdPhoneId: "" };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(empty);
  const [error, setError] = useState("");
  const save = () => {
    try {
      createOutboundProfile(admin, { ...f, capacityProfileId: f.capacityProfileId || undefined, callerIdPhoneId: f.callerIdPhoneId || undefined });
      setOpen(false); setF(empty); explain("outbound-profile");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const phoneLabel = (id: string) => store.find("msdyn_ocphonenumber", id)?.msdyn_phonenumber ?? "";
  return (
    <section>
      <CommandBar><Button appearance="subtle" onClick={() => { setOpen(true); setError(""); }}>+ {def.newButton}</Button></CommandBar>
      <Crumbs items={[{ label: P.productivity.title, to: { page: "productivity" } }]} />
      <h1 className="admin-title">{def.title} <Info concept={def.concept} /></h1>
      <Table size="small" aria-label={def.title}>
        <TableHeader><TableRow>{def.columns.map((x) => <TableHeaderCell key={x}>{x}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {profiles.map((pr) => (
            <TableRow key={pr.msdyn_liveworkstreamid}>
              <TableCell>{pr.msdyn_name}</TableCell><TableCell>{c.outbound}</TableCell>
              <TableCell>{numberOf(pr.msdyn_liveworkstreamid) ?? "–"}</TableCell><TableCell>{queueName(pr._msdyn_outboundqueueid_value) ?? "–"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!profiles.length && <p className="admin-muted">No profiles yet. Select {def.newButton}.</p>}
      {open && (
        <OverlayDrawer open position="end" size="medium" onOpenChange={(_, o) => { if (!o.open) setOpen(false); }}>
          <DrawerHeader><DrawerHeaderTitle>{c.title}</DrawerHeaderTitle></DrawerHeader>
          <DrawerBody className="admin-form">
            <h3 className="admin-subtitle">{c.settings}</h3>
            <Field label={c.name} required><Input value={f.name} onChange={(_, v) => setF({ ...f, name: v.value })} /></Field>
            <Field label={c.type} hint="Inbound profiles aren't part of the training.">
              <Dropdown value={c.outbound} selectedOptions={["outbound"]}><Option value="outbound">{c.outbound}</Option><Option value="inbound" disabled>{c.inbound}</Option></Dropdown>
            </Field>
            <h3 className="admin-subtitle">{c.phone}</h3>
            {shared.length ? (
              <Field label={c.sharedNumbers} required>
                <Dropdown placeholder="Select a number" value={f.phoneId ? phoneLabel(f.phoneId) : ""} selectedOptions={f.phoneId ? [f.phoneId] : []} onOptionSelect={(_, o) => setF({ ...f, phoneId: o.optionValue ?? "" })}>
                  {shared.map((n) => <Option key={n.msdyn_ocphonenumberid} value={n.msdyn_ocphonenumberid}>{n.msdyn_phonenumber}</Option>)}
                </Dropdown>
              </Field>
            ) : <MessageBar intent="warning"><MessageBarBody>{c.noNumbers}</MessageBarBody></MessageBar>}
            <h3 className="admin-subtitle">{c.info}</h3>
            <Field label={c.queue} required>
              <Dropdown placeholder="Select a queue" value={queueName(f.queueId) ?? ""} selectedOptions={f.queueId ? [f.queueId] : []} onOptionSelect={(_, o) => setF({ ...f, queueId: o.optionValue ?? "" })}>
                {queues.map((q) => <Option key={q.queueid} value={q.queueid}>{q.name}</Option>)}
              </Dropdown>
            </Field>
            <Field label={c.capacity}>
              <Dropdown value={capacity.find((p) => p.msdyn_capacityprofileid === f.capacityProfileId)?.msdyn_name ?? ""} selectedOptions={f.capacityProfileId ? [f.capacityProfileId] : []} onOptionSelect={(_, o) => setF({ ...f, capacityProfileId: o.optionValue ?? "" })}>
                {capacity.map((p) => <Option key={p.msdyn_capacityprofileid} value={p.msdyn_capacityprofileid}>{p.msdyn_name}</Option>)}
              </Dropdown>
            </Field>
            <Field label={c.callerId}>
              <Dropdown value={f.callerIdPhoneId ? phoneLabel(f.callerIdPhoneId) : f.phoneId ? `${phoneLabel(f.phoneId)} ${c.profileNumber}` : ""} selectedOptions={[f.callerIdPhoneId || "profile"]} onOptionSelect={(_, o) => setF({ ...f, callerIdPhoneId: o.optionValue === "profile" ? "" : o.optionValue ?? "" })}>
                <Option value="profile" text={c.profileNumber}>{f.phoneId ? `${phoneLabel(f.phoneId)} ${c.profileNumber}` : c.profileNumber}</Option>
                {shared.filter((n) => n.msdyn_ocphonenumberid !== f.phoneId).map((n) => <Option key={n.msdyn_ocphonenumberid} value={n.msdyn_ocphonenumberid}>{n.msdyn_phonenumber}</Option>)}
              </Dropdown>
            </Field>
            <p className="admin-muted">{def.simplified}</p>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DrawerBody>
          <DrawerFooter><div className="admin-drawer-actions"><Button appearance="primary" disabled={!f.name.trim() || !f.phoneId || !f.queueId} onClick={save}>{c.save}</Button><Button onClick={() => setOpen(false)}>Cancel</Button></div></DrawerFooter>
        </OverlayDrawer>
      )}
    </section>
  );
}
