// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { healthySeed } from "../../../src/simulator/seeds/healthy";
import { fromOutput, KIND_TITLES, outputSchema, Scenario, ScenarioKind } from "../../../src/scenarios/scenario";
import { inSimulator, validateScenario } from "../../../src/scenarios/validate";
import { describeEnvironment, environmentText, Environment } from "../../../src/scenarios/world";
import { requirement } from "../../../src/scenarios/goals";
import { AiError, AiProvider, Turn } from "./provider";

// The AI writes, the code checks (manual principle 2 and 8.3). A scenario that fails a check goes back
// to the AI with what failed, up to three times, then it's dropped. One that passes is saved and reused.

export const MAX_ATTEMPTS = 3;

let environment: Promise<Environment> | undefined;
export const healthyEnvironment = () => (environment ??= inSimulator(healthySeed(), (sim) => describeEnvironment(sim.store)));

const LEVEL_BRIEF: Record<ScenarioKind, Record<number, string>> = {
  fix: {
    1: "Level 1 (one number, one workstream, one queue): plant 1 or 2 faults of type no-members or fallback-queue-off.",
    2: "Level 2 (route-to-queue rules and IVR choices): plant 2 to 4 faults, at least one of type rule-queue-off."
  },
  route: {
    1: "Level 1 (which line leads where): 3 to 5 calls. No times and no wait times.",
    2: "Level 2 (IVR choices and route-to-queue rules): 3 to 5 calls, most with a menu choice, including one that no rule checks, so the call goes to the fallback queue. No times and no wait times.",
    3: "Level 3 (operating hours and overflow): 3 to 5 calls with a menu choice. Give most calls a day and time; include calls inside and outside opening hours, and one where a wait time makes an overflow rule fire."
  },
  build: {
    1: "Level 1: 1 or 2 goals of type members or fallback.",
    2: "Level 2: 1 to 3 goals, at least one choice-queue (a new IVR choice value that no rule checks yet, and a new queue name).",
    3: "Level 3: 1 to 3 goals, at least one of operation-hours, after-hours or long-wait. Queues without operation hours need operation-hours or after-hours (after-hours sets Business hours if the queue has none).",
    4: "Level 4: 1 to 3 goals, at least one of assignment-method, capacity or skills.",
    5: "Level 5: 1 to 3 goals, at least one of new-line (a new workstream name ending in ' – Voice', with an existing queue as its fallback), business-unit, team or outbound-profile."
  },
  interview: {
    2: "Level 2: 1 to 3 goals, at least one choice-queue (a new IVR choice value that no rule checks yet, and a new queue name).",
    4: "Level 4: 1 to 3 goals, at least one of assignment-method, capacity or skills."
  }
};

// The goal types a level is about. Left to itself the AI keeps picking the same one (four level 4 scenarios
// in a row were all about capacity, none about skills), so each new scenario gets one, picked at random, it
// must include (manual 9.4b, variety).
const FOCUS: Partial<Record<ScenarioKind, Record<number, string[]>>> = {
  build: { 3: ["operation-hours", "after-hours", "long-wait"], 4: ["assignment-method", "capacity", "skills"], 5: ["new-line", "business-unit", "team", "outbound-profile"] },
  interview: { 4: ["assignment-method", "capacity", "skills"] }
};

export function pickFocus(kind: ScenarioKind, level: number, random: () => number = Math.random): string | undefined {
  const options = FOCUS[kind]?.[level];
  return options?.[Math.floor(random() * options.length)];
}

const GOALS_BRIEF = `The goals you can use (each must NOT be met already in the environment below, and code checks that):
- members: the queue has at least "number" members (more than it has now).
- fallback: the workstream's fallback queue becomes "queue" (a different one than now).
- choice-queue: callers on "workstream" who choose "choice" reach a new voice queue "queue" with "number" members.
- operation-hours: the queue keeps the operating hours record "hours" (one of the names in the environment).
- after-hours: calls to the queue outside its opening times get "action" (Voicemail, Direct callback or End call).
- long-wait: when the predicted wait for the queue is "number" minutes or more, callers get "action" (Direct callback or Voicemail).
- assignment-method: the queue hands out calls with "method" (Least active, Highest capacity or Advanced round robin; not its current one).
- capacity: the capacity profile "profile" gets a work item limit of "number" (not its current one; the voice profile is "Default voice inbound", limit 1 now).
- new-line: a new voice workstream "workstream" with a phone number, taking calls into the existing queue "queue".
- business-unit: a new business unit "unit" under the existing business unit "parent" (Contoso, Contoso Sales or Contoso Support).
- team: a new owner team "team" in the existing (or, with a business-unit goal, new) business unit "unit", with at least "number" members.
- skills (level 4): callers on "workstream" who choose "choice" (an existing IVR choice that routes to "queue") need the existing skill "skill" at "rating" (Beginner, Intermediate or Expert) with Exact Match, and at least "number" members of "queue" have it. Pick a number higher than the members who have it now.
- outbound-profile (level 5): a new outbound profile "profile" for calling customers, whose calls belong to the existing voice queue "queue".
Leave fields a goal doesn't use empty, or 0 for "number".`;

const KIND_BRIEF: Record<ScenarioKind, string> = {
  fix: `The learner gets a contact center with faults planted in it, finds them with the Environment Diagram and fixes them in the admin center. The faults you can plant:
- no-members: every member is taken out of a queue that calls are routed to (give "queue").
- fallback-queue-off: a workstream's fallback queue is switched off (give "workstream").
- rule-queue-off: a route-to-queue rule now routes to a queue that's switched off (give "workstream" and "rule").
The story describes what people notice (symptoms), never the fault itself or how to fix it. Only these symptoms are true in the training, so describe no others (no voicemail, callbacks or busy signals):
- no-members: callers reach the queue and wait; nobody ever picks up, because nobody works in it.
- fallback-queue-off: callers whose choice no rule routes (or on a line without rules) don't reach any queue at all.
- rule-queue-off: callers who make that rule's menu choice end up in the workstream's fallback queue (usually Overflow) instead of the team they asked for.`,
  build: `The learner builds what a Contoso manager asks for, in the admin center. The story says what the business wants in everyday words, not which settings to change.
${GOALS_BRIEF}`,
  interview: `The learner interviews a Contoso manager to find out what they need, then builds it. Write the goals, the manager (persona), what they say first (opening, without the details), one or two topics per goal (a question the learner might ask, and an answer that reveals the goal in everyday words, never in admin center terms), and two or three extra questions that reveal nothing new. The story only sets the scene.
${GOALS_BRIEF}`,
  route: `The learner predicts where each call goes before seeing the answer. For each call give the number dialled, the caller's menu choice (the exact value, or empty on a line without an IVR or when the caller makes no choice), and where the call ends: the queue and the outcome ("Agent" means it waits for a representative). Work the answer out from the environment below; code will place every call and check it.`
};

export function systemPrompt(env: Environment): string {
  return `You write practice scenarios for a training in Dynamics 365 Contact Center, for consultants and administrators. The training runs on a simulated environment of a made-up company, Contoso. Write in plain English: short sentences, everyday words.

Rules:
- Use the names of lines, workstreams, rules, queues and choice values exactly as they are written below.
- Never write a phone number in the title, the story or what a caller says. Numbers only go in the "dial" field, and only the environment's own.
- The people in the story are made up. Use first names only.
- Don't explain how Dynamics 365 works; the training does that with Microsoft Learn.

The environment:
${environmentText(env)}`;
}

export function userPrompt(kind: ScenarioKind, level: number, avoid: string[], focus?: string): string {
  return `Write a "${KIND_TITLES[kind]}" scenario.

${KIND_BRIEF[kind]}

${LEVEL_BRIEF[kind][level]}${focus ? ` This time, one of the goals must be of type ${focus}.` : ""}

Title: up to 80 characters. Story: two or three short paragraphs.${avoid.length ? `\n\nOther scenarios already exist with these titles; write something different:\n${avoid.map((t) => `- ${t}`).join("\n")}` : ""}`;
}

export interface Written { scenario?: Scenario; attempts: { problems: string[] }[] }

// One try: the AI writes (again, after earlier tries and what failed in them), and code checks it.
// Hosted, an API request may take at most 45 seconds (Learn, "Overview of API support in Azure Static Web
// Apps", Constraints), so each try is its own request and the browser sends the earlier ones back.
export interface Attempt { text: string; problems: string[] }
export interface AttemptResult { scenario?: Scenario; text: string; problems: string[] }

export async function writeScenarioAttempt(ai: AiProvider, kind: ScenarioKind, level: number, options: { avoid?: string[]; previous?: Attempt[]; random?: () => number } = {}): Promise<AttemptResult> {
  if (!LEVEL_BRIEF[kind]?.[level]) throw new AiError(`There's no level ${level} for this kind of scenario.`, 400);
  const previous = options.previous ?? [];
  if (previous.length >= MAX_ATTEMPTS) throw new AiError(`A scenario gets ${MAX_ATTEMPTS} tries.`, 400);
  const env = await healthyEnvironment();
  // A focus only on the first try: a later try fixes the earlier draft, which already has its focus.
  const focus = previous.length ? undefined : pickFocus(kind, level, options.random);
  const turns: Turn[] = [{ role: "user", text: userPrompt(kind, level, options.avoid ?? [], focus) }];
  for (const a of previous) turns.push({ role: "assistant", text: a.text }, { role: "user", text: `The training's checks found these problems:\n${a.problems.map((p) => `- ${p}`).join("\n")}\n\nWrite the whole scenario again with these fixed.` });
  const { json, text } = await ai.complete(systemPrompt(env), turns, outputSchema(kind));
  const scenario = fromOutput(kind, level, json);
  const problems = await validateScenario(scenario);
  return problems.length ? { text, problems } : { scenario, text, problems };
}

export async function writeScenario(ai: AiProvider, kind: ScenarioKind, level: number, options: { avoid?: string[]; saveDir?: string } = {}): Promise<Written> {
  const previous: Attempt[] = [];
  const attempts: { problems: string[] }[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const r = await writeScenarioAttempt(ai, kind, level, { avoid: options.avoid, previous });
    attempts.push({ problems: r.problems });
    if (r.scenario) {
      if (options.saveDir) save(options.saveDir, r.scenario);
      return { scenario: r.scenario, attempts };
    }
    previous.push({ text: r.text, problems: r.problems });
  }
  return { attempts };
}

function save(dir: string, s: Scenario): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
}

export function savedScenarios(dir: string): Scenario[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Scenario)
    .sort((a, b) => String(b.createdOn).localeCompare(String(a.createdOn)));
}

// ---- the AI caller (manual 5.5) ----

export interface Caller { name: string; mood: string; says: string; choice: string }

const CALLER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["name", "mood", "says", "choice"],
  properties: {
    name: { type: "string", description: "A made-up first name." },
    mood: { type: "string", description: "One or two words." },
    says: { type: "string", description: "What the caller says when the call starts: one or two sentences, no phone numbers." },
    choice: { type: "string", description: "The menu choice the caller makes: one of the line's choice values, or an empty string." }
  }
};

// A caller for a line: who they are, why they call, and what they choose in the IVR. Code checks the
// choice is one the line knows (or none) before the training places the call.
export async function writeCaller(ai: AiProvider, dial: string): Promise<Caller> {
  const env = await healthyEnvironment();
  const line = env.lines.find((l) => l.dial === dial);
  if (!line) throw new AiError(`${dial} isn't one of the environment's numbers.`, 400);
  const values = line.choices.map((c) => c.value);
  const prompt = `Play a customer calling Contoso on the line for “${line.workstream}”.${line.ivr
    ? ` An IVR asks what the call is about. Its choice values are: ${values.map((v) => `“${v}”`).join(", ")}. Pick the one that fits your reason, or an empty string if none fits.`
    : " Nobody asks the caller anything, so the choice is an empty string."} Give the caller an everyday reason to call. Plain English.`;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const { json } = await ai.complete("You play callers for a contact center training. The company, Contoso, and the callers are made up.", [{ role: "user", text: prompt }], CALLER_SCHEMA);
    const c = json as Caller;
    const ok = typeof c?.says === "string" && c.says.trim() && !/\d[\d\s-]{6,}\d/.test(c.says) && (c.choice === "" || (line.ivr && values.includes(c.choice)));
    if (ok) return { name: String(c.name), mood: String(c.mood), says: c.says, choice: c.choice };
  }
  throw new AiError("The AI didn't write a caller the training could use.");
}

// ---- the AI customer in an interview (manual 8.2) ----

export interface InterviewAnswer { answer: string; revealed: number[] }

const INTERVIEW_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answer", "revealed"],
  properties: {
    answer: { type: "string", description: "What the customer says, one to three sentences." },
    revealed: { type: "array", items: { type: "integer" }, description: "The numbers of the needs this answer told the learner about, or an empty list." }
  }
};

// The customer answers the learner's own question from what the scenario says they know, without
// giving the solution away; code checks the needs it says it revealed exist.
export async function answerAsCustomer(ai: AiProvider, s: Scenario, talk: Turn[], question: string): Promise<InterviewAnswer> {
  const iv = s.interview;
  if (!iv || !s.goals?.length) throw new AiError("This scenario has no interview.", 400);
  if (!question.trim() || question.length > 300) throw new AiError("Ask a question of up to 300 characters.", 400);
  const needs = s.goals.map((g, i) => `${i}. ${requirement(g)} What you'd say: ${iv.topics.filter((t) => t.goal === i).map((t) => t.answer).join(" ")}`).join("\n");
  const system = `You are ${iv.persona} at Contoso, a made-up company, talking to a consultant who sets up your contact center. You know what you need, not how the admin center works.
Your needs:
${needs}
Other things you know: ${iv.extras.map((t) => t.answer).join(" ")}
Answer the consultant's question in one to three plain sentences, in your own words. Only share a need when the question is about it. Never name admin center settings, and never say how to build it. If you don't know, say so. In "revealed", list the numbers of the needs this answer told them about.`;
  const turns: Turn[] = [...talk, { role: "user", text: question.trim() }];
  const { json } = await ai.complete(system, turns, INTERVIEW_SCHEMA);
  const out = json as InterviewAnswer;
  if (typeof out?.answer !== "string" || !out.answer.trim() || /\d[\d\s-]{6,}\d/.test(out.answer)) throw new AiError("The AI customer's answer couldn't be used.");
  return { answer: out.answer.trim(), revealed: (Array.isArray(out.revealed) ? out.revealed : []).filter((n) => Number.isInteger(n) && n >= 0 && n < s.goals!.length) };
}

// ---- AI hints (manual 8.2 "Feedback") ----

const HINT_SCHEMA = { type: "object", additionalProperties: false, required: ["hint"], properties: { hint: { type: "string", description: "Two or three plain sentences." } } };

// A hint for one requirement, based on the training's Learn passage for its concept. The passage is
// shown with the hint in the training, so the learner sees where it comes from (manual 7.4).
export async function writeHint(ai: AiProvider, requirementText: string, checks: string[], concept: { title: string; quote: string }): Promise<string> {
  const system = "You coach consultants learning Dynamics 365 Contact Center in a simulated admin center. Give a short hint that points the way without doing the task for them. Base it only on the Microsoft Learn passage given; don't add product facts of your own. Plain English, two or three sentences.";
  const user = `Requirement: ${requirementText}
What the training's checks say now:
${checks.map((c) => `- ${c}`).join("\n")}
Microsoft Learn passage (${concept.title}): "${concept.quote}"`;
  const { json } = await ai.complete(system, [{ role: "user", text: user }], HINT_SCHEMA);
  const hint = String((json as { hint?: string })?.hint ?? "").trim();
  if (!hint || hint.length > 600) throw new AiError("The AI's hint couldn't be used.");
  return hint;
}
