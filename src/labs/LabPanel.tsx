// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { ReactNode } from "react";
import { doDone, Lab, LabPart, LabState, learnDone } from "./labs";

// The lab's outline on the left: the three parts with their progress, and in Learn the pages. In Do the
// lesson's task list shows below this header (LessonPanel's `header`).

export function LabHeader({ lab, state, finishedIds, go, onAll }: { lab: Lab; state: LabState; finishedIds: string[]; go(part: LabPart): void; onAll(): void }) {
  const parts: [LabPart, string, boolean][] = [
    ["learn", "Learn", learnDone(lab, finishedIds)],
    ["do", "Do", doDone(lab, finishedIds)],
    ["challenge", "Challenge", (lab.challenges ?? []).some((id) => finishedIds.includes(id))]
  ];
  return (
    <div className="lab-header">
      <button className="lesson-toggle" onClick={onAll}>← All labs</button>
      <p className="lesson-eyebrow">Lab {lab.number}</p>
      <h1 className="lesson-title">{lab.title}</h1>
      <nav className="lab-parts" aria-label="Parts of the lab">
        {parts.map(([part, label, done]) => (
          <button key={part} className={state.part === part ? "active" : ""} aria-current={state.part === part ? "step" : undefined} onClick={() => go(part)}>
            {done ? "✓ " : ""}{label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function LabPanel({ lab, state, setState, finishedIds, go, onAll, children }: {
  lab: Lab; state: LabState; setState(s: LabState): void; finishedIds: string[]; go(part: LabPart): void; onAll(): void; children?: ReactNode;
}) {
  const pages = lab.learn ?? [];
  return (
    <aside className="lesson">
      <LabHeader lab={lab} state={state} finishedIds={finishedIds} go={go} onAll={onAll} />
      {state.part === "learn" && (
        <ol className="lab-pages">
          {pages.map((p, i) => (
            <li key={p.title}><button className={state.page === i ? "active" : ""} onClick={() => setState({ ...state, page: i })}>{p.title}</button></li>
          ))}
          <li><button className={state.page >= pages.length ? "active" : ""} onClick={() => setState({ ...state, page: pages.length })}>{learnDone(lab, finishedIds) ? "✓ " : ""}Quiz</button></li>
        </ol>
      )}
      {state.part === "challenge" && <p className="admin-muted">Pick an exercise in the Lab tab. You can come back to this lab from any exercise.</p>}
      {children}
    </aside>
  );
}
