// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Progress } from "./client";

// A learner's progress on one lab or exercise, as the trainer sees it in the class table: a small bar per
// part of a lab (Learn, Do, Challenge) or one bar for an exercise, what the learner is on now and for how
// long, and a background that gets darker the further they are (a heat map over the whole table).
//
// Colours (docs/classroom.md): progress in one blue, light to dark; done in the status green; "may be
// stuck" in the status amber. Each comes with a word or a number, never colour alone.

// A learner on the same thing this long, and still around, may be stuck.
export const STUCK_AFTER_MS = 10 * 60_000;
const AWAY_AFTER_MS = 30 * 60_000;

export type CellState = "done" | "working" | "stuck" | "none";

export function ago(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

const minutes = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

// How far along (0 to 1) and in which state.
export function cellOf(p: Progress | undefined, now: number): { state: CellState; fraction: number } {
  if (!p) return { state: "none", fraction: 0 };
  if (p.done) return { state: "done", fraction: 1 };
  const parts = p.parts;
  const fraction = parts
    ? ((parts.learn ? (parts.learn.done ? 1 : parts.learn.pages ? parts.learn.read / (parts.learn.pages + 1) : 0) : 0)
      + (parts.do ? (parts.do.done ? 1 : parts.do.tasks ? parts.do.passed / parts.do.tasks : 0) : 0)) / 2
    : p.checks.length ? p.checks.filter((c) => c.passed).length / p.checks.length : 0;
  const stuck = !!p.current && now - Date.parse(p.current.since) > STUCK_AFTER_MS && now - Date.parse(p.updatedOn) < AWAY_AFTER_MS;
  return { state: stuck ? "stuck" : "working", fraction };
}

// The heat map's shade: none, then three steps of the blue as the learner gets further.
const shade = (state: CellState, fraction: number) =>
  state === "done" ? "tp-done" : state === "none" ? "" : fraction < 1 / 3 ? "tp-heat-1" : fraction < 2 / 3 ? "tp-heat-2" : "tp-heat-3";

function Bar({ label, value, of, done }: { label: string; value: number; of: number; done: boolean }) {
  const width = done ? 100 : of ? Math.round((value / of) * 100) : 0;
  const text = done ? "✓" : of ? `${value}/${of}` : "–";
  return (
    <span className="tp-part">
      <span className="tp-label">{label}</span>
      <span className="tp-track" aria-hidden="true"><span className={`tp-fill${done ? " tp-fill-done" : ""}`} style={{ width: `${width}%` }} /></span>
      <span className="tp-value">{text}</span>
    </span>
  );
}

// Everything in words, for the cell's tooltip and screen readers.
export function describe(p: Progress, now: number): string {
  const lines: string[] = [];
  const parts = p.parts;
  if (parts?.learn) lines.push(`Learn: ${parts.learn.done ? "done (pages and quiz)" : `${parts.learn.read} of ${parts.learn.pages} pages read, quiz not passed yet`}`);
  if (parts?.do) lines.push(`Do: ${parts.do.done ? "done" : parts.do.tasks ? `${parts.do.passed} of ${parts.do.tasks} tasks` : "not started"}`);
  if (parts?.challenge && parts.challenge.of) lines.push(`Challenge: ${parts.challenge.done} of ${parts.challenge.of} done`);
  if (!parts) lines.push(...p.checks.map((c) => `${c.passed ? "✓" : "○"} ${c.title}`));
  if (p.current && !p.done) lines.push(`Now on: ${p.current.title} (${minutes(p.current.since, now)} min)`);
  if (p.hints) lines.push(`${p.hints} hint${p.hints === 1 ? "" : "s"} used`);
  lines.push(`Last update: ${ago(p.updatedOn, now)}`);
  return lines.join("\n");
}

export function ProgressCell({ p, now }: { p: Progress | undefined; now: number }) {
  const { state, fraction } = cellOf(p, now);
  if (!p) return <td className="tp-cell"><span className="admin-muted">Not started</span></td>;
  const parts = p.parts;
  const passed = p.checks.filter((c) => c.passed).length;
  return (
    <td className={`tp-cell ${shade(state, fraction)}${state === "stuck" ? " tp-stuck" : ""}`} title={describe(p, now)}>
      {state === "done" && <span className="tp-status tp-status-done">✓ Done</span>}
      {state === "stuck" && <span className="tp-status tp-status-stuck">! May be stuck</span>}
      {parts ? (
        <span className="tp-parts">
          <Bar label="Learn" value={parts.learn?.read ?? 0} of={parts.learn?.pages ?? 0} done={!!parts.learn?.done} />
          <Bar label="Do" value={parts.do?.passed ?? 0} of={parts.do?.tasks ?? 0} done={!!parts.do?.done} />
          {!!parts.challenge?.of && <Bar label="Challenge" value={parts.challenge.done} of={parts.challenge.of} done={parts.challenge.done >= parts.challenge.of} />}
        </span>
      ) : state !== "done" && (
        <span className="tp-parts"><Bar label="Checks" value={passed} of={p.checks.length} done={false} /></span>
      )}
      {p.current && state !== "done" && <span className="tp-now">Now: {p.current.title} · {minutes(p.current.since, now)} min</span>}
      {p.hints > 0 && <span className="tp-hints">{p.hints} hint{p.hints === 1 ? "" : "s"}</span>}
    </td>
  );
}

// A learner's activity: active in the last five minutes, or when they were last seen.
export function Activity({ updates, now }: { updates: string[]; now: number }) {
  const last = updates.sort().pop();
  const active = !!last && now - Date.parse(last) < 5 * 60_000;
  return (
    <span className={`tp-activity${active ? " tp-active" : ""}`}>
      <span className="tp-dot" aria-hidden="true" />
      {!last ? "Not started" : active ? "Active now" : `Last seen ${ago(last, now)}`}
    </span>
  );
}

// What the colours mean, above the table.
export function Legend() {
  return (
    <p className="tp-legend" aria-label="What the colours mean">
      <span><span className="tp-swatch tp-done" />✓ Done</span>
      <span><span className="tp-swatch tp-heat-1" /><span className="tp-swatch tp-heat-2" /><span className="tp-swatch tp-heat-3" />Working: darker is further along</span>
      <span><span className="tp-swatch tp-swatch-stuck" />! May be stuck: on the same thing for over {STUCK_AFTER_MS / 60_000} minutes</span>
      <span><span className="tp-swatch" />Not started</span>
    </p>
  );
}
