// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { BACKEND } from "../learn/client";
import { learnerId } from "../classroom/identity";
import { Scenario, ScenarioKind } from "./scenario";

// The AI parts of the backend (backend/src/server.ts). The browser never holds an API key: it asks the
// backend, which says whether the AI is switched on. Without the backend, or with the AI off, the
// training runs on its ready-made scenarios.

export interface AiStatus { available: boolean; provider?: string; off?: string; usedToday: number; dailyLimit: number }
export interface Caller { name: string; mood: string; says: string; choice: string }

async function ask<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BACKEND}${path}`, { ...init, signal: controller.signal, headers: { "Content-Type": "application/json", "X-Learner": learnerId() } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `The backend answered ${response.status}.`);
    return body as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("The backend took too long to answer.");
    if (e instanceof TypeError) throw new Error("The training's backend isn't running (npm run backend).");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const aiStatus = (): Promise<AiStatus | undefined> => ask<AiStatus>("/ai/status").catch(() => undefined);

export const aiScenarios = (): Promise<Scenario[]> => ask<{ scenarios: Scenario[] }>("/ai/scenarios").then((r) => r.scenarios).catch(() => []);

// The AI gets up to three tries; each is one request (hosted, a request may take at most 45 seconds). A try
// that fails the checks comes back with its problems, and goes along with the next try.
interface Try { scenario?: Scenario; problems?: string[]; text?: string; maxAttempts?: number }
export async function writeAiScenario(kind: ScenarioKind, level: number): Promise<Scenario> {
  const previous: { text: string; problems: string[] }[] = [];
  for (;;) {
    const r = await ask<Try>("/ai/scenario", { method: "POST", body: JSON.stringify({ kind, level, previous }) }, 60_000);
    if (r.scenario) return r.scenario;
    previous.push({ text: r.text ?? "", problems: r.problems ?? [] });
    if (previous.length >= (r.maxAttempts ?? 3)) throw new Error(`The AI's scenario failed the training's checks ${previous.length} times, so it was dropped. Try again, or use a ready-made one.`);
  }
}

export const aiCaller = (dial: string): Promise<Caller> =>
  ask<{ caller: Caller }>("/ai/caller", { method: "POST", body: JSON.stringify({ dial }) }, 120_000).then((r) => r.caller);

// The AI customer in an interview: answers the learner's own question, and says which requirements the
// answer revealed (the backend checks they exist).
export const aiInterview = (scenario: Scenario, talk: { q: string; a: string }[], question: string): Promise<{ answer: string; revealed: number[] }> =>
  ask<{ answer: string; revealed: number[] }>("/ai/interview", { method: "POST", body: JSON.stringify({ scenario, talk, question }) }, 120_000);

// An AI hint for a requirement, based on a concept's Learn passage (shown with it).
export const aiHint = (body: { requirement: string; checks: string[]; concept: string }): Promise<{ hint: string; concept: string }> =>
  ask<{ hint: string; concept: string }>("/ai/hint", { method: "POST", body: JSON.stringify(body) }, 120_000);
