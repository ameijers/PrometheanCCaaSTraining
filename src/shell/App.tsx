// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";
import { FluentProvider, Tab, TabList, webLightTheme } from "@fluentui/react-components";
import { AdminCenter, AdminRequest } from "../admin/AdminCenter";
import { conceptForRecord, recordLink } from "../learn/records";
import { Navigate } from "../simulator/xrmShim";
import { Phone } from "../calls/Phone";
import { AgentView } from "../calls/AgentView";
import { ClockBar } from "../calls/ClockBar";
import { Clock, START } from "../calls/clock";
import { Routing } from "../calls/routing";
import { LearnStrip } from "../learn/LearnStrip";
import { CheckResult, Lesson, runChecks, Task } from "../lessons/checks";
import { LessonPanel } from "../lessons/LessonPanel";
import { Simulator } from "../simulator";
import { clearSession, saveSession } from "../simulator/persist";
import { trainingSeed } from "../simulator/seeds/training";
import { Store } from "../simulator/store";
import { LessonTemplate, makeLesson, newSeed } from "../lessons/template";
import templateJson from "../../content/lessons/new-menu-choice.json";
import { ExercisePicker, READY_MADE } from "../scenarios/ExercisePicker";
import { JoinDialog, TrainerView } from "../classroom/Classroom";
import { reportProgress } from "../classroom/client";
import { finished, markFinished, Membership, membership, setMembership } from "../classroom/identity";
import { aiScenarios } from "../scenarios/client";
import { tourAsked } from "@toolbox/environment-3d-explorer/src/tour";
import { TourBar, useTrainingTour } from "./Tour";
import { CallAnswer, ScenarioPanel } from "../scenarios/ScenarioPanel";
import { Talk } from "../scenarios/BuildExercise";
import { Scenario } from "../scenarios/scenario";
import { scenarioRows } from "../scenarios/world";
import { TrainingContext } from "./context";
import { ExportDialog } from "../export/ExportDialog";

export const NAVIGATE_EVENT = "ccaas-navigate";

const template = templateJson as LessonTemplate;
type Workspace = Task["tab"] | "agent";

// The training screen: the lesson on the left, where the learner works in the middle (the simulated
// admin center, the Environment Diagram, the phone), and the explanation from Microsoft Learn below.
// What the learner is doing: the guided lesson, or a scenario (manual 9.1) with their answers so far.
export interface ScenarioRun { scenario: Scenario; answers: Record<string, CallAnswer>; hints: Record<string, number>; found?: number[]; talk?: Talk[] }

export function App({ sim, restored, savedLesson, savedScenario, savedClock, seed }: { sim: Simulator; restored: boolean; savedLesson?: Lesson; savedScenario?: ScenarioRun; savedClock?: number; seed?: number }) {
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
  const session = () => ({ rows: sim.store.snapshot(), lesson: lessonRef.current, scenario: runRef.current, clock: clock.now().getTime() });

  // The class the learner joined, if any (phase 8), and the trainer's page.
  const params = new URLSearchParams(window.location.search);
  const [member, setMember] = useState<Membership | undefined>(() => membership());
  const [classScenarios, setClassScenarios] = useState<string[]>([]);
  const [joining, setJoining] = useState<string | undefined>(() => params.get("class") ?? undefined);
  const [trainer, setTrainer] = useState<{ code: string; key: string } | "new" | undefined>(() => (params.get("trainer") && params.get("key") ? { code: params.get("trainer")!, key: params.get("key")! } : undefined));
  const [allScenarios, setAllScenarios] = useState<Scenario[]>(READY_MADE);
  const [finishedIds, setFinishedIds] = useState<string[]>(() => finished());
  useEffect(() => { void aiScenarios().then((ai) => setAllScenarios([...READY_MADE, ...ai])); }, []);
  useEffect(() => {
    if (!member) return;
    void import("../classroom/client").then(({ getClass }) => getClass(member.code)).then((c) => setClassScenarios(c.scenarios)).catch(() => undefined);
  }, [member?.code]);
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
  const [tab, setTab] = useState<Workspace>(() => (["admin", "diagram", "phone", "agent"].find((t) => window.location.hash === `#${t}`) as Workspace) ?? "phone");
  const [concept, setConcept] = useState<string | undefined>(lesson.tasks[0].concept);
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
      clearTimeout(check);
      check = setTimeout(evaluate, 150);
    });
  }, [sim, lesson, run?.scenario.id]);
  // Answers and hints are saved as they come.
  useEffect(() => { if (run) void saveSession(session()); }, [run]);

  // Follow the lesson: when a task is done, show the next one's explanation.
  const current = lesson.tasks.find((t) => !done[t.id]?.passed);
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
    setTab(next);
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
            <ClockBar />
            <span className="training-sim" title="Everything here is simulated: no Dynamics 365 environment, no real phone numbers.">Simulated environment · {sim.api.clientUrl.replace(/^https:\/\//, "")}</span>
            <button className="training-choose" onClick={() => setPicking(true)}>Choose an exercise</button>
            {member
              ? <button className="training-class" title="Leave the class" onClick={() => { if (window.confirm(`Leave the class ${member.className}? Your work here stays.`)) { setMembership(undefined); setMember(undefined); setClassScenarios([]); } }}>Class {member.code} · {member.name}</button>
              : <button onClick={() => setJoining("")}>Join a class</button>}
            <button onClick={() => tour.start()}>Tour</button>
            <button onClick={restart}>Start again</button>
            <button onClick={download}>Save my work</button>
            <button onClick={() => upload.current?.click()}>Open saved work</button>
            <button onClick={() => setExporting(true)} title="Export for the Toolbox: download what you built as the Toolbox's CSV templates">Export</button>
            <input ref={upload} type="file" accept="application/json,.json" hidden onChange={(e) => void onUpload(e.target.files?.[0])} />
          </div>
        </header>
        {exporting && <ExportDialog store={sim.store} start={new Store(run ? scenarioRows(run.scenario) : trainingSeed())} onClose={() => setExporting(false)} />}
        {message && <div className="training-message" role="status">{message}<button aria-label="Close" onClick={() => setMessage("")}>×</button></div>}
        <div className="training-body">
          {run
            ? <ScenarioPanel key={run.scenario.id} scenario={run.scenario} answers={run.answers} hints={run.hints} onGo={open}
                onAnswer={(id, a) => setRun((r) => r && { ...r, answers: { ...r.answers, [id]: a } })}
                onHint={(id) => setRun((r) => r && { ...r, hints: { ...r.hints, [id]: (r.hints[id] ?? 0) + 1 } })}
                found={run.found ?? []} talk={run.talk ?? []}
                onTalk={(t, revealed) => setRun((r) => r && { ...r, talk: [...(r.talk ?? []), t], found: [...new Set([...(r.found ?? []), ...revealed])].sort() })}
                onProgress={onProgress} />
            : <LessonPanel key={lesson.variant?.seed} lesson={lesson} done={done} onGo={open} onExplain={setConcept} />}
          <main className="workspace">
            <TabList selectedValue={tab} onTabSelect={(_, d) => open(d.value as Workspace)} className="workspace-tabs">
              <Tab value="admin">Admin center</Tab>
              <Tab value="diagram">Diagram</Tab>
              <Tab value="phone">Phone</Tab>
              <Tab value="agent">Agent</Tab>
            </TabList>
            <div className="workspace-view">
              <div hidden={tab !== "admin"} className="workspace-pane"><AdminCenter request={adminRequest} /></div>
              <div hidden={tab !== "phone"} className="workspace-pane"><Phone key={run?.scenario.id ?? lesson.variant?.seed} line={run ? undefined : lesson.line} /></div>
              <div hidden={tab !== "agent"} className="workspace-pane"><AgentView /></div>
              <div hidden={tab !== "diagram"} className="workspace-pane">
                <iframe key={diagramKey} className="workspace-diagram" title="Environment Diagram" src="tools/diagram2d/" />
              </div>
            </div>
          </main>
        </div>
        <LearnStrip conceptId={concept} />
        <ExercisePicker open={picking} current={run?.scenario.id ?? "lesson"} onClose={() => setPicking(false)} onLesson={startLesson} onScenario={startScenario}
          classInfo={member ? { name: member.className, scenarios: classScenarios } : undefined} finishedIds={finishedIds} onTrainer={() => { setPicking(false); setTrainer("new"); }} />
        {joining !== undefined && <JoinDialog initialCode={joining} onClose={() => setJoining(undefined)}
          onJoined={(m, list) => { setMember(m); setClassScenarios(list); setJoining(undefined); setMessage(`You joined ${m.className}. Your exercises are at the top of Choose an exercise.`); setPicking(true); }} />}
        {trainer && <TrainerView all={allScenarios} initial={trainer === "new" ? undefined : trainer} onClose={() => setTrainer(undefined)} />}
        <TourBar tour={tour} />
      </div>
      </FluentProvider>
    </TrainingContext.Provider>
  );
}
