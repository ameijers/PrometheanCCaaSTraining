// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tour, TourStep, tourAsked, useTour } from "@toolbox/environment-3d-explorer/src/tour";

// The training's own guided tour (manual 10, "Help and tour"), on the Toolbox's tour engine
// (environment-3d-explorer/src/tour.tsx: useTour for the steps). The learner moves on at their own pace:
// each step lights up one part of the screen with a card next to it (Back, Next, Skip the tour).
// "Tour" in the header starts it, and ?tour=1 in the address. First-time visitors get the Welcome below,
// which offers it.

type Tab = "admin" | "diagram" | "phone" | "agent";

interface TrainingStep extends TourStep { selector: string }

export function trainingTour(open: (tab: Tab) => void): TrainingStep[] {
  // seconds is part of the engine's step; this tour doesn't play by itself, so it isn't used.
  const step = (title: string, text: string, selector: string, tab?: Tab): TrainingStep => ({
    title, text, selector, seconds: 0, run: () => { if (tab) open(tab); }
  });
  return [
    step("A contact center to practise on", "Everything here is simulated: a Dynamics 365 Contact Center environment with made-up people and phone numbers reserved for fiction. Nothing you do reaches a real system.", ".training-sim"),
    step("Your lab", "Each lab is one subject in three parts: Learn (short pages and a quiz), Do (tasks in the environment that tick off by themselves) and Challenge.", ".lesson"),
    step("Labs and practice", "The labs in the recommended order, starting with how a call finds its way. Practice has more exercises: fix a broken contact center, predict where calls go, build what a company asks for, or interview a customer.", ".training-choose"),
    step("The admin center", "A simulation of the Copilot Service admin center: Microsoft's menu and field names, our own look. This is where you change things.", ".workspace-view", "admin"),
    step("The Environment Diagram", "How it all connects: phone numbers, channels, workstreams, rules, queues and people. Problems are marked, and the Live tab shows calls as they happen.", ".workspace-view", "diagram"),
    step("The phone", "Call any number in the environment, answer the IVR, and follow the call step by step to the queue and the representative who takes it.", ".workspace-view", "phone"),
    step("Be a representative", "Sign in as one of the representatives, set your presence, and take the calls routing offers you.", ".workspace-view", "agent"),
    step("The clock", "The contact center's own time, above the Phone, Agent and Diagram tabs. Let it run, speed it up, or jump to a day and time to see what happens out of hours.", ".clock-strip", "phone"),
    step("Explanations from Microsoft Learn", "What you're looking at, in a few words, with a passage from Microsoft Learn and a link to read more. That's the tour: Tour at the top shows it again.", ".learn")
  ];
}

export function useTrainingTour(open: (tab: Tab) => void): Tour {
  return useTour(trainingTour(open), () => undefined);
}

// The welcome opens every visit: the learner says whether they carry on in their class or work on their
// own. Not for browser scripts (they'd find a dialog in the way), unless ?welcome=1 asks for it; ?welcome=0
// leaves it out.
function shouldWelcome(): boolean {
  const asked = new URLSearchParams(window.location.search).get("welcome");
  if (asked !== null) return !/^(0|false|no|off)$/i.test(asked);
  return !navigator.webdriver && !tourAsked();
}

const CARD_WIDTH = 360;
const GAP = 12;

// Where the card goes: below the lit-up part, else above, else inside it at the bottom; kept on screen.
function place(target: DOMRect | undefined, card: { width: number; height: number }): React.CSSProperties {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (!target) return { left: Math.max(16, (vw - card.width) / 2), top: Math.max(16, (vh - card.height) / 2) };
  const left = Math.min(Math.max(16, target.left + target.width / 2 - card.width / 2), vw - card.width - 16);
  if (target.bottom + GAP + card.height <= vh - 16) return { left, top: target.bottom + GAP };
  if (target.top - GAP - card.height >= 16) return { left, top: target.top - GAP - card.height };
  return { left, top: Math.max(16, Math.min(target.bottom, vh) - card.height - GAP) };
}

// Every visit: in a class (carry on with it, or join one with the code) or on their own (carry on, or start
// with the labs), and where their work is kept either way. A tour for anyone who wants to see the screen.
export function Welcome({ tour, member, restored, current, onJoin, onClass, onOwn }: {
  tour: Tour;
  member?: { className: string; name: string; rejoinCode?: string };
  restored: boolean;
  current: string;
  onJoin(): void;
  onClass(): void;
  onOwn(carryOn: boolean): void;
}): React.ReactElement | null {
  const [open, setOpen] = useState(shouldWelcome);
  if (!open || tour.active) return null;
  const close = (then: () => void) => { setOpen(false); then(); };
  const carryOn = restored && !member;
  return (
    <div className="tour-backdrop">
      <div className="tour tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-welcome-title"
        onKeyDown={(e) => { if (e.key === "Escape") close(() => onOwn(carryOn)); }}>
        <p className="tour-title" id="tour-welcome-title">{restored || member ? "Welcome back" : "Welcome to the Contact Center training"}</p>
        <p className="tour-text">How do you want to work today?</p>
        <div className="welcome-choices">
          {member
            ? <button className="welcome-choice" autoFocus onClick={() => close(onClass)}>
                <strong>Carry on with my class</strong>
                <span>{member.className}, as {member.name}.{member.rejoinCode && <> Your personal code: <strong>{member.rejoinCode}</strong></>}</span>
                <span className="welcome-save">✓ Your work on the class's labs and exercises is saved with the class. Carry on in any browser with your personal code. Your trainer sees your progress and your answers.</span>
              </button>
            : <button className="welcome-choice" autoFocus onClick={() => close(onJoin)}>
                <strong>Join a class</strong>
                <span>You have a class code from your trainer. For the first time, or to carry on in this class from another browser.</span>
                <span className="welcome-save">✓ Your work on the class's labs and exercises is saved with the class. Your trainer sees your progress and your answers.</span>
              </button>}
          <button className="welcome-choice" onClick={() => close(() => onOwn(carryOn))}>
            <strong>{carryOn ? "Continue on my own" : "Work on my own"}</strong>
            <span>{carryOn ? `Pick up where you left off: ${current}.` : "Follow the labs in order, starting with lab 1, or pick practice exercises."}</span>
            <span className="welcome-save welcome-save-own">! Your work is kept in this browser only. To keep a copy, or to carry on on another computer, use Files › Save to a file.</span>
          </button>
        </div>
        <div className="tour-controls">
          <button className="tour-skip" onClick={() => close(() => tour.start())}>First, show me around the screen</button>
        </div>
        <p className="tour-text welcome-later">You can switch any time with {member ? "Class" : "Join a class"} and Labs and practice at the top.</p>
      </div>
    </div>
  );
}

export function TourCard({ tour }: { tour: Tour }): React.ReactElement | null {
  const step = tour.step as TrainingStep | undefined;
  const card = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>(() => place(undefined, { width: CARD_WIDTH, height: 200 }));
  // The lit-up part: a frame over the page that dims everything around it.
  const [spot, setSpot] = useState<DOMRect | undefined>(undefined);

  // Light up this step's part of the screen (tour-focus marks it for scripts) and put the card next to it. A step may first open a tab,
  // so look again on the next frame; follow the page when it's resized or scrolled.
  useLayoutEffect(() => {
    if (!step) return;
    let target: Element | null = null;
    const update = () => {
      const now = document.querySelector(step.selector);
      if (now !== target) { target?.classList.remove("tour-focus"); now?.classList.add("tour-focus"); target = now; }
      const box = card.current?.getBoundingClientRect();
      const rect = target?.getBoundingClientRect();
      setSpot(rect);
      setStyle(place(rect, { width: box?.width ?? CARD_WIDTH, height: box?.height ?? 200 }));
    };
    update();
    const frame = requestAnimationFrame(() => { target?.scrollIntoView({ block: "nearest" }); update(); });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      target?.classList.remove("tour-focus");
    };
  }, [step?.selector, tour.index, tour.run]); // eslint-disable-line react-hooks/exhaustive-deps

  // The arrow keys move through the steps (Esc ends the tour, in the engine).
  useEffect(() => {
    if (!tour.active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") tour.next();
      if (e.key === "ArrowLeft") tour.previous();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tour.active, tour.next, tour.previous]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the Next button focused, so Enter moves on too.
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (tour.active) nextButton.current?.focus({ preventScroll: true }); }, [tour.active, tour.index]);

  if (!step) return null;
  const last = tour.index === tour.count - 1;
  return (
    <>
    {spot
      ? <div className="tour-spot" aria-hidden="true" style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }} />
      : <div className="tour-dim" aria-hidden="true" />}
    <div ref={card} className="tour" style={style} role="dialog" aria-label="Guided tour" aria-describedby="tour-text">
      <p className="tour-count">Step {tour.index + 1} of {tour.count}</p>
      <p className="tour-title">{step.title}</p>
      <p className="tour-text" id="tour-text">{step.text}</p>
      <div className="tour-controls">
        {!last && <button className="tour-skip" onClick={tour.stop}>Skip the tour</button>}
        <span className="tour-spacer" />
        <button onClick={tour.previous} disabled={tour.index === 0} aria-label="Previous step">Back</button>
        <button ref={nextButton} className="tour-primary" onClick={tour.next} aria-label={last ? undefined : "Next step"}>{last ? "Done" : "Next"}</button>
      </div>
    </div>
    </>
  );
}
