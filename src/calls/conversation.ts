// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Row, Store } from "../simulator/store";
import { STATUS } from "./assignment";
import { callInfo, customerOfCall, customerName } from "./customers";

// What happens on the call itself, simulated: the live transcript, the customer's sentiment, and the
// Copilot conversation summary.
//
// Learn (Use agent dashboard and call controls in the voice channel): "the conversation between you and the
// customer is automatically transcribed in real time", and the transcript "is used for live sentiment
// analysis". Learn (Use Copilot to summarize conversations): "The Copilot conversation summary is generated
// automatically when you request a consultation with another customer service representative, transfer
// the conversation, or end the conversation", and on **Summarize conversation**; "The summary is displayed in
// a paragraph format or structured format." Sentiment values: "positive, neutral, or negative" (View
// conversation transcripts and call recordings).
//
// Simplified, and made up by the training: nobody speaks, so the transcript is a short script built from
// the caller's IVR answer and name, one line every few seconds of the clock; sentiment is Negative when the
// caller waited more than two minutes, else Neutral, and Positive once the customer thanks the
// representative; the summary is written from the call's data, not by AI.

export interface TranscriptLine { at: number; who: "Customer" | "Representative" | "System"; text: string }
export type Sentiment = "Positive" | "Neutral" | "Negative";

const LONG_WAIT_MS = 120_000;

export function acceptedAt(store: Store, workItemId: string): number | undefined {
  const first = store.table("training_assignment").filter((a) => a.workitemid === workItemId).map((a) => Date.parse(a.assignedon)).sort((a, b) => a - b)[0];
  return Number.isFinite(first) ? first : undefined;
}

// When the current representative got the call (the latest assignment).
export function assignedAt(store: Store, workItemId: string): number | undefined {
  const last = store.table("training_assignment").filter((a) => a.workitemid === workItemId).map((a) => Date.parse(a.assignedon)).sort((a, b) => b - a)[0];
  return Number.isFinite(last) ? last : undefined;
}

export function reasonOf(store: Store, workItemId: string): string | undefined {
  const answer = store.table("msdyn_ocliveworkitemcontextitem").find((c) => c._msdyn_ocliveworkitemid_value === workItemId && c.msdyn_value);
  return answer ? String(answer.msdyn_value) : undefined;
}

// When the call stopped (wrap-up or closed), else undefined.
const endedAt = (w: Row) => (w.statuscode === STATUS.wrapUp || w.statuscode === STATUS.closed ? Date.parse(w.modifiedon) : undefined);

const SCRIPT = (rep: string, first: string | undefined, reason: string | undefined): { after: number; who: TranscriptLine["who"]; text: string }[] => [
  { after: 0, who: "Representative", text: `Thank you for calling. My name is ${rep}. How can I help you today?` },
  { after: 6, who: "Customer", text: `${first ? `Hi, this is ${first}.` : "Hi."} ${reason ? `I'm calling about ${reason.toLowerCase()}.` : "I have a question."}` },
  { after: 14, who: "Representative", text: `Thanks${first ? `, ${first}` : ""}. Let me look into ${reason ? `your ${reason.toLowerCase()} question` : "that"} for you.` },
  { after: 30, who: "Customer", text: "Thank you. I'll hold on." },
  { after: 45, who: "Representative", text: "I've found what you need. Is there anything else I can help you with?" },
  { after: 60, who: "Customer", text: "No, that's all. Thanks for your help." }
];

export function transcript(store: Store, w: Row, now: number): TranscriptLine[] {
  const start = assignedAt(store, w.activityid);
  if (start === undefined) return [];
  const until = Math.min(now, endedAt(w) ?? now);
  const repName = String(store.find("systemuser", w._msdyn_activeagentid_value)?.fullname ?? "your representative").split(" ")[0];
  const customer = customerOfCall(store, w);
  const first = customer?.kind === "contact" ? String(customer.row.firstname ?? "") || undefined : undefined;
  const lines: TranscriptLine[] = SCRIPT(repName, first, reasonOf(store, w.activityid))
    .map((l) => ({ at: start + l.after * 1000, who: l.who, text: l.text }))
    .filter((l) => l.at <= until);
  if (callInfo(store, w.activityid)?.supervisorjoined) lines.push({ at: until, who: "System", text: "A supervisor joined the call." });
  const end = endedAt(w);
  if (end !== undefined && end <= now) lines.push({ at: end, who: "System", text: "The call ended." });
  return lines;
}

export function sentiment(store: Store, w: Row, now: number): Sentiment | undefined {
  const start = acceptedAt(store, w.activityid);
  if (start === undefined) return undefined;
  if (start - Date.parse(w.createdon) > LONG_WAIT_MS) return "Negative";
  return transcript(store, w, now).some((l) => l.text.startsWith("No, that's all")) ? "Positive" : "Neutral";
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s === 1 ? "1 second" : s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

// The structured summary: the parts Copilot's structured format shows, written from the call's data.
export function summarize(store: Store, w: Row, now: number): string {
  const start = acceptedAt(store, w.activityid);
  const reason = reasonOf(store, w.activityid);
  const queue = store.find("queue", w._msdyn_cdsqueueid_value)?.name;
  const rep = store.find("systemuser", w._msdyn_activeagentid_value)?.fullname;
  const end = endedAt(w) ?? now;
  const said = transcript(store, w, now);
  const parts = [
    `Customer: ${customerName(store, w)}`,
    `Issue: ${reason ? `the caller chose ${reason} in the IVR` : "not given in the IVR"}`,
    `Handled by: ${rep ?? "nobody yet"}${queue ? ` (queue ${queue})` : ""}`,
    start ? `Waited ${mmss(start - Date.parse(w.createdon))}, talked ${mmss(end - (assignedAt(store, w.activityid) ?? start))}` : "Not answered yet",
    said.some((l) => l.text.startsWith("I've found")) ? "Resolution: the representative found what the customer needed" : "Resolution: still in progress",
    `Status: ${w.statuscode === STATUS.closed ? "closed" : w.statuscode === STATUS.wrapUp ? "call ended, in wrap-up" : w.statuscode === STATUS.active ? "on the call" : "waiting in a queue"}`
  ];
  return parts.join("\n");
}

// Makes and keeps the summary (on Summarize conversation, transfer and end).
export function saveSummary(store: Store, w: Row, now: number): string {
  const text = summarize(store, w, now);
  const info = callInfo(store, w.activityid);
  const at = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
  if (info) store.update("training_call", info.training_callid, { summary: text, summarizedon: at });
  else store.insert("training_call", { workitemid: w.activityid, summary: text, summarizedon: at });
  return text;
}

export function summaryOf(store: Store, workItemId: string): string | undefined {
  const s = callInfo(store, workItemId)?.summary;
  return s ? String(s) : undefined;
}
