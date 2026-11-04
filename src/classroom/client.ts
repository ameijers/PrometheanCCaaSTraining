// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { BACKEND } from "../learn/client";
import { learnerId } from "./identity";

// The classroom parts of the backend (backend/src/classes.ts): create a class, join it, report progress,
// and, with the trainer's key, read the class's progress.

export interface ClassInfo { code: string; name: string; scenarios: string[] }
export interface CheckProgress { title: string; passed: boolean }
export interface Progress { learnerId: string; name: string; scenarioId: string; title: string; checks: CheckProgress[]; done: boolean; hints: number; updatedOn: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Learner": learnerId() } });
  } catch {
    throw new Error("The training's backend can't be reached, so classes don't work right now.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `The backend answered ${response.status}.`);
  return body as T;
}

export const createClass = (name: string, scenarios: string[]) => call<{ code: string; trainerKey: string }>("/classes", { method: "POST", body: JSON.stringify({ name, scenarios }) });
export const getClass = (code: string) => call<ClassInfo>(`/classes/${encodeURIComponent(code.trim().toUpperCase())}`);
export const reportProgress = (code: string, p: Omit<Progress, "learnerId" | "updatedOn">) =>
  call<{ saved: boolean }>(`/classes/${encodeURIComponent(code)}/progress`, { method: "POST", body: JSON.stringify({ ...p, learnerId: learnerId() }) });
export const classProgress = (code: string, key: string) =>
  call<{ class: ClassInfo; progress: Progress[] }>(`/classes/${encodeURIComponent(code)}/progress?key=${encodeURIComponent(key)}`);

// Links to hand out: one for learners, one for the trainer (with the key: keep it to yourself).
export const classLink = (code: string) => `${window.location.origin}${window.location.pathname}?class=${code}`;
export const trainerLink = (code: string, key: string) => `${window.location.origin}${window.location.pathname}?trainer=${code}&key=${key}`;
