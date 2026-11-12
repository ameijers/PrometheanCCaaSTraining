// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Input, MessageBar, MessageBarBody, Option, OptionGroup, Radio, RadioGroup, Tab, TabList } from "@fluentui/react-components";
import { QUEUE_TYPES } from "@toolbox/queue-builder/src/queueSchema";
import { Row, Store } from "../simulator/store";
import { STATUS } from "./assignment";
import { sentiment, transcript } from "./conversation";
import { callInfo, customerName } from "./customers";
import type { Routing } from "./routing";
import { agentRows, availability, canAssign, canMonitor, canTransfer, forceClose, joinCall, kpis, supervisorAssign, Target, transfer } from "./supervisor";

// The supervisor's screens in the workspace (Learn: Monitor, assign, transfer, and end conversations as a
// supervisor; Overview of the real-time Omnichannel analytics dashboard; Monitor calls in the voice
// channel). The learner acts as the supervisor here; in the product that needs the Omnichannel Supervisor
// role and the admin's Supervisor Monitor, Assign, Transfer and Force Close settings.

export const STATUS_NAME: Record<number, string> = { [STATUS.open]: "Open", [STATUS.active]: "Active", [STATUS.wrapUp]: "Wrap-up", [STATUS.closed]: "Closed" };

export const duration = (ms: number | undefined) => {
  if (ms === undefined || !Number.isFinite(ms)) return "---";
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

function voiceQueues(store: Store): Row[] {
  return store.table("queue").filter((q) => q.msdyn_queuetype === QUEUE_TYPES.Voice || store.table("msdyn_ocliveworkitem").some((w) => w._msdyn_cdsqueueid_value === q.queueid))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

interface Shared { store: Store; routing: Routing; now: number; me?: string }

// The conversations table with its toolbar. Monitor always; Assign, Transfer and Force close on the
// Ongoing conversation report (Learn puts them there).
function Conversations({ store, routing, now, me, rows, actions }: Shared & { rows: Row[]; actions: boolean }) {
  const [selected, setSelected] = useState<string>();
  const [monitoring, setMonitoring] = useState<string>();
  const [dialog, setDialog] = useState<"assign" | "transfer">();
  const w = rows.find((r) => r.activityid === selected);
  const agent = (x: Row) => x._msdyn_activeagentid_value ? String(store.find("systemuser", x._msdyn_activeagentid_value)?.fullname ?? "") : "---";
  const monitorWhy = w ? canMonitor(w, me) : "Select a conversation.";
  const assignWhy = w ? canAssign(w) : "Select a conversation.";
  const transferWhy = w ? canTransfer(w) : "Select a conversation.";
  const watched = monitoring ? store.find("msdyn_ocliveworkitem", monitoring) : undefined;
  return (
    <div className="ws-card ws-conversations">
      <div className="ws-conversations-head">
        <p className="ws-card-title">Conversations</p>
        <span className="ws-toolbar">
          <Button size="small" appearance="subtle" disabled={!!monitorWhy} title={monitorWhy} onClick={() => setMonitoring(selected)}>Monitor</Button>
          {actions && <>
            <Button size="small" appearance="subtle" disabled={!!assignWhy} title={assignWhy} onClick={() => setDialog("assign")}>Assign</Button>
            <Button size="small" appearance="subtle" disabled={!!transferWhy} title={transferWhy} onClick={() => setDialog("transfer")}>Transfer</Button>
            <Button size="small" appearance="subtle" disabled={!w} onClick={() => { if (w) { forceClose(store, routing, w.activityid, now); setSelected(undefined); } }}>Force close</Button>
          </>}
          {!actions && <Button size="small" appearance="subtle" disabled title="Not simulated in the training">Copy URL</Button>}
        </span>
      </div>
      {w && (monitorWhy || (actions && assignWhy && transferWhy)) && <p className="admin-muted admin-tight ws-why">{[monitorWhy, actions ? (w.statuscode === STATUS.open ? undefined : assignWhy) : undefined].filter(Boolean).join(" ")}</p>}
      <div className="ws-table-wrap">
        <table className="ws-table">
          <thead><tr><th aria-label="Select" /><th>Customer</th><th>Subject</th><th>Queue</th><th>Channel</th><th>Status Reason</th><th>Customer Sentiment</th><th>Representative</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.activityid} className={x.activityid === selected ? "selected" : ""} onClick={() => setSelected(x.activityid)}>
                <td><input type="radio" name="ws-conversation" aria-label={`Select ${customerName(store, x)}`} checked={x.activityid === selected} onChange={() => setSelected(x.activityid)} /></td>
                <td>{customerName(store, x)}</td><td>{String(x.msdyn_title ?? "")}</td><td>{String(store.find("queue", x._msdyn_cdsqueueid_value)?.name ?? "")}</td>
                <td>Voice call</td><td>{routing.offers.has(x.activityid) ? "Open (offered)" : STATUS_NAME[Number(x.statuscode)]}</td><td>{sentiment(store, x, now) ?? "---"}</td><td>{agent(x)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="admin-muted">We didn't find anything to show here.</p>}
      </div>
      <p className="admin-muted admin-tight ws-why">Training: Representative is an extra column. Sentiment is simulated.</p>
      {watched && <Monitor store={store} w={watched} now={now} close={() => setMonitoring(undefined)} />}
      {dialog && w && (
        <TargetDialog store={store} title={dialog === "assign" ? "Assign" : "Transfer"} w={w}
          intro={dialog === "assign" ? "Assign the conversation to a representative or a queue. Assigning overrides the representative's presence and capacity." : "Transfer the conversation to a representative or a queue. A representative accepts or rejects it."}
          close={() => setDialog(undefined)}
          done={(t) => { if (dialog === "assign") supervisorAssign(store, routing, w.activityid, t, now); else transfer(store, routing, w.activityid, t, now); setDialog(undefined); }} />
      )}
    </div>
  );
}

// Monitor: the call's details and live transcript, without being seen; Join call (barge) tells the
// representative a supervisor joined.
function Monitor({ store, w, now, close }: { store: Store; w: Row; now: number; close(): void }) {
  const joined = !!callInfo(store, w.activityid)?.supervisorjoined;
  const live = w.statuscode === STATUS.active;
  return (
    <section className="ws-monitor" aria-label="Monitor">
      <div className="ws-conversations-head">
        <p className="ws-card-title">Monitor · {customerName(store, w)} with {String(store.find("systemuser", w._msdyn_activeagentid_value)?.fullname ?? "")}</p>
        <span className="ws-toolbar">
          <Button size="small" appearance="primary" disabled={joined || !live} onClick={() => joinCall(store, w.activityid)}>{joined ? "Joined" : "Join call"}</Button>
          <Button size="small" onClick={close}>Close</Button>
        </span>
      </div>
      <p className="admin-muted admin-tight">{live ? "You're listening without being seen by the representative or the customer." : "The call has ended."} Sentiment: {sentiment(store, w, now) ?? "---"}.</p>
      <Transcript lines={transcript(store, w, now)} />
    </section>
  );
}

export function Transcript({ lines }: { lines: ReturnType<typeof transcript> }) {
  if (!lines.length) return <p className="admin-muted">Nothing said yet.</p>;
  return (
    <ol className="ws-transcript" aria-live="polite">
      {lines.map((l, i) => (
        <li key={i} className={`ws-line ws-line-${l.who.toLowerCase()}`}>
          <span className="ws-line-who">{l.who} · {new Date(l.at).toISOString().slice(11, 19)}</span>
          <span>{l.text}</span>
        </li>
      ))}
    </ol>
  );
}

// Pick a representative or a queue: for Assign, Transfer, and the representative's own Transfer.
export function TargetDialog({ store, title, intro, w, close, done, me }: { store: Store; title: string; intro: string; w: Row; close(): void; done(t: Target): void; me?: string }) {
  const [kind, setKind] = useState<"agent" | "queue">("agent");
  const [id, setId] = useState<string>();
  const inQueue = new Set(store.table("queuemembership").filter((m) => m.queueid === w._msdyn_cdsqueueid_value).map((m) => m.systemuserid));
  const people = agentRows(store).filter((a) => a.id !== w._msdyn_activeagentid_value && a.id !== me);
  const group = (inside: boolean) => people.filter((a) => inQueue.has(a.id) === inside);
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) close(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <p className="admin-tight">{intro}</p>
            <RadioGroup layout="horizontal" value={kind} onChange={(_, d) => { setKind(d.value as "agent" | "queue"); setId(undefined); }}>
              <Radio value="agent" label="Representative" />
              <Radio value="queue" label="Queue" />
            </RadioGroup>
            <Dropdown aria-label={kind === "agent" ? "Representative" : "Queue"} placeholder={kind === "agent" ? "Select a representative" : "Select a queue"}
              selectedOptions={id ? [id] : []} value={id ? (kind === "agent" ? people.find((p) => p.id === id)?.name : String(store.find("queue", id)?.name ?? "")) ?? "" : ""}
              onOptionSelect={(_, d) => setId(d.optionValue)}>
              {kind === "agent"
                ? [true, false].map((inside) => group(inside).length ? (
                  <OptionGroup key={String(inside)} label={inside ? "In this queue" : "Other representatives"}>
                    {group(inside).map((a) => <Option key={a.id} value={a.id} text={a.name}>{`${a.name} · ${a.presence} · ${a.conversations} open`}</Option>)}
                  </OptionGroup>) : null)
                : voiceQueues(store).filter((q) => q.queueid !== w._msdyn_cdsqueueid_value || title === "Assign").map((q) => <Option key={q.queueid} value={q.queueid}>{String(q.name)}</Option>)}
            </Dropdown>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!id} onClick={() => id && done({ kind, id })}>{title}</Button>
            <Button onClick={close}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function QueueFilter({ store, picked, setPicked }: { store: Store; picked: Set<string>; setPicked(s: Set<string>): void }) {
  const [search, setSearch] = useState("");
  const shown = voiceQueues(store).filter((q) => String(q.name).toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="ws-card ws-filter">
      <p className="ws-card-title">Filter by queues</p>
      <Input size="small" placeholder="Search" value={search} onChange={(_, d) => setSearch(d.value)} aria-label="Search queues" />
      <p className="admin-muted admin-tight">{shown.length} records</p>
      <div className="ws-filter-list">
        {shown.map((q) => <Checkbox key={q.queueid} label={String(q.name)} checked={picked.has(q.queueid)} onChange={() => setPicked(toggle(picked, q.queueid))} />)}
      </div>
    </div>
  );
}

const ongoing = (store: Store, queues?: Set<string>) =>
  store.table("msdyn_ocliveworkitem").filter((w) => w.statecode === 0 && (!queues?.size || queues.has(w._msdyn_cdsqueueid_value)));

// The Omnichannel Ongoing Conversations Dashboard: Filter by queues and Conversations, with Monitor.
export function OngoingDashboard(props: Shared) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  return (
    <div>
      <div className="ws-dashboard">
        <QueueFilter store={props.store} picked={picked} setPicked={setPicked} />
        <Conversations {...props} rows={ongoing(props.store, picked)} actions={false} />
      </div>
    </div>
  );
}

type Report = "Summary" | "Agents" | "Ongoing conversation";

// Omnichannel real-time analytics: the Summary, Agents and Ongoing conversation reports, a Queue filter,
// and Pause updates.
export function RealtimeAnalytics(props: Shared) {
  const { store, routing } = props;
  const [report, setReport] = useState<Report>("Summary");
  const [queue, setQueue] = useState<string>();
  const [pausedAt, setPausedAt] = useState<number>();
  const [agentTab, setAgentTab] = useState<string>("Idle agents");
  const now = pausedAt ?? props.now;
  const k = kpis(store, routing.offers, now, queue);
  const agents = agentRows(store, queue);
  const pct = (n?: number) => (n === undefined ? "---" : `${n}%`);
  const tiles: [string, string, string][] = [
    ["Total conversations offered", String(k.offered), "Calls that reached a queue."],
    ["Open conversations", String(k.open), "Waiting in a queue, not assigned yet."],
    ["Active conversations awaiting service representative acceptance", String(k.awaiting), "Offered, not accepted yet."],
    ["Active conversations with service representative acceptance", String(k.active), "On the call with a representative."],
    ["Wrap-up conversations", String(k.wrapUp), "Call ended, not closed yet."],
    ["Longest wait time", duration(k.longestWaitMs), "Longest first wait of a call nobody has accepted."],
    ["Average speed to answer", duration(k.averageSpeedToAnswerMs), "From reaching the queue to being accepted."],
    ["Service level (20 seconds)", pct(k.serviceLevel20), "Accepted within 20 seconds."],
    ["Average conversation handle time", duration(k.averageHandleTimeMs), "From accept to close (simplified)."]
  ];
  return (
    <div>
      <div className="ws-report-bar">
        <Dropdown aria-label="Report" value={report} selectedOptions={[report]} onOptionSelect={(_, d) => setReport(d.optionValue as Report)}>
          {(["Summary", "Agents", "Ongoing conversation"] as Report[]).map((r) => <Option key={r} value={r}>{r}</Option>)}
        </Dropdown>
        <Dropdown aria-label="Queue" value={queue ? String(store.find("queue", queue)?.name ?? "") : "All queues"} selectedOptions={[queue ?? ""]} onOptionSelect={(_, d) => setQueue(d.optionValue || undefined)}>
          <Option value="">All queues</Option>
          {voiceQueues(store).map((q) => <Option key={q.queueid} value={q.queueid}>{String(q.name)}</Option>)}
        </Dropdown>
        {report !== "Ongoing conversation" && <Button size="small" onClick={() => setPausedAt(pausedAt === undefined ? props.now : undefined)}>{pausedAt === undefined ? "Pause updates" : "Resume updates"}</Button>}
        <span className="admin-muted">Time: this session. Abandoned calls aren't simulated.</span>
      </div>

      {report === "Summary" && (
        <>
          <div className="ws-kpis">
            {tiles.map(([name, value, hint]) => <div key={name} className="ws-kpi" title={hint}><span className="ws-kpi-value">{value}</span><span className="ws-kpi-name">{name}</span></div>)}
          </div>
          <div className="ws-card">
            <p className="ws-card-title">Agent availability status</p>
            <div className="ws-bars">
              {availability(agents).map(([name, n]) => (
                <div key={name} className="ws-bar-row"><span className="ws-bar-label">{name}</span><span className="ws-bar" style={{ width: `${agents.length ? (n / agents.length) * 100 : 0}%` }} /><span>{n}</span></div>
              ))}
            </div>
          </div>
        </>
      )}

      {report === "Agents" && (
        <div className="ws-card">
          <TabList size="small" selectedValue={agentTab} onTabSelect={(_, d) => setAgentTab(String(d.value))}>
            {["Idle agents", "Interacting agents", "Offline agents"].map((t) => <Tab key={t} value={t}>{t} ({agents.filter((a) => a.tab === t).length})</Tab>)}
          </TabList>
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead><tr><th>Agent list</th><th>Presence</th><th>Conversations</th><th>Queues</th></tr></thead>
              <tbody>{agents.filter((a) => a.tab === agentTab).map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.presence}</td><td>{a.conversations}</td><td>{a.queues.join(", ")}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {report === "Ongoing conversation" && (
        <>
          <MessageBar intent="info"><MessageBarBody>Select a conversation, then Monitor, Assign, Transfer or Force close. Training: you act as the supervisor.</MessageBarBody></MessageBar>
          <Conversations {...props} rows={ongoing(store, queue ? new Set([queue]) : undefined)} actions />
        </>
      )}
    </div>
  );
}
