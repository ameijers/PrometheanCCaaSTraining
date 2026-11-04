// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { TourBar, TourStep, useTour } from "@toolbox/environment-3d-explorer/src/tour";

// The training's own guided tour (manual 10, "Help and tour"), on the Toolbox's tour engine
// (environment-3d-explorer/src/tour.tsx: useTour and TourBar), with the training's own look. Each step
// shows one part of the screen and lights it up. "Tour" in the header starts it, and ?tour=1 in the address.

type Tab = "admin" | "diagram" | "phone" | "agent";

// Lights up an element while a step shows.
const focus = (selector: string) => () => {
  const el = document.querySelector(selector);
  el?.classList.add("tour-focus");
  return () => el?.classList.remove("tour-focus");
};

export function trainingTour(open: (tab: Tab) => void): TourStep[] {
  const step = (title: string, text: string, selector: string, tab?: Tab, seconds = 9): TourStep => ({
    title, text, seconds, run: () => { if (tab) open(tab); return focus(selector)(); }
  });
  return [
    step("A contact center to practise on", "Everything here is simulated: a Dynamics 365 Contact Center environment with made-up people and phone numbers reserved for fiction. Nothing you do reaches a real system.", ".training-sim"),
    step("Your exercise", "On the left: the story and what to do. Tasks tick off by themselves when the training's checks pass. Hints are there when you need them.", ".lesson"),
    step("Choose an exercise", "A guided lesson, or scenarios: fix a broken contact center, predict where calls go, build what a company asks for, or interview a customer first.", ".training-choose"),
    step("The admin center", "A simulation of the Copilot Service admin center: Microsoft's menu and field names, our own look. This is where you change things.", ".workspace-view", "admin"),
    step("The Environment Diagram", "How it all connects: phone numbers, channels, workstreams, rules, queues and people. Problems are marked, and the Live tab shows calls as they happen.", ".workspace-view", "diagram"),
    step("The phone", "Call any number in the environment, answer the IVR, and follow the call step by step to the queue and the representative who takes it.", ".workspace-view", "phone"),
    step("Be a representative", "Sign in as one of the representatives, set your presence, and take the calls routing offers you.", ".workspace-view", "agent"),
    step("The clock", "The contact center's own time. Let it run, speed it up, or jump to a day and time to see what happens out of hours.", ".clock"),
    step("Explanations from Microsoft Learn", "At the bottom: what you're looking at, in a few words, with a passage from Microsoft Learn and a link to read more.", ".learn", undefined, 10)
  ];
}

export function useTrainingTour(open: (tab: Tab) => void) {
  return useTour(trainingTour(open), () => undefined);
}

export { TourBar };
