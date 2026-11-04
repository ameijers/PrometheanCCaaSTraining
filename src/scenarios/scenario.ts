// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Outcome } from "@toolbox/visual-routing-tester/src/model";
import { CallTime } from "../calls/engine";
import { Goal, GOAL_LEVEL, GOAL_TYPES } from "./goals";

// A scenario (manual 8.2 and 9.1): a story about Contoso's contact center and an exercise in it. The AI
// may write one, or it ships ready-made (content/scenarios). Either way it's data, and code decides
// whether it's sound (src/scenarios/validate.ts, manual 8.3) and whether the learner got it right
// (src/scenarios/grade.ts). The AI never grades.

export type ScenarioKind = "fix" | "route" | "build" | "interview";

export interface Scenario {
  id: string;
  kind: ScenarioKind;
  level: number;
  title: string;
  // What happened, in a few short paragraphs. Names in it are the environment's.
  story: string[];
  // "Fix the broken contact center": what's broken when the scenario starts.
  faults?: Fault[];
  // "Where does this call go?": the calls to predict.
  questions?: Question[];
  // "Build to requirements" and "Customer interview": what the company wants (src/scenarios/goals.ts).
  goals?: Goal[];
  // "Customer interview": the customer the learner talks to, and what they say when asked.
  interview?: Interview;
  source: "ready-made" | "ai";
  createdOn?: string;
}

// The faults a scenario can plant. Each is something the Toolbox's health checks find
// (environment-3d-explorer/src/health.ts) and the admin center's pages can fix.
export type Fault =
  // Every member taken out of a queue that calls are routed to. Check "no-members".
  | { type: "no-members"; queue: string }
  // The workstream's fallback queue points to a queue that was switched off. Check "missing-default-queue".
  | { type: "fallback-queue-off"; workstream: string }
  // A route-to-queue rule points to a queue that was switched off. Check "missing-queue".
  | { type: "rule-queue-off"; workstream: string; rule: string };

export const FAULT_TYPES = ["no-members", "fallback-queue-off", "rule-queue-off"] as const;

// A customer interview (manual 9.1): who the customer is, how they open, and their answers. A topic
// reveals a goal when the learner asks about it; extras are questions that reveal nothing.
export interface Interview {
  persona: string;
  opening: string;
  topics: { ask: string; answer: string; goal: number }[];
  extras: { ask: string; answer: string }[];
}

export interface Question {
  id: string;
  // What the caller says when the call starts, written for the story. No phone numbers in it.
  caller: string;
  dial: string;
  // The value the IVR sends for the caller's menu choice (the SelectedMenuItem context variable), if any.
  choice?: string;
  // When the call comes in, local time. Without it, operating hours don't matter.
  at?: CallTime;
  // What the queue looks like when the call arrives.
  queue?: { estimatedWaitMinutes?: number; waitedSeconds?: number };
  // Where the call ends, as the scenario's writer says. Checked against the call engine (manual 8.3, check 4).
  answer: Answer;
}

// "Not connected": the call doesn't reach a queue.
export interface Answer { queue?: string; outcome: Outcome | "Not connected" }

export const OUTCOMES: (Outcome | "Not connected")[] = ["Agent", "Voicemail", "Callback", "Scheduled Callback", "End Call", "Transfer to Phone", "Queue Transfer", "Remain In Queue", "Not connected"];

// Which kinds and levels exist (manual 9.3). "Fix" covers levels 1 and 2: the health checks don't look
// at operating hours or overflow, which level 3 is about.
// "Build to requirements" covers every level; "Customer interview" levels 2 and 4.
export const LEVELS: Record<ScenarioKind, number[]> = { fix: [1, 2], route: [1, 2, 3], build: [1, 2, 3, 4, 5], interview: [2, 4] };

export const KIND_TITLES: Record<ScenarioKind, string> = {
  fix: "Fix the broken contact center", route: "Where does this call go?", build: "Build to requirements", interview: "Customer interview"
};

// What the AI writes: the scenario without what code adds (id, kind, level, source, date). Given to the
// model as the output schema, so its answer is valid JSON of this shape.
export function outputSchema(kind: ScenarioKind): Record<string, unknown> {
  const text = { type: "string" };
  const story = { type: "array", items: text, description: "Two or three short paragraphs." };
  if (kind === "fix") {
    return {
      type: "object", additionalProperties: false, required: ["title", "story", "faults"],
      properties: {
        title: text, story,
        faults: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: ["type", "queue", "workstream", "rule"],
            properties: {
              type: { type: "string", enum: [...FAULT_TYPES] },
              queue: { type: "string", description: "For no-members: the queue's name. Otherwise an empty string." },
              workstream: { type: "string", description: "For fallback-queue-off and rule-queue-off: the workstream's name. Otherwise an empty string." },
              rule: { type: "string", description: "For rule-queue-off: the rule's name. Otherwise an empty string." }
            }
          }
        }
      }
    };
  }
  if (kind === "build" || kind === "interview") {
    const goals = {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["type", "queue", "workstream", "choice", "hours", "action", "method", "profile", "unit", "parent", "team", "number"],
        properties: {
          type: { type: "string", enum: [...GOAL_TYPES] },
          queue: { type: "string", description: "The queue's name (a new one for choice-queue), or an empty string." },
          workstream: { type: "string", description: "The workstream's name (a new one for new-line), or an empty string." },
          choice: { type: "string", description: "For choice-queue: the new IVR choice value. Otherwise an empty string." },
          hours: { type: "string", description: "For operation-hours: the operating hours record's name. Otherwise an empty string." },
          action: { type: "string", description: "For after-hours: Voicemail, Direct callback or End call. For long-wait: Direct callback or Voicemail. Otherwise an empty string." },
          method: { type: "string", description: "For assignment-method: Least active, Highest capacity or Advanced round robin. Otherwise an empty string." },
          profile: { type: "string", description: "For capacity: the capacity profile's name. Otherwise an empty string." },
          unit: { type: "string", description: "For business-unit: the new unit's name. For team: the unit the team belongs to. Otherwise an empty string." },
          parent: { type: "string", description: "For business-unit: the existing parent unit's name. Otherwise an empty string." },
          team: { type: "string", description: "For team: the new owner team's name. Otherwise an empty string." },
          number: { type: "integer", description: "members: at least this many members. choice-queue: members of the new queue. long-wait: minutes. capacity: the work item limit. team: at least this many team members. Otherwise 0." }
        }
      }
    };
    const properties: Record<string, unknown> = { title: text, story, goals };
    const required = ["title", "story", "goals"];
    if (kind === "interview") {
      const qa = { type: "object", additionalProperties: false, required: ["ask", "answer"], properties: { ask: text, answer: text } };
      properties.persona = { type: "string", description: "The customer: a first name and their role, such as 'Priya, the service manager'." };
      properties.opening = { type: "string", description: "What the customer says first: the reason for the meeting, without the details." };
      properties.topics = { type: "array", description: "One or two per goal: a question the learner might ask, and the customer's answer that reveals the goal in everyday words.", items: { ...qa, required: ["ask", "answer", "goal"], properties: { ask: text, answer: text, goal: { type: "integer", description: "The goal's position in goals, from 0." } } } };
      properties.extras = { type: "array", description: "Two or three questions that reveal nothing new, with friendly answers.", items: qa };
      required.push("persona", "opening", "topics", "extras");
    }
    return { type: "object", additionalProperties: false, required, properties };
  }
  return {
    type: "object", additionalProperties: false, required: ["title", "story", "questions"],
    properties: {
      title: text, story,
      questions: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["caller", "dial", "choice", "day", "time", "estimatedWaitMinutes", "waitedSeconds", "answerQueue", "answerOutcome"],
          properties: {
            caller: { type: "string", description: "What the caller says, one or two sentences. No phone numbers." },
            dial: { type: "string", description: "One of the environment's phone numbers, exactly as listed." },
            choice: { type: "string", description: "The value the IVR sends for the caller's menu choice, or an empty string." },
            day: { type: "integer", description: "0 Sunday … 6 Saturday, or -1 when the time doesn't matter." },
            time: { type: "string", description: "HH:MM local time, or an empty string." },
            estimatedWaitMinutes: { type: "integer", description: "Predicted wait if the caller joins now, or -1." },
            waitedSeconds: { type: "integer", description: "Time the caller already waited in the queue, or -1." },
            answerQueue: { type: "string", description: "The queue the call ends in, or an empty string when it doesn't reach one." },
            answerOutcome: { type: "string", enum: OUTCOMES }
          }
        }
      }
    }
  };
}

// The AI's answer turned into a scenario. Empty strings and -1 stand for "not given", because a strict
// schema has no optional fields.
export function fromOutput(kind: ScenarioKind, level: number, out: any, now = new Date()): Scenario {
  const base = { kind, level, title: String(out?.title ?? ""), story: Array.isArray(out?.story) ? out.story.map(String) : [], source: "ai" as const, createdOn: now.toISOString().slice(0, 10) };
  const id = `${kind}-${level}-${slug(base.title)}-${now.getTime().toString(36)}`;
  if (kind === "fix") {
    const faults = (Array.isArray(out?.faults) ? out.faults : []).map((f: any): Fault => {
      if (f?.type === "no-members") return { type: "no-members", queue: String(f.queue ?? "") };
      if (f?.type === "fallback-queue-off") return { type: "fallback-queue-off", workstream: String(f.workstream ?? "") };
      return { type: f?.type, workstream: String(f?.workstream ?? ""), rule: String(f?.rule ?? "") } as Fault;
    });
    return { id, ...base, faults };
  }
  if (kind === "build" || kind === "interview") {
    const goals = (Array.isArray(out?.goals) ? out.goals : []).map((g: any): Goal => {
      const n = Number(g?.number ?? 0);
      switch (g?.type) {
        case "members": return { type: "members", queue: String(g.queue), atLeast: n };
        case "fallback": return { type: "fallback", workstream: String(g.workstream), queue: String(g.queue) };
        case "choice-queue": return { type: "choice-queue", workstream: String(g.workstream), choice: String(g.choice), queue: String(g.queue), members: n };
        case "operation-hours": return { type: "operation-hours", queue: String(g.queue), hours: String(g.hours) };
        case "after-hours": return { type: "after-hours", queue: String(g.queue), action: g.action };
        case "long-wait": return { type: "long-wait", queue: String(g.queue), minutes: n, action: g.action };
        case "assignment-method": return { type: "assignment-method", queue: String(g.queue), method: g.method };
        case "capacity": return { type: "capacity", profile: String(g.profile), limit: n };
        case "business-unit": return { type: "business-unit", unit: String(g.unit), parent: String(g.parent) };
        case "team": return { type: "team", team: String(g.team), unit: String(g.unit), members: n };
        default: return { type: "new-line", workstream: String(g?.workstream ?? ""), queue: String(g?.queue ?? "") };
      }
    });
    const scenario: Scenario = { id, ...base, goals };
    if (kind === "interview") scenario.interview = {
      persona: String(out?.persona ?? ""), opening: String(out?.opening ?? ""),
      topics: (Array.isArray(out?.topics) ? out.topics : []).map((t: any) => ({ ask: String(t?.ask ?? ""), answer: String(t?.answer ?? ""), goal: Number(t?.goal) })),
      extras: (Array.isArray(out?.extras) ? out.extras : []).map((t: any) => ({ ask: String(t?.ask ?? ""), answer: String(t?.answer ?? "") }))
    };
    return scenario;
  }
  const questions = (Array.isArray(out?.questions) ? out.questions : []).map((q: any, i: number): Question => ({
    id: `q${i + 1}`,
    caller: String(q?.caller ?? ""),
    dial: String(q?.dial ?? ""),
    ...(q?.choice ? { choice: String(q.choice) } : {}),
    ...(Number.isInteger(q?.day) && q.day >= 0 && q?.time ? { at: { day: q.day, time: String(q.time) } } : {}),
    ...(q?.estimatedWaitMinutes >= 0 || q?.waitedSeconds >= 0 ? {
      queue: { ...(q.estimatedWaitMinutes >= 0 ? { estimatedWaitMinutes: q.estimatedWaitMinutes } : {}), ...(q.waitedSeconds >= 0 ? { waitedSeconds: q.waitedSeconds } : {}) }
    } : {}),
    answer: { ...(q?.answerQueue ? { queue: String(q.answerQueue) } : {}), outcome: q?.answerOutcome }
  }));
  return { id, ...base, questions };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scenario";

// Check 1 of manual 8.3: the scenario has the right shape. Returns what's wrong, in plain words.
export function shapeProblems(s: Scenario): string[] {
  const p: string[] = [];
  if (!["fix", "route", "build", "interview"].includes(s.kind)) p.push(`Unknown kind “${s.kind}”.`);
  if (!LEVELS[s.kind]?.includes(s.level)) p.push(`Level ${s.level} doesn't exist for this kind (levels ${LEVELS[s.kind]?.join(", ")}).`);
  if (!s.title.trim() || s.title.length > 80) p.push("The title must be 1 to 80 characters.");
  if (s.story.length < 1 || s.story.length > 4 || s.story.some((x) => !x.trim() || x.length > 700)) p.push("The story must be 1 to 4 paragraphs of at most 700 characters.");
  const texts = [s.title, ...s.story, ...(s.questions ?? []).map((q) => q.caller),
    ...(s.interview ? [s.interview.persona, s.interview.opening, ...s.interview.topics.flatMap((t) => [t.ask, t.answer]), ...s.interview.extras.flatMap((t) => [t.ask, t.answer])] : [])];
  // Phone numbers only come from the environment, in fiction ranges (manual 5.1): never in the text.
  if (texts.some((t) => /\d[\d\s-]{6,}\d/.test(t))) p.push("The text contains something that looks like a phone number. Leave numbers out of the text.");
  if (s.kind === "build" || s.kind === "interview") {
    const goals = s.goals ?? [];
    if (goals.length < 1 || goals.length > 4) p.push(`A scenario has 1 to 4 goals; this one has ${goals.length}.`);
    goals.forEach((g, i) => {
      if (!GOAL_TYPES.includes(g.type)) p.push(`Goal ${i + 1} has an unknown type “${g.type}”.`);
      else if (GOAL_LEVEL[g.type] > s.level) p.push(`Goal ${i + 1} (${g.type}) belongs to level ${GOAL_LEVEL[g.type]}, above this scenario's level ${s.level}.`);
    });
    if (goals.length && !goals.some((g) => GOAL_LEVEL[g.type] === s.level)) p.push(`Include at least one goal of level ${s.level}.`);
    if (s.kind === "interview") {
      const iv = s.interview;
      if (!iv || !iv.persona.trim() || !iv.opening.trim()) p.push("An interview needs a persona and an opening line.");
      else {
        goals.forEach((_, i) => { if (!iv.topics.some((t) => t.goal === i)) p.push(`No question in the interview reveals goal ${i + 1}.`); });
        if (iv.topics.some((t) => !Number.isInteger(t.goal) || t.goal < 0 || t.goal >= goals.length)) p.push("A topic points to a goal that doesn't exist.");
        if (iv.extras.length < 1) p.push("Add at least one question that reveals nothing new.");
        if ([...iv.topics, ...iv.extras].some((t) => !t.ask.trim() || !t.answer.trim() || t.answer.length > 400)) p.push("Every question and answer has text, answers at most 400 characters.");
      }
    }
  } else if (s.kind === "fix") {
    const faults = s.faults ?? [];
    const [min, max] = s.level === 1 ? [1, 2] : [2, 4];
    if (faults.length < min || faults.length > max) p.push(`A level ${s.level} fix scenario has ${min} to ${max} faults; this one has ${faults.length}.`);
    faults.forEach((f, i) => { if (!FAULT_TYPES.includes(f.type)) p.push(`Fault ${i + 1} has an unknown type “${f.type}”.`); });
    if (s.level === 1 && faults.some((f) => f.type === "rule-queue-off")) p.push("Level 1 is before routing rules: use no-members or fallback-queue-off.");
    if (s.level === 2 && !faults.some((f) => f.type === "rule-queue-off")) p.push("Level 2 is about routing rules: include at least one rule-queue-off fault.");
  } else {
    const qs = s.questions ?? [];
    if (qs.length < 3 || qs.length > 5) p.push(`A scenario has 3 to 5 calls; this one has ${qs.length}.`);
    qs.forEach((q, i) => {
      const n = i + 1;
      if (!q.caller.trim() || q.caller.length > 300) p.push(`Call ${n}: what the caller says must be 1 to 300 characters.`);
      if (!OUTCOMES.includes(q.answer.outcome)) p.push(`Call ${n}: unknown outcome “${q.answer.outcome}”.`);
      if (q.answer.outcome === "Not connected" ? !!q.answer.queue : !q.answer.queue) p.push(`Call ${n}: give the queue the call ends in, or no queue for “Not connected”.`);
      if (q.at && (q.at.day < 0 || q.at.day > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(q.at.time))) p.push(`Call ${n}: the time must be a day 0–6 and HH:MM.`);
      if (s.level < 3 && (q.at || q.queue)) p.push(`Call ${n}: times and wait times belong to level 3.`);
    });
    if (s.level >= 2 && !qs.some((q) => q.choice)) p.push("Level 2 and 3 are about IVR choices: at least one call makes a menu choice.");
    if (s.level === 3 && !qs.some((q) => q.at)) p.push("Level 3 is about operating hours and overflow: at least one call has a time.");
  }
  return p;
}
