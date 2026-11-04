// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// One interface for the AI (manual 8.1), so the provider can change without touching what uses it.
// Only the backend calls it, and nothing about learners is sent: only the scenario's own text and the
// simulated environment.

export interface Turn { role: "user" | "assistant"; text: string }

export interface AiProvider {
  readonly name: string;
  // An answer that is JSON of this schema, already parsed. The conversation ends with the user's turn.
  complete(system: string, turns: Turn[], schema: Record<string, unknown>): Promise<{ json: unknown; text: string }>;
  // A plain-text answer (the AI customer, later).
  chat(system: string, turns: Turn[]): Promise<string>;
}

export class AiError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}
