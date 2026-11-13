// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import labsJson from "../../content/labs/labs.json";
import templateJson from "../../content/lessons/new-menu-choice.json";
import { assignmentFor, methodOf } from "../calls/assignment";
import { classificationRulesets } from "../admin/rules";
import { Lesson } from "../lessons/checks";
import { fill, Line, linesWithIvr, LessonTemplate, lineLabel, listOf, makeLesson } from "../lessons/template";
import { Store } from "../simulator/store";

// The labs: a path through the subjects in a recommended order (content/labs/labs.json). Each lab has
// three parts: Learn (pages and a quiz), Do (tasks in the environment, checked by code, like a lesson) and
// Challenge (ready-made exercises). Progress is kept like finished exercises (classroom/identity.ts), as
// "lab-<id>-learn" and "lab-<id>-do"; a lab is done when both are.

export interface LearnPage { title: string; text: string[]; concepts?: string[]; diagram?: "call-path" | "queue-people" | "rules" }
export interface QuizQuestion { id: string; question: string; options: string[]; answer: number; why: string }
export type LabDo = { template: "new-menu-choice" } | Omit<Lesson, "id" | "level" | "line" | "variant">;
export interface Lab {
  id: string;
  number: number;
  title: string;
  summary: string;
  status: "ready" | "planned";
  learn?: LearnPage[];
  quiz?: QuizQuestion[];
  do?: LabDo;
  challenges?: string[];
}
export type LabPart = "learn" | "do" | "challenge";

// Where the learner is in a lab: kept with the session.
export interface LabState { labId: string; part: LabPart; page: number; quiz: Record<string, number>; seen?: number }

export const LABS = (labsJson.labs as Lab[]).sort((a, b) => a.number - b.number);
export const labById = (id: string) => LABS.find((l) => l.id === id);

// The id a lab has in a class and in the finished list.
export const classId = (lab: Lab) => `lab-${lab.id}`;
export const learnDoneId = (lab: Lab) => `lab-${lab.id}-learn`;
export const doDoneId = (lab: Lab) => `lab-${lab.id}-do`;

export type LabStatus = "done" | "started" | "next" | "open" | "planned";

// Learn and Do done, in this browser, or done for the class (the class reports a whole lab as done, so
// that counts for both in another browser).
export const learnDone = (lab: Lab, finished: string[]) => finished.includes(learnDoneId(lab)) || finished.includes(classId(lab));
export const doDone = (lab: Lab, finished: string[]) => finished.includes(doDoneId(lab)) || finished.includes(classId(lab));

// Done, started, the recommended next one, or just open. The recommended next lab is the first ready lab
// that isn't done; the learner can open any ready lab.
export function labStatuses(finished: string[]): Map<string, LabStatus> {
  const out = new Map<string, LabStatus>();
  let next = false;
  for (const lab of LABS) {
    if (lab.status !== "ready") { out.set(lab.id, "planned"); continue; }
    const learn = learnDone(lab, finished), done = doDone(lab, finished);
    if (learn && done) { out.set(lab.id, "done"); continue; }
    if (!next) { next = true; out.set(lab.id, "next"); continue; }
    out.set(lab.id, learn || done ? "started" : "open");
  }
  return out;
}

export const quizPassed = (lab: Lab, answers: Record<string, number>) => (lab.quiz ?? []).every((q) => answers[q.id] === q.answer);

// The line a lab uses: the customer service line if there is one, else the first line with an IVR.
function labLine(store: Store): Line {
  const lines = linesWithIvr(store);
  const line = lines.find((l) => /customer service/i.test(l.workstream)) ?? lines[0];
  if (!line) throw new Error("No phone line with an IVR and a menu in this environment.");
  return line;
}

const NEW_QUEUE = "Priority Customers";

const VOICE = 192440000;
const voiceWorkstreams = (store: Store) => store.table("msdyn_liveworkstream").filter((w) => w.msdyn_streamsource === VOICE && w.statecode === 0 && w._msdyn_defaultqueue_value);
const numbersOf = (store: Store, workstreamId: string) => store.table("msdyn_ocvoicechannelsetting").filter((c) => c._msdyn_liveworkstreamid_value === workstreamId && c._msdyn_phonenumberid_value);
const nameOf = (store: Store, table: string, id: unknown) => (id ? String(store.find(table, String(id))?.[table === "queue" ? "name" : "msdyn_name"] ?? "") : "");

// The values a lab's {placeholders} take in this environment.
export function labValues(store: Store): Record<string, string> {
  const line = labLine(store);
  const [first, second] = line.menu;
  const queue1 = store.find("queue", first.queueId);
  const queue2 = second ? store.find("queue", second.queueId) : undefined;
  // Who the queue would give the next call to: the learner signs in as them to get it.
  const rep = queue1 ? assignmentFor(store, queue1.queueid, line.workstreamId).chosen?.name : undefined;
  // The second line with an IVR (technical support if there is one), for labs that need another line.
  const lines = linesWithIvr(store);
  const tech = lines.find((l) => /technical/i.test(l.workstream) && l !== line) ?? lines.find((l) => l !== line) ?? line;
  const retail = lines.find((l) => /retail|sales/i.test(l.workstream)) ?? tech;
  // Lines without an IVR: one with a number (Dutch Desk in the training) and one without (Partner Line).
  const noIvr = voiceWorkstreams(store).filter((w) => !w._msdyn_bot_user_value);
  const dutch = noIvr.find((w) => numbersOf(store, w.msdyn_liveworkstreamid).length);
  const partner = noIvr.find((w) => !numbersOf(store, w.msdyn_liveworkstreamid).length);
  const ws = store.find("msdyn_liveworkstream", line.workstreamId)!;
  const profileLink = store.table("msdyn_liveworkstreamcapacityprofile").find((l) => l._msdyn_workstream_id_value === line.workstreamId);
  const profile = profileLink ? store.find("msdyn_capacityprofile", profileLink._msdyn_capacityprofile_id_value) : undefined;
  const technical = line.menu.find((m) => /technical/i.test(m.label)) ?? line.menu[line.menu.length - 1];
  const last = line.menu[line.menu.length - 1];
  const hours1 = queue1?._msdyn_operatinghourid_value ? String(store.find("msdyn_operatinghour", queue1._msdyn_operatinghourid_value)?.msdyn_name ?? "") : String(store.table("msdyn_operatinghour")[0]?.msdyn_name ?? "");
  const dial = (id: string | undefined) => {
    const c = id ? numbersOf(store, id)[0] : undefined;
    return c ? String(store.find("msdyn_ocphonenumber", c._msdyn_phonenumberid_value)?.msdyn_phonenumber ?? "") : "";
  };
  return {
    techWs: tech.workstream, techDial: tech.dial, techLine: lineLabel(tech.workstream), techFallback: tech.fallback,
    techQueue1: nameOf(store, "queue", tech.menu[0]?.queueId), techChoice1: tech.menu[0]?.label ?? "", techValue1: tech.menu[0]?.value ?? "",
    retailQueue2: nameOf(store, "queue", (retail.menu[1] ?? retail.menu[0])?.queueId),
    dutchWs: String(dutch?.msdyn_name ?? ""), dutchDial: dial(dutch?.msdyn_liveworkstreamid), partnerWs: String(partner?.msdyn_name ?? ""),
    wsNumbers: String(numbersOf(store, line.workstreamId).length),
    profile: String(profile?.msdyn_name ?? ""), limit: String(profile?.msdyn_defaultmaxunits ?? 1),
    method1: methodOf(queue1), next1: rep ?? "",
    choiceLast: last.label, valueLast: last.value, techChoice: technical.label, techValue: technical.value, techQueue: nameOf(store, "queue", technical.queueId),
    rulesets: String(classificationRulesets(store, ws.msdyn_liveworkstreamid).length), hours1,
    line: lineLabel(line.workstream), dial: line.dial, workstream: line.workstream, variable: line.variable,
    menu: listOf(line.menu.map((m) => m.label)), fallback: line.fallback,
    choice1: first.label, value1: first.value, queue1: String(queue1?.name ?? ""),
    choice2: second?.label ?? first.label, value2: second?.value ?? first.value, queue2: String(queue2?.name ?? queue1?.name ?? ""),
    members1: String(store.table("queuemembership").filter((m) => m.queueid === queue1?.queueid).length),
    rep: rep ?? "a member of the queue", newQueue: NEW_QUEUE
  };
}

// The lab's Do part as a lesson: the "new menu choice" template, or the lab's own tasks with their
// {placeholders} filled in from the environment.
export function labLesson(lab: Lab, store: Store, seed: number): Lesson {
  const d = lab.do;
  if (!d) throw new Error(`The lab “${lab.title}” has no hands-on part.`);
  if ("template" in d) return { ...makeLesson(templateJson as LessonTemplate, store, seed), id: classId(lab) };
  const values = labValues(store);
  const line = labLine(store);
  const filled = fill(d, values);
  return {
    ...filled, id: classId(lab), level: lab.number,
    line: {
      dial: line.dial, label: `Contoso ${values.line}`,
      ivr: { workstream: line.workstream, variable: line.variable, prompt: "Welcome to Contoso. What is your call about?", options: line.menu.map((m) => ({ label: m.label, value: m.value })) }
    }
  };
}
