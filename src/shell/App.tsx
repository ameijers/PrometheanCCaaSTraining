// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";
import { FluentProvider, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, Tab, TabList, webLightTheme } from "@fluentui/react-components";
import { AdminCenter, AdminRequest } from "../admin/AdminCenter";
import { conceptForRecord, recordLink } from "../learn/records";
import { Navigate } from "../simulator/xrmShim";
import { Phone } from "../calls/Phone";
import { AgentView } from "../calls/AgentView";
import { ClockBar } from "../calls/ClockBar";
import { Clock, START } from "../calls/clock";
import { Routing } from "../calls/routing";
import { LearnStrip } from "../learn/LearnStrip";
import { CheckResult, Lesson, record, recorded, runChecks, Task } from "../lessons/checks";
import type { Detail } from "../classroom/client";
import { classId, doDone, doDoneId, LabEvent, LABS, labById, labLesson, LabPart, LabState, learnDone, learnDoneId } from "../labs/labs";
import type { Answer } from "../scenarios/scenario";
import { LabHeader, LabPanel } from "../labs/LabPanel";
import { LabView } from "../labs/LabView";
import { LessonPanel } from "../lessons/LessonPanel";
import { Simulator } from "../simulator";
import { clearSession, saveSession } from "../simulator/persist";
import { trainingSeed } from "../simulator/seeds/training";
import { Store } from "../simulator/store";
import { LessonTemplate, makeLesson, newSeed } from "../lessons/template";
import templateJson from "../../content/lessons/new-menu-choice.json";
import { ExercisePicker, READY_MADE } from "../scenarios/ExercisePicker";
import { ClassDialog, JoinDialog, PersonalCodeDialog, TrainerOpen, TrainerView } from "../classroom/Classroom";
import { FeedbackDialog, FeedbackInbox } from "./Feedback";
import { Me, me, signIn } from "../classroom/account";
import { loadWork, reportProgress, saveWork } from "../classroom/client";
import { finished, markFinished, Membership, membership, setMembership } from "../classroom/identity";
import { canPack, pack, unpack } from "../classroom/work";
import { Session } from "../simulator/persist";
import { aiScenarios } from "../scenarios/client";
import { tourAsked } from "@toolbox/environment-3d-explorer/src/tour";
import { TourCard, useTrainingTour, Welcome } from "./Tour";
import { CallAnswer, ScenarioPanel } from "../scenarios/ScenarioPanel";
import { Talk } from "../scenarios/BuildExercise";
import { Scenario } from "../scenarios/scenario";
import { scenarioRows } from "../scenarios/world";
import { TrainingContext } from "./context";
import { ExportDialog } from "../export/ExportDialog";

export const NAVIGATE_EVENT = "ccaas-navigate";

// "Edge 131", "Chrome 131", "Firefox 133", "Safari 18": enough to reproduce a problem.
function browserName(ua: string): string {
  const m = /Edg\/(\d+)/.exec(ua) ?? /Firefox\/(\d+)/.exec(ua) ?? /Chrome\/(\d+)/.exec(ua) ?? /Version\/(\d+).*Safari/.exec(ua);
  const name = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Another browser";
  return m ? `${name} ${m[1]}` : name;
}

const template = templateJson as LessonTemplate;
type Workspace = Task["tab"] | "lab";

// The training screen: the lesson on the left, where the learner works in the middle (the simulated
// admin center, the Environment Diagram, the phone), and the explanation from Microsoft Learn below.
// What the learner is doing: the guided lesson, or a scenario (manual 9.1) with their answers so far.
export interface ScenarioRun { scenario: Scenario; answers: Record<string, CallAnswer>; hints: Record<string, number>; found?: number[]; talk?: Talk[]; events?: LabEvent[] }

export function App({ sim, restored, savedLesson, savedScenario, savedClock, seed, savedLab }: { sim: Simulator; restored: boolean; savedLesson?: Lesson; savedScenario?: ScenarioRun; savedClock?: number; seed?: number; savedLab?: LabState }) {
  // The simulated clock, and the routing that assigns calls as it runs (phase 6): one assignment cycle a second.
  const clock = useMemo(() => new Clock(savedClock), [sim]);
  const routing = useMemo(() => new Routing(sim.store), [sim]);
  useEffect(() => {
    const timer = setInterval(() => routing.cycle(clock.now()), 1000);
    return () => clearInterval(timer);
  }, [clock, routing]);
  // This run's lesson: the saved one, or a new variant of the template (manual 9.4b).
  const [lesson, setLesson] = useState<Lesson>(() => savedLesson ?? makeLesson(template, sim.store, seed ?? newSeed()));
  const [run, setRun] = useState<ScenarioRun | undefined>(savedScenario);
  // The lab the learner is in (src/labs). Someone new starts at the first lab; ?seed=N opens the lesson as before.
  const [lab, setLab] = useState<LabState | undefined>(() => savedLab ?? (!restored && seed === undefined ? { labId: LABS[0].id, part: "learn", page: 0, quiz: {} } : undefined));
  const labRef = useRef(lab);
  labRef.current = lab;
  const labDef = lab ? labById(lab.labId) : undefined;
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;
  const runRef = useRef(run);
  runRef.current = run;
  (window as any).__ccaasTraining.lesson = lesson;
  (window as any).__ccaasTraining.scenario = run?.scenario;
  // For scripts (scripts/agent.js): the environment and the routing.
  Object.assign((window as any).__ccaasTraining, { store: sim.store, routing, clock });
  const session = () => ({ rows: sim.store.snapshot(), lesson: lessonRef.current, scenario: runRef.current, clock: clock.now().getTime(), lab: labRef.current });

  // The class the learner joined, if any (phase 8), and the trainer's page.
  const params = new URLSearchParams(window.location.search);
  const [member, setMember] = useState<Membership | undefined>(() => membership());
  const [classScenarios, setClassScenarios] = useState<string[]>([]);
  const [joining, setJoining] = useState<string | undefined>(() => params.get("class") ?? undefined);
  // The trainer's pages: ?trainer=home after signing in, or a trainer link ?trainer=CODE&key=KEY.
  const [trainer, setTrainer] = useState<TrainerOpen | undefined>(() => (params.get("trainer") === "home" ? "home" : params.get("trainer") && params.get("key") ? { code: params.get("trainer")!, key: params.get("key")! } : undefined));
  const [account, setAccount] = useState<Me | undefined>();
  useEffect(() => { void me().then(setAccount); }, []);
  const [allScenarios, setAllScenarios] = useState<Scenario[]>(READY_MADE);
  const [finishedIds, setFinishedIds] = useState<string[]>(() => finished());
  useEffect(() => { void aiScenarios().then((ai) => setAllScenarios([...READY_MADE, ...ai])); }, []);
  useEffect(() => {
    if (!member) return;
    // Joining again tells the class this learner is there (learners who joined before that was recorded, too),
    // and brings back their personal code and what they finished, in any browser.
    void import("../classroom/client").then(({ joinClass }) => joinClass(member.code, member.name)).then((c) => {
      setClassScenarios(c.scenarios);
      markFinished(...c.you.done);
      setFinishedIds(finished());
      if (c.you.rejoinCode !== member.rejoinCode) { const m = { ...member, rejoinCode: c.you.rejoinCode }; setMembership(m); setMember(m); }
    }).catch(() => undefined);
  }, [member?.code]);
  const [classOpen, setClassOpen] = useState(false);
  // A learner who just joined sees their personal code first.
  const [newMember, setNewMember] = useState<Membership | undefined>();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackInbox, setFeedbackInbox] = useState(false);
  // The learner's work on a class exercise or a class lab's hands-on part goes to the class a few seconds
  // after it changes, so another browser carries on from it (src/classroom/work.ts).
  const memberRef = useRef(member);
  memberRef.current = member;
  const classRef = useRef(classScenarios);
  classRef.current = classScenarios;
  const workTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What the learner is working on, as the class knows it: an exercise, or a lab's hands-on part.
  const workingOn = (): string | undefined => {
    const r = runRef.current, l = labRef.current;
    if (r) return r.scenario.id;
    const d = l?.part === "do" ? labById(l.labId) : undefined;
    return d && lessonRef.current.id === classId(d) ? classId(d) : undefined;
  };
  const syncWork = () => {
    const m = memberRef.current, id = workingOn();
    if (!m || !id || !classRef.current.includes(id) || !canPack()) return;
    clearTimeout(workTimer.current);
    workTimer.current = setTimeout(() => {
      void pack(session()).then((data) => saveWork(m.code, id, data)).catch(() => undefined);
    }, 3000);
  };
  // Progress goes to the class a moment after it changes, so a burst of changes is sent once.
  const progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What the learner is on now in each class item, and since when: the trainer sees who may be stuck.
  const onNow = useRef(new Map<string, { title: string; since: string }>());
  const currentFor = (id: string, title: string | undefined) => {
    if (!title) { onNow.current.delete(id); return undefined; }
    const was = onNow.current.get(id);
    if (was?.title === title) return was;
    const now = { title, since: new Date().toISOString() };
    onNow.current.set(id, now);
    return now;
  };
  // A timeline for the trainer's learner page: what happened, when. Kept with the exercise or lab (and its
  // saved session), at most the last 80 events. Not while a trainer looks at a learner's work.
  const viewingRef = useRef(false);
  const event = (what: string, kind: LabEvent["kind"]): LabEvent => ({ at: new Date().toISOString(), what, kind });
  const addEvent = (what: string, kind: LabEvent["kind"]) => {
    if (viewingRef.current) return;
    if (runRef.current) setRun((r) => r && { ...r, events: [...(r.events ?? []), event(what, kind)].slice(-80) });
    else if (labRef.current) setLab((l) => l && { ...l, events: [...(l.events ?? []), event(what, kind)].slice(-80) });
  };
  // "Waits in Billing", "Voicemail from Returns", "Not connected".
  const answerText = (a: Answer) => (a.outcome === "Agent" && a.queue ? `Waits in ${a.queue}` : a.queue ? `${a.outcome} from ${a.queue}` : String(a.outcome));
  // What an exercise sends besides its checks: predictions, questions asked, the timeline.
  const scenarioDetail = (r: ScenarioRun): Detail => ({
    calls: (r.scenario.questions ?? []).flatMap((q) => {
      const a = r.answers[q.id];
      return a ? [{ caller: q.caller, predicted: answerText(a.picked), actual: answerText(a.actual), right: a.correct }] : [];
    }),
    asked: (r.talk ?? []).map((t) => t.q),
    events: r.events
  });
  // The last checks an exercise reported, so a new answer or question can be sent with them.
  const lastChecks = useRef<{ id: string; checks: { title: string; passed: boolean }[]; done: boolean } | undefined>(undefined);
  const reportScenario = () => {
    const r = runRef.current, m = memberRef.current, last = lastChecks.current;
    if (!r || !m || !last || last.id !== r.scenario.id || viewingRef.current) return;
    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      const hints = Object.values(r.hints).reduce((a, b) => a + b, 0);
      const current = currentFor(r.scenario.id, last.done ? undefined : last.checks.find((c) => !c.passed)?.title);
      void reportProgress(m.code, { name: m.name, scenarioId: r.scenario.id, title: r.scenario.title, checks: last.checks, done: last.done, hints, current, detail: scenarioDetail(runRef.current ?? r) }).catch(() => undefined);
    }, 1500);
  };
  const onProgress = (checks: { title: string; passed: boolean }[], isDone: boolean) => {
    const r = runRef.current;
    if (!r || viewingRef.current) return;
    if (isDone) { markFinished(r.scenario.id); setFinishedIds(finished()); }
    lastChecks.current = { id: r.scenario.id, checks, done: isDone };
    reportScenario();
  };
  const tour = useTrainingTour((t) => open(t));
  useEffect(() => { if (tourAsked()) tour.start(); }, []);
  // A link can open a workspace directly: #admin, #diagram or #phone.
  const [tab, setTab] = useState<Workspace>(() => (["admin", "diagram", "phone", "agent"].find((t) => window.location.hash === `#${t}`) as Workspace) ?? (lab && lab.part !== "do" ? "lab" : "phone"));
  const [concept, setConcept] = useState<string | undefined>(() => (labDef && lab?.part === "learn" ? labDef.learn?.[lab.page]?.concepts?.[0] : undefined) ?? lesson.tasks[0].concept);
  const [done, setDone] = useState<Record<string, CheckResult>>({});
  const [message, setMessage] = useState(restored ? "Welcome back: your work was restored." : "");
  // The diagram reads the environment when it loads: reload it when it's shown after a change.
  const [diagramKey, setDiagramKey] = useState(0);
  const changedSinceDiagram = useRef(false);
  const upload = useRef<HTMLInputElement>(null);
  const [adminRequest, setAdminRequest] = useState<AdminRequest | undefined>(undefined);

  useEffect(() => {
    let save: ReturnType<typeof setTimeout> | undefined;
    let check: ReturnType<typeof setTimeout> | undefined;
    const evaluate = () => { if (!runRef.current) void runChecks(sim.store, lessonRef.current).then(setDone).catch(() => undefined); };
    evaluate();
    void saveSession(session());
    return sim.store.onChange(() => {
      changedSinceDiagram.current = true;
      // A trainer looking at a learner's work: nothing is saved, here or with the class.
      if (viewingRef.current) { clearTimeout(check); check = setTimeout(evaluate, 150); return; }
      clearTimeout(save);
      save = setTimeout(() => void saveSession(session()), 400);
      syncWork();
      clearTimeout(check);
      check = setTimeout(evaluate, 150);
    });
  }, [sim, lesson, run?.scenario.id]);
  // Where the learner is in a lab is saved too; a Learn page shows its first concept below.
  useEffect(() => {
    if (!viewingRef.current) void saveSession(session());
    const page = lab?.part === "learn" ? labDef?.learn?.[lab.page] : undefined;
    if (page?.concepts?.[0]) setConcept(page.concepts[0]);
  }, [lab]);
  // Answers and hints are saved as they come, and go to the class with the exercise's detail.
  useEffect(() => { if (run && !viewingRef.current) { void saveSession(session()); syncWork(); reportScenario(); } }, [run]);

  // Follow the lesson: when a task is done, show the next one's explanation.
  const current = lesson.tasks.find((t) => !done[t.id]?.passed);
  const inLabDo = !!labDef && lab?.part === "do" && !run && lesson.id === classId(labDef);
  // A lab's Do part is done when every task is.
  useEffect(() => {
    if (!inLabDo || !labDef || current || !Object.keys(done).length || viewingRef.current) return;
    if (!finished().includes(doDoneId(labDef))) { markFinished(doDoneId(labDef)); setFinishedIds(finished()); }
  }, [inLabDo, current?.id, done]);
  // In a lab's Do part: when each task was done, and a wrong answer, for the timeline.
  const wrongSeen = useRef(new Map<string, string>());
  useEffect(() => {
    if (!inLabDo || !lab || viewingRef.current) return;
    const passedAt = { ...(lab.passedAt ?? {}) };
    const fresh: LabEvent[] = [];
    for (const t of lesson.tasks) {
      const r = done[t.id];
      if (r?.passed && !passedAt[t.id]) { passedAt[t.id] = new Date().toISOString(); fresh.push(event(`Done: ${t.title}`, "done")); }
      if (!r?.passed && r?.note && t.check.type === "answer" && wrongSeen.current.get(t.id) !== r.note) {
        wrongSeen.current.set(t.id, r.note);
        fresh.push(event(`Not right yet: ${t.title} (${r.note})`, "wrong"));
      }
    }
    if (fresh.length) setLab({ ...lab, passedAt, events: [...(lab.events ?? []), ...fresh].slice(-80) });
  }, [done, inLabDo]);
  // A lab in the learner's class reports its progress like an exercise: Learn, then each task.
  useEffect(() => {
    if (!member || !labDef || !classScenarios.includes(classId(labDef)) || viewingRef.current) return;
    const learned = learnDone(labDef, finishedIds);
    const tasks = inLabDo ? lesson.tasks.map((t) => ({ title: t.title, passed: !!done[t.id]?.passed })) : [];
    const didAll = doDone(labDef, finishedIds);
    const isDone = learned && didAll;
    const pages = labDef.learn?.length ?? 0;
    const challenges = labDef.challenges ?? [];
    // Where they are: a Learn page or the quiz, a Do task, or the Challenge part.
    const nowOn = isDone && lab?.part !== "challenge" ? undefined
      : lab?.part === "learn" ? (lab.page >= pages ? "Learn: the quiz" : `Learn: ${labDef.learn?.[lab.page]?.title ?? ""}`)
      : lab?.part === "do" ? (tasks.find((t) => !t.passed)?.title ?? (didAll ? undefined : "Do"))
      : lab?.part === "challenge" ? "Challenge" : undefined;
    const parts = {
      learn: { read: learned ? pages : Math.min(pages, Math.max(lab?.seen ?? -1, lab?.part === "learn" ? lab.page : -1) + 1), pages, done: learned },
      // Outside the Do part the tasks aren't known here; done says enough then.
      do: { passed: tasks.filter((t) => t.passed).length, tasks: tasks.length, done: didAll },
      challenge: { done: challenges.filter((c) => finishedIds.includes(c)).length, of: challenges.length }
    };
    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      void reportProgress(member.code, {
        name: member.name, scenarioId: classId(labDef), title: `Lab ${labDef.number}: ${labDef.title}`, checks: [{ title: "Learn: pages and quiz", passed: learned }, ...tasks],
        done: isDone, hints: Object.values(lab?.hints ?? {}).reduce((a, b) => a + b, 0), parts, current: currentFor(classId(labDef), nowOn),
        detail: {
          quiz: (labDef.quiz ?? []).map((q) => ({
            question: q.question, answer: lab?.quiz[q.id] === undefined ? undefined : q.options[lab.quiz[q.id]],
            right: !!lab?.quizRight?.[q.id], tries: lab?.tries?.[q.id] ?? 0
          })),
          tasks: inLabDo ? lesson.tasks.map((t) => ({
            title: t.title, passed: !!done[t.id]?.passed, at: lab?.passedAt?.[t.id], hints: lab?.hints?.[t.id] ?? 0,
            answer: t.check.type === "answer" ? recorded(sim.store, `answer:${t.check.key}`) : undefined, note: done[t.id]?.note
          })) : undefined,
          events: lab?.events
        }
      }).catch(() => undefined);
    }, 1500);
  }, [labDef?.id, finishedIds, done, inLabDo, lab?.part, lab?.page, lab?.events?.length]);
  // The quiz was checked: a try for each question not right before, and which are right now.
  const quizChecked = () => {
    const l = labRef.current, d = l && labById(l.labId);
    if (!l || !d) return;
    const tries = { ...(l.tries ?? {}) }, quizRight = { ...(l.quizRight ?? {}) };
    for (const q of d.quiz ?? []) {
      if (!quizRight[q.id]) tries[q.id] = (tries[q.id] ?? 0) + 1;
      quizRight[q.id] = l.quiz[q.id] === q.answer;
    }
    const right = (d.quiz ?? []).filter((q) => quizRight[q.id]).length;
    setLab({ ...l, tries, quizRight, events: [...(l.events ?? []), event(`Quiz: ${right} of ${d.quiz?.length ?? 0} right`, "quiz")].slice(-80) });
  };
  // A hint in a lab's Do part.
  const taskHint = (t: Task) => {
    const l = labRef.current;
    if (!l || viewingRef.current) return;
    setLab({ ...l, hints: { ...(l.hints ?? {}), [t.id]: (l.hints?.[t.id] ?? 0) + 1 }, events: [...(l.events ?? []), event(`Hint: ${t.title}`, "hint")].slice(-80) });
  };
  // The furthest Learn page the learner has opened, for the trainer's "3 of 5 pages", and the timeline.
  useEffect(() => {
    if (!lab || !labDef || viewingRef.current || lab.part !== "learn" || lab.page <= (lab.seen ?? -1)) return;
    const pages = labDef.learn ?? [];
    const what = lab.page >= pages.length ? "Opened the quiz" : `Read: ${pages[lab.page].title}`;
    setLab({ ...lab, seen: lab.page, events: [...(lab.events ?? []), event(what, "read")].slice(-80) });
  }, [lab?.part, lab?.page]);
  useEffect(() => { if (current && !run) setConcept(current.concept); }, [current?.id, run]);

  useEffect(() => {
    // The Diagram's "Open record": explain the shape, and for a queue or workstream show where it's configured.
    const onNavigate = (e: Event) => {
      const n = (e as CustomEvent<Navigate>).detail;
      const link = typeof n.target === "string" ? recordLink(n.target) : undefined;
      const concept = link && conceptForRecord(sim.store, link);
      if (!link || !concept) { setMessage("That link opens a page that isn't part of the training yet."); return; }
      setConcept(concept);
      if (link.table === "queue" || link.table === "msdyn_liveworkstream") {
        setAdminRequest({ page: link.table === "queue" ? "queue" : "workstream", id: link.id, at: Date.now() });
        setTab("admin");
        setMessage("This is where it's configured. The explanation is below.");
      } else {
        setMessage("The explanation of this shape is below.");
      }
    };
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate);
  }, []);

  const open = (next: Workspace) => {
    if (next === "diagram" && changedSinceDiagram.current) { setDiagramKey((k) => k + 1); changedSinceDiagram.current = false; }
    // A lab's task can ask the learner to look at something: "seen:diagram".
    if (labRef.current?.part === "do" && !runRef.current && next !== "lab") record(sim.store, `seen:${next}`);
    setTab(next);
  };

  // What the learner is doing, for feedback: shown in the form before it's sent.
  const feedbackContext = (): Record<string, string> => {
    const c: Record<string, string> = {};
    if (run) c.Exercise = run.scenario.title;
    else if (labDef && lab) {
      c.Lab = `${labDef.number}: ${labDef.title}`;
      const pages = labDef.learn ?? [];
      c.Part = lab.part === "learn" ? (lab.page >= pages.length ? "Learn, the quiz" : `Learn, page ${lab.page + 1}: ${pages[lab.page].title}`)
        : lab.part === "do" ? (current ? `Do, task: ${current.title}` : "Do, all tasks done") : "Challenge";
    } else {
      c.Lesson = lesson.title;
      if (current) c.Task = current.title;
    }
    c.Tab = ({ lab: "Lab", admin: "Admin center", diagram: "Diagram", phone: "Phone", agent: "Agent" } as Record<string, string>)[tab] ?? tab;
    if (member) c.Class = member.code;
    c.Browser = browserName(navigator.userAgent);
    c.Screen = `${window.innerWidth} × ${window.innerHeight}`;
    return c;
  };

  // ---- labs ----
  // A trainer looks at a learner's saved work: it's loaded here, nothing is saved or sent while it's on
  // screen, and Back puts the trainer's own session back and reopens the class.
  const [viewing, setViewing] = useState<{ who: string; what: string; before: Session; back(): void; backLabel: string; lead: string }>();
  const viewWork = async (who: string, what: string, data: string, back: () => void, backLabel = "Back to the class", lead = `${who}'s work on ${what}, as they left it`) => {
    const saved = await unpack<Session>(data);
    const before = session();
    viewingRef.current = true;
    clearTimeout(workTimer.current);
    clearTimeout(progressTimer.current);
    sim.store.load(saved.rows);
    routing.signInAs(undefined);
    setRun(saved.scenario as ScenarioRun | undefined);
    if (saved.lesson) setLesson(saved.lesson as Lesson);
    setLab(saved.lab as LabState | undefined);
    clock.set(typeof saved.clock === "number" ? saved.clock : START);
    setDone({});
    setDiagramKey((k) => k + 1);
    setTrainer(undefined);
    setFeedbackInbox(false);
    setViewing({ who, what, before, back, backLabel, lead });
    setTab(saved.scenario ? "admin" : "lab");
    setMessage("");
  };
  const stopViewing = () => {
    const v = viewing;
    if (!v) return;
    sim.store.load(v.before.rows);
    routing.signInAs(undefined);
    setRun(v.before.scenario as ScenarioRun | undefined);
    if (v.before.lesson) setLesson(v.before.lesson as Lesson);
    setLab(v.before.lab as LabState | undefined);
    clock.set(typeof v.before.clock === "number" ? v.before.clock : START);
    setDone({});
    setDiagramKey((k) => k + 1);
    viewingRef.current = false;
    setViewing(undefined);
    v.back();
  };

  const openLab = (id: string) => {
    setPicking(false);
    setRun(undefined);
    const same = labRef.current?.labId === id;
    setLab({ labId: id, part: "learn", page: 0, quiz: same ? labRef.current!.quiz : {} });
    setTab("lab");
    setMessage("");
  };
  // The Do part starts in a fresh environment, with the lab's tasks filled in from it. A class lab carries on
  // from the learner's saved work instead, from whichever browser they used last (unless they start again).
  const startLabDo = async (fresh = true) => {
    const l = labRef.current && labById(labRef.current.labId);
    if (!l) return;
    const m = memberRef.current;
    if (!fresh && m && classRef.current.includes(classId(l)) && canPack()) {
      try {
        const { work } = await loadWork(m.code, classId(l));
        const saved = work ? await unpack<Session>(work.data) : undefined;
        const savedLesson = saved?.lesson as Lesson | undefined;
        if (work && saved?.rows && savedLesson?.id === classId(l)) {
          clearTimeout(workTimer.current);
          sim.store.load(saved.rows);
          routing.signInAs(undefined);
          setRun(undefined);
          setLesson(savedLesson);
          setDone({});
          setLab({ ...labRef.current!, part: "do" });
          clock.set(typeof saved.clock === "number" ? saved.clock : START);
          setTab(savedLesson.tasks[0].tab);
          setDiagramKey((k) => k + 1);
          setMessage(`Carrying on with lab ${l.number} where you left off (saved ${new Date(work.savedOn).toLocaleString()}). Start again undoes it.`);
          return;
        }
      } catch {
        // The class can't be reached: start fresh here.
      }
    }
    void clearSession();
    sim.store.load(trainingSeed());
    clock.set(START);
    routing.signInAs(undefined);
    setRun(undefined);
    const next = labLesson(l, sim.store, newSeed());
    setLesson(next);
    setDone({});
    setLab({ ...labRef.current!, part: "do" });
    setConcept(next.tasks[0].concept);
    setTab(next.tasks[0].tab);
    setDiagramKey((k) => k + 1);
    setMessage(`Lab ${l.number}, hands-on: the environment is fresh for it.`);
  };
  const goPart = (part: LabPart) => {
    const l = labRef.current;
    if (!l || !labDef) return;
    if (part === "do") {
      if (runRef.current || lessonRef.current.id !== classId(labDef)) void startLabDo(false);
      else { setLab({ ...l, part }); setTab(lessonRef.current.tasks.find((t) => !done[t.id]?.passed)?.tab ?? "phone"); }
      return;
    }
    setRun(undefined);
    setLab({ ...l, part });
    setTab("lab");
  };

  // A class exercise carries on from the learner's saved work, from whichever browser they used last.
  const openScenario = async (scenario: Scenario) => {
    const m = memberRef.current;
    if (m && classRef.current.includes(scenario.id) && canPack()) {
      setPicking(false);
      try {
        const { work } = await loadWork(m.code, scenario.id);
        if (work) {
          const saved = await unpack<Session>(work.data);
          const r = saved.scenario as ScenarioRun | undefined;
          if (saved.rows && r?.scenario?.id === scenario.id) {
            clearTimeout(workTimer.current);
            sim.store.load(saved.rows);
            setRun({ scenario, answers: r.answers ?? {}, hints: r.hints ?? {}, found: r.found, talk: r.talk });
            setConcept(scenario.kind === "fix" ? "queue" : "route-to-queue");
            setTab(scenario.kind === "fix" ? "diagram" : "admin");
            clock.set(typeof saved.clock === "number" ? saved.clock : START);
            setDiagramKey((k) => k + 1);
            setMessage(`Carrying on with “${scenario.title}” where you left off (saved ${new Date(work.savedOn).toLocaleString()}). Start again undoes it.`);
            return;
          }
        }
      } catch {
        // The class can't be reached: start the exercise here.
      }
    }
    startScenario(scenario);
  };

  // A scenario starts in its own environment: the healthy one with its faults planted (src/scenarios/world.ts).
  const startScenario = (scenario: Scenario) => {
    setPicking(false);
    void clearSession();
    sim.store.load(scenarioRows(scenario));
    setRun({ scenario, answers: {}, hints: {} });
    setConcept(scenario.kind === "fix" ? "queue" : "route-to-queue");
    setTab(scenario.kind === "fix" ? "diagram" : "admin");
    // A clean start for the clock and the routing too: the clock goes back to Tuesday 10:00.
    clock.set(START);
    setDiagramKey((k) => k + 1);
    setMessage(`Started “${scenario.title}”. The environment is set up for it.`);
  };

  const startLesson = () => {
    setPicking(false);
    setLab(undefined);
    void clearSession();
    sim.store.load(trainingSeed());
    setRun(undefined);
    const next = makeLesson(template, sim.store, newSeed());
    setLesson(next);
    setDone({});
    setConcept(next.tasks[0].concept);
    setTab("phone");
    setDiagramKey((k) => k + 1);
    setMessage(`The guided lesson, with ${next.variant?.choice} on the ${next.variant?.workstream} line.`);
  };

  const restart = () => {
    if (lab?.part === "do" && !run) {
      if (window.confirm("Start this lab's hands-on part again? Everything you changed is undone.")) void startLabDo(true);
      return;
    }
    if (lab && !run) { setMessage("Nothing to undo here: the Learn and Challenge parts don't change the environment."); return; }
    if (run) {
      if (window.confirm("Start this exercise again? Everything you changed and answered is undone.")) startScenario(run.scenario);
      return;
    }
    if (!window.confirm("Start again with a new variant of the lesson? Everything you changed in the environment is undone.")) return;
    void clearSession();
    sim.store.load(trainingSeed());
    const next = makeLesson(template, sim.store, newSeed());
    setLesson(next);
    setDone({});
    setConcept(next.tasks[0].concept);
    setMessage(`A new variant: ${next.variant?.choice} on the ${next.variant?.workstream} line.`);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({ ...sim.store.toFile(), lesson, scenario: run }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ccaas-training-${run?.scenario.id ?? lesson.id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      sim.store.load(Store.readFile(json));
      if (json.lesson?.tasks) setLesson(json.lesson as Lesson);
      setRun(json.scenario?.scenario ? json.scenario as ScenarioRun : undefined);
      setMessage(`Loaded “${file.name}”.`);
    } catch (e) {
      setMessage(`Couldn't load “${file.name}”: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (upload.current) upload.current.value = "";
  };

  return (
    <TrainingContext.Provider value={{ sim, clock, routing, explain: setConcept }}>
      {/* Fluent copies the provider's classes onto its pop-up containers, so the layout class sits on a div inside. */}
      <FluentProvider theme={webLightTheme} style={{ height: "100%" }}>
      <div className="training">
        <header className="training-header">
          <div className="training-brand"><strong>Promethean CCaaS Training</strong><span>Dynamics 365 Contact Center, hands-on</span></div>
          <div className="training-env">
            <span className="training-sim" title="Everything here is simulated: no Dynamics 365 environment, no real phone numbers.">Simulated environment · {sim.api.clientUrl.replace(/^https:\/\//, "")}</span>
            <button className="training-choose" onClick={() => setPicking(true)}>Labs and practice</button>
            {member
              ? <button className="training-class" title="Your class: your personal code, and leaving" onClick={() => setClassOpen(true)}>Class {member.code} · {member.name}</button>
              : <button onClick={() => setJoining("")}>Join a class</button>}
            {/* Files on the learner's own computer, separate from the class (which saves by itself). Start again
                last, as it undoes changes. */}
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <button className="training-files" aria-haspopup="menu" title="Save your work to a file on this computer, or open one. Separate from your class.">Files ▾</button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={download}>Save to a file</MenuItem>
                  <MenuItem onClick={() => upload.current?.click()}>Open a saved file</MenuItem>
                  <MenuItem onClick={() => setExporting(true)} title="Download what you built as the Toolbox's CSV templates">Export for the Toolbox</MenuItem>
                  <MenuDivider />
                  <MenuItem onClick={restart}>Start again</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <input ref={upload} type="file" accept="application/json,.json" hidden onChange={(e) => void onUpload(e.target.files?.[0])} />
            <button onClick={() => tour.start()}>Tour</button>
            <button onClick={() => setFeedbackOpen(true)} title="Tell us what works, what doesn't, and what you'd like">Feedback</button>
            {account?.admin && <button className="training-trainer" title="Feedback from everyone using the training" onClick={() => setFeedbackInbox(true)}>Feedback inbox</button>}
            {account?.signedIn
              ? <button className="training-trainer" title={account.trainer ? "Your classes" : "Signed in: sign out here"} onClick={() => setTrainer("home")}>{account.trainer ? "Trainer" : account.admin ? "Admin" : "Signed in"} · {account.name}</button>
              : <button className="training-trainer" title="For trainers and admins: sign in with your Microsoft account" onClick={signIn}>Sign in</button>}
          </div>
        </header>
        {exporting && <ExportDialog store={sim.store} start={new Store(run ? scenarioRows(run.scenario) : trainingSeed())} onClose={() => setExporting(false)} />}
        {message && <div className="training-message" role="status">{message}<button aria-label="Close" onClick={() => setMessage("")}>×</button></div>}
        <div className="training-body">
          {run
            ? <div className="lab-scenario">
              {labDef && <button className="lab-back" onClick={() => goPart("challenge")}>← Back to lab {labDef.number}: {labDef.title}</button>}
              <ScenarioPanel key={run.scenario.id} scenario={run.scenario} answers={run.answers} hints={run.hints} onGo={open}
                onAnswer={(id, a) => {
                  const q = run.scenario.questions?.find((x) => x.id === id);
                  setRun((r) => r && { ...r, answers: { ...r.answers, [id]: a } });
                  addEvent(`${q?.caller ?? "A caller"}: predicted ${answerText(a.picked)} (${a.correct ? "right" : `wrong: ${answerText(a.actual)}`})`, a.correct ? "answer" : "wrong");
                }}
                onHint={(id) => { setRun((r) => r && { ...r, hints: { ...r.hints, [id]: (r.hints[id] ?? 0) + 1 } }); addEvent("Used a hint", "hint"); }}
                found={run.found ?? []} talk={run.talk ?? []}
                onTalk={(t, revealed) => { setRun((r) => r && { ...r, talk: [...(r.talk ?? []), t], found: [...new Set([...(r.found ?? []), ...revealed])].sort() }); addEvent(`Asked: ${t.q}`, "ask"); }}
                onProgress={onProgress} />
              </div>
            : labDef && lab
              ? inLabDo
                ? <LessonPanel key={lesson.variant?.seed ?? lesson.id} lesson={lesson} done={done} onGo={open} onExplain={setConcept} onHint={taskHint}
                    header={<LabHeader lab={labDef} state={lab} finishedIds={finishedIds} go={goPart} onAll={() => setPicking(true)} />} />
                : <LabPanel lab={labDef} state={lab} setState={(x) => { setLab(x); setTab("lab"); }} finishedIds={finishedIds} go={goPart} onAll={() => setPicking(true)} />
              : <LessonPanel key={lesson.variant?.seed} lesson={lesson} done={done} onGo={open} onExplain={setConcept} />}
          <main className="workspace">
            <TabList selectedValue={tab} onTabSelect={(_, d) => open(d.value as Workspace)} className="workspace-tabs">
              {labDef && <Tab value="lab">Lab</Tab>}
              <Tab value="admin">Admin center</Tab>
              <Tab value="diagram">Diagram</Tab>
              <Tab value="phone">Phone</Tab>
              <Tab value="agent">Agent</Tab>
            </TabList>
            {/* The contact center's time matters where calls happen: on the Phone, Agent and Diagram tabs. */}
            {(tab === "phone" || tab === "agent" || tab === "diagram") && (
              <div className="clock-strip" role="group" aria-label="Contact center time">
                <span className="clock-strip-label">Contact center time</span>
                <ClockBar />
                <span className="clock-strip-note">Operating hours, waiting times and the representatives' calls follow this clock.</span>
              </div>
            )}
            <div className="workspace-view">
              {labDef && lab && <div hidden={tab !== "lab"} className="workspace-pane">
                <LabView lab={labDef} state={lab} setState={setLab} scenarios={allScenarios} finishedIds={finishedIds} onStartDo={() => void startLabDo(false)}
                  onScenario={(x) => void openScenario(x)} onLearnDone={() => { if (viewingRef.current) return; markFinished(learnDoneId(labDef)); setFinishedIds(finished()); }} onQuizChecked={quizChecked} />
              </div>}
              <div hidden={tab !== "admin"} className="workspace-pane"><AdminCenter request={adminRequest} /></div>
              <div hidden={tab !== "phone"} className="workspace-pane">{/* The lesson's line (with its new menu choice) only while doing that lesson; otherwise the real menus. */}<Phone key={run?.scenario.id ?? (labDef && !inLabDo ? `learn-${labDef.id}` : lesson.variant?.seed ?? lesson.id)} line={run || (labDef && !inLabDo) ? undefined : lesson.line} /></div>
              <div hidden={tab !== "agent"} className="workspace-pane"><AgentView /></div>
              <div hidden={tab !== "diagram"} className="workspace-pane">
                <iframe key={diagramKey} className="workspace-diagram" title="Environment Diagram" src="tools/diagram2d/" />
              </div>
            </div>
          </main>
        </div>
        <LearnStrip conceptId={concept} />
        <ExercisePicker open={picking} current={run?.scenario.id ?? (labDef ? classId(labDef) : "lesson")} onClose={() => setPicking(false)} onLesson={startLesson} onScenario={(s) => { setLab(undefined); void openScenario(s); }} onLab={openLab}
          classInfo={member ? { name: member.className, scenarios: classScenarios } : undefined} finishedIds={finishedIds} onTrainer={() => { setPicking(false); setTrainer("home"); }} />
        {joining !== undefined && <JoinDialog initialCode={joining} onClose={() => setJoining(undefined)}
          onJoined={(m, list, rejoined) => {
            setMember(m); setClassScenarios(list); setFinishedIds(finished()); setJoining(undefined);
            if (rejoined) { setPicking(true); setMessage(`Welcome back to ${m.className}, ${m.name}. Open a class lab or exercise to carry on where you left off.`); }
            else { setNewMember(m); setMessage(`You joined ${m.className}. Your class's labs and exercises are at the top of Labs and practice.`); }
          }} />}
        {newMember && <PersonalCodeDialog member={newMember} onDone={() => { setNewMember(undefined); setPicking(true); }} />}
        {feedbackOpen && <FeedbackDialog context={feedbackContext()} environment={canPack() ? () => pack(session()) : undefined} onClose={() => setFeedbackOpen(false)} />}
        {feedbackInbox && <FeedbackInbox onClose={() => setFeedbackInbox(false)}
          onOpenEnvironment={(item, data) => void viewWork("", "", data, () => setFeedbackInbox(true), "Back to the feedback", `the environment ${item.name ?? "someone"} sent with their feedback`)} />}
        {classOpen && member && <ClassDialog member={member} onClose={() => setClassOpen(false)}
          onLeave={() => { setMembership(undefined); setMember(undefined); setClassScenarios([]); setClassOpen(false); }} />}
        {trainer && <TrainerView all={allScenarios} initial={trainer} onClose={() => setTrainer(undefined)} onViewWork={(who, what, data, back) => void viewWork(who, what, data, () => setTrainer(back))} />}
        {viewing && (
          <div className="viewing-bar" role="status">
            <span><strong>Looking at {viewing.lead}.</strong> Read-only: nothing you change here is saved.</span>
            <button onClick={stopViewing}>{viewing.backLabel}</button>
          </div>
        )}
        <TourCard tour={tour} />
        {/* The welcome is for learners. Not for someone who came with a class link (they go straight to the
            code box), nor for trainers: not on the trainer pages, not for a signed-in trainer. It waits until
            the sign-in check is done, so a trainer doesn't see it flash by. */}
        {!params.get("class") && !params.get("trainer") && !trainer && account && !account.trainer && <Welcome tour={tour} restored={restored} current={run ? run.scenario.title : labDef ? `Lab ${labDef.number}: ${labDef.title}` : lesson.title}
          member={member ? { className: member.className, name: member.name, rejoinCode: member.rejoinCode } : undefined}
          onJoin={() => setJoining("")}
          onClass={() => { const id = workingOn() ?? (labDef ? classId(labDef) : undefined); if (!id || !classScenarios.includes(id)) setPicking(true); }}
          onOwn={(carryOn) => { if (!carryOn) setPicking(true); }} />}
      </div>
      </FluentProvider>
    </TrainingContext.Provider>
  );
}
