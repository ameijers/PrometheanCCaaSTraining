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
import { CheckResult, Lesson, record, runChecks, Task } from "../lessons/checks";
import { classId, doDone, doDoneId, LABS, labById, labLesson, LabPart, LabState, learnDone, learnDoneId } from "../labs/labs";
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
import { ClassDialog, JoinDialog, TrainerOpen, TrainerView } from "../classroom/Classroom";
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

const template = templateJson as LessonTemplate;
type Workspace = Task["tab"] | "lab";

// The training screen: the lesson on the left, where the learner works in the middle (the simulated
// admin center, the Environment Diagram, the phone), and the explanation from Microsoft Learn below.
// What the learner is doing: the guided lesson, or a scenario (manual 9.1) with their answers so far.
export interface ScenarioRun { scenario: Scenario; answers: Record<string, CallAnswer>; hints: Record<string, number>; found?: number[]; talk?: Talk[] }

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
  const onProgress = (checks: { title: string; passed: boolean }[], isDone: boolean) => {
    const r = runRef.current;
    if (!r) return;
    if (isDone) { markFinished(r.scenario.id); setFinishedIds(finished()); }
    if (!member) return;
    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      const hints = Object.values(r.hints).reduce((a, b) => a + b, 0);
      void reportProgress(member.code, { name: member.name, scenarioId: r.scenario.id, title: r.scenario.title, checks, done: isDone, hints }).catch(() => undefined);
    }, 1500);
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
      clearTimeout(save);
      save = setTimeout(() => void saveSession(session()), 400);
      syncWork();
      clearTimeout(check);
      check = setTimeout(evaluate, 150);
    });
  }, [sim, lesson, run?.scenario.id]);
  // Where the learner is in a lab is saved too; a Learn page shows its first concept below.
  useEffect(() => {
    void saveSession(session());
    const page = lab?.part === "learn" ? labDef?.learn?.[lab.page] : undefined;
    if (page?.concepts?.[0]) setConcept(page.concepts[0]);
  }, [lab]);
  // Answers and hints are saved as they come.
  useEffect(() => { if (run) { void saveSession(session()); syncWork(); } }, [run]);

  // Follow the lesson: when a task is done, show the next one's explanation.
  const current = lesson.tasks.find((t) => !done[t.id]?.passed);
  const inLabDo = !!labDef && lab?.part === "do" && !run && lesson.id === classId(labDef);
  // A lab's Do part is done when every task is.
  useEffect(() => {
    if (!inLabDo || !labDef || current || !Object.keys(done).length) return;
    if (!finished().includes(doDoneId(labDef))) { markFinished(doDoneId(labDef)); setFinishedIds(finished()); }
  }, [inLabDo, current?.id, done]);
  // A lab in the learner's class reports its progress like an exercise: Learn, then each task.
  useEffect(() => {
    if (!member || !labDef || !classScenarios.includes(classId(labDef))) return;
    const learned = learnDone(labDef, finishedIds);
    const tasks = inLabDo ? lesson.tasks.map((t) => ({ title: t.title, passed: !!done[t.id]?.passed })) : [];
    const isDone = learned && doDone(labDef, finishedIds);
    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      void reportProgress(member.code, { name: member.name, scenarioId: classId(labDef), title: `Lab ${labDef.number}: ${labDef.title}`, checks: [{ title: "Learn: pages and quiz", passed: learned }, ...tasks], done: isDone, hints: 0 }).catch(() => undefined);
    }, 1500);
  }, [labDef?.id, finishedIds, done, inLabDo]);
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

  // ---- labs ----
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
            {account?.signedIn
              ? <button className="training-trainer" title="Your classes" onClick={() => setTrainer("home")}>{account.trainer ? "Trainer" : "Signed in"} · {account.name}</button>
              : <button className="training-trainer" title="For trainers: sign in to manage your classes" onClick={signIn}>Trainer sign-in</button>}
            <button onClick={() => tour.start()}>Tour</button>
            {/* Everything about the learner's own work, in one menu; Start again last, as it undoes changes. */}
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <button className="training-mywork" aria-haspopup="menu">My work ▾</button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={download}>Save my work</MenuItem>
                  <MenuItem onClick={() => upload.current?.click()}>Open saved work</MenuItem>
                  <MenuItem onClick={() => setExporting(true)} title="Export for the Toolbox: download what you built as the Toolbox's CSV templates">Export</MenuItem>
                  <MenuDivider />
                  <MenuItem onClick={restart}>Start again</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            <input ref={upload} type="file" accept="application/json,.json" hidden onChange={(e) => void onUpload(e.target.files?.[0])} />
          </div>
        </header>
        {exporting && <ExportDialog store={sim.store} start={new Store(run ? scenarioRows(run.scenario) : trainingSeed())} onClose={() => setExporting(false)} />}
        {message && <div className="training-message" role="status">{message}<button aria-label="Close" onClick={() => setMessage("")}>×</button></div>}
        <div className="training-body">
          {run
            ? <div className="lab-scenario">
              {labDef && <button className="lab-back" onClick={() => goPart("challenge")}>← Back to lab {labDef.number}: {labDef.title}</button>}
              <ScenarioPanel key={run.scenario.id} scenario={run.scenario} answers={run.answers} hints={run.hints} onGo={open}
                onAnswer={(id, a) => setRun((r) => r && { ...r, answers: { ...r.answers, [id]: a } })}
                onHint={(id) => setRun((r) => r && { ...r, hints: { ...r.hints, [id]: (r.hints[id] ?? 0) + 1 } })}
                found={run.found ?? []} talk={run.talk ?? []}
                onTalk={(t, revealed) => setRun((r) => r && { ...r, talk: [...(r.talk ?? []), t], found: [...new Set([...(r.found ?? []), ...revealed])].sort() })}
                onProgress={onProgress} />
              </div>
            : labDef && lab
              ? inLabDo
                ? <LessonPanel key={lesson.variant?.seed ?? lesson.id} lesson={lesson} done={done} onGo={open} onExplain={setConcept}
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
                  onScenario={(x) => void openScenario(x)} onLearnDone={() => { markFinished(learnDoneId(labDef)); setFinishedIds(finished()); }} />
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
            setMember(m); setClassScenarios(list); setFinishedIds(finished()); setJoining(undefined); setPicking(true);
            setMessage(rejoined
              ? `Welcome back to ${m.className}, ${m.name}. Open a class exercise to carry on where you left off.`
              : `You joined ${m.className}. Your personal code is ${m.rejoinCode}: with it you carry on in another browser (it's under Class in the header). Your exercises are at the top of Choose an exercise.`);
          }} />}
        {classOpen && member && <ClassDialog member={member} onClose={() => setClassOpen(false)}
          onLeave={() => { setMembership(undefined); setMember(undefined); setClassScenarios([]); setClassOpen(false); }} />}
        {trainer && <TrainerView all={allScenarios} initial={trainer} onClose={() => setTrainer(undefined)} />}
        <TourCard tour={tour} />
        {/* Someone who came with a class link goes straight to the code box instead. */}
        {!params.get("class") && <Welcome tour={tour} restored={restored} current={run ? run.scenario.title : labDef ? `Lab ${labDef.number}: ${labDef.title}` : lesson.title}
          member={member ? { className: member.className, name: member.name } : undefined}
          onJoin={() => setJoining("")}
          onClass={() => { const id = workingOn() ?? (labDef ? classId(labDef) : undefined); if (!id || !classScenarios.includes(id)) setPicking(true); }}
          onOwn={(carryOn) => { if (!carryOn) setPicking(true); }} />}
      </div>
      </FluentProvider>
    </TrainingContext.Provider>
  );
}
