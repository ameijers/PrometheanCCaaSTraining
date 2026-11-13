// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import type { LabState } from "../labs/labs";
import { createRoot } from "react-dom/client";
import { createSimulator, Simulator } from "../simulator";
import { loadSession } from "../simulator/persist";
import { Navigate } from "../simulator/xrmShim";
import { Lesson } from "../lessons/checks";
import { App, NAVIGATE_EVENT, ScenarioRun } from "./App";

// Xrm.Navigation calls from the Environment Diagram ("Open record") go to the shell as an event.
const onNavigate = (n: Navigate) => window.dispatchEvent(new CustomEvent<Navigate>(NAVIGATE_EVENT, { detail: n }));

// Starts the simulator before anything else, so the Toolbox finds Xrm the moment it loads.
async function start(): Promise<void> {
  const realFetch = window.fetch.bind(window);
  // ?seed=N starts a fresh run of that lesson variant (for links and the walkthrough script).
  const askedSeed = new URLSearchParams(window.location.search).get("seed");
  const saved = askedSeed === null ? await loadSession() : undefined;
  let sim: Simulator;
  let lesson = saved?.lesson as Lesson | undefined;
  let scenario = saved?.scenario as ScenarioRun | undefined;
  try {
    sim = createSimulator({ rows: saved?.rows, realFetch, onNavigate });
  } catch {
    // A session saved by an older version that no longer loads: start from the beginning.
    sim = createSimulator({ realFetch, onNavigate });
    lesson = undefined;
    scenario = undefined;
  }
  const w = window as any;
  w.Xrm = sim.xrm;
  w.fetch = sim.fetch;
  // What the Diagram's iframe bridge script picks up (src/tools/bridge.ts).
  w.__ccaasTraining = { xrm: sim.xrm, fetch: sim.fetch };
  createRoot(document.getElementById("root")!).render(
    <App sim={sim} restored={!!saved} savedLesson={lesson} savedScenario={scenario} savedClock={typeof saved?.clock === "number" ? saved.clock : undefined} seed={askedSeed === null ? undefined : Number(askedSeed)} savedLab={saved?.lab as LabState | undefined} />
  );
}

void start();
