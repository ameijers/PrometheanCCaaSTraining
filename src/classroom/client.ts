// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { BACKEND } from "../learn/client";
import { accountHeaders } from "./account";
import { learnerId } from "./identity";

// The classroom parts of the backend (backend/src/classes.ts): create a class, join it, report progress,
// and read and manage a class: with the trainer's key (the trainer link), or as the signed-in trainer who
// owns it (no key).

export interface ClassInfo { code: string; name: string; scenarios: string[] }
// The class as its trainer sees it: whether it's open, and its end date.
export interface ClassView extends ClassInfo { openUntil?: string; closed: boolean; open: boolean }
// A class in the signed-in trainer's list.
export interface ClassSummary extends ClassView { createdOn: string; learners: number }
export interface CheckProgress { title: string; passed: boolean }
export interface Progress { learnerId: string; name: string; scenarioId: string; title: string; checks: CheckProgress[]; done: boolean; hints: number; updatedOn: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Learner": learnerId(), ...accountHeaders() } });
  } catch {
    throw new Error("The training's backend can't be reached, so classes don't work right now.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Static Web Apps itself answers 401 and 403 for the trainer's routes, without our message.
    const fallback = response.status === 401 ? "Sign in as a trainer first."
      : response.status === 403 ? "Only trainers can do this. Ask whoever runs the training for a trainer invitation."
      : `The backend answered ${response.status}.`;
    throw new Error(body.error ?? fallback);
  }
  return body as T;
}
const post = <T>(path: string, body: object) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const enc = (code: string) => encodeURIComponent(code.trim().toUpperCase());

export const trainerConfig = () => call<{ passcodeRequired: boolean }>("/trainer");
export const createClass = (name: string, scenarios: string[], extra: { openUntil?: string; passcode?: string } = {}) =>
  post<{ code: string; trainerKey: string }>("/classes", { name, scenarios, ...extra });
export const getClass = (code: string) => call<ClassInfo>(`/classes/${enc(code)}`);
export const reportProgress = (code: string, p: Omit<Progress, "learnerId" | "updatedOn">) =>
  post<{ saved: boolean }>(`/classes/${enc(code)}/progress`, { ...p, learnerId: learnerId() });

// The signed-in trainer's own classes.
export const myClasses = () => call<{ classes: ClassSummary[] }>("/manage/classes");
export const createMyClass = (name: string, scenarios: string[], openUntil?: string) =>
  post<{ code: string; trainerKey: string }>("/manage/classes", { name, scenarios, ...(openUntil ? { openUntil } : {}) });
export const claimClass = (code: string, key: string) => post<ClassView>("/manage/claim", { code, key });

// Reading and changing one class: with its key, or, without one, as the signed-in owner.
export const classProgress = (code: string, key?: string) =>
  call<{ class: ClassView; progress: Progress[] }>(key ? `/classes/${enc(code)}/progress?key=${encodeURIComponent(key)}` : `/manage/classes/${enc(code)}`);
const manage = <T>(code: string, key: string | undefined, action: string, body: object) =>
  key ? post<T>(`/classes/${enc(code)}/${action}`, { key, ...body }) : post<T>(`/manage/classes/${enc(code)}/${action}`, body);
export const updateClass = (code: string, key: string | undefined, changes: { openUntil?: string; closed?: boolean }) => manage<ClassView>(code, key, "settings", changes);
export const removeLearner = (code: string, key: string | undefined, learnerId: string) => manage<{ removed: boolean }>(code, key, "remove", { learnerId });
export const deleteClass = (code: string, key: string | undefined) => manage<{ deleted: boolean }>(code, key, "delete", {});

// Links to hand out: one for learners, one for the trainer (with the key: keep it to yourself).
export const classLink = (code: string) => `${window.location.origin}${window.location.pathname}?class=${code}`;
export const trainerLink = (code: string, key: string) => `${window.location.origin}${window.location.pathname}?trainer=${code}&key=${key}`;

// A trainer link pasted in: the code and the key in it.
export function readTrainerLink(text: string): { code: string; key: string } | undefined {
  try {
    const url = new URL(text.trim());
    const code = url.searchParams.get("trainer"), key = url.searchParams.get("key");
    return code && key ? { code: code.toUpperCase(), key } : undefined;
  } catch {
    return undefined;
  }
}
