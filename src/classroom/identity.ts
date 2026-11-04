// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Who the learner is, as far as the training knows: a random id made in this browser, and, when they've
// joined a class, the class code and the display name they chose (decision 15.5). Nothing else.
// Kept in this browser only; if storage is blocked, it lasts until the page closes.

export interface Membership { code: string; className: string; name: string }

const ID_KEY = "ccaas-training-learner";
const CLASS_KEY = "ccaas-training-class";
const DONE_KEY = "ccaas-training-done";
let memoryId: string | undefined;
let memoryClass: Membership | undefined;
let memoryDone: string[] = [];

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* storage blocked: memory only */ }
}

export function learnerId(): string {
  const saved = typeof window === "undefined" ? null : read(ID_KEY);
  if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
  if (!memoryId) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    memoryId = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (typeof window !== "undefined") write(ID_KEY, memoryId);
  }
  return memoryId;
}

export function membership(): Membership | undefined {
  const saved = typeof window === "undefined" ? null : read(CLASS_KEY);
  try { return saved ? JSON.parse(saved) as Membership : memoryClass; } catch { return memoryClass; }
}

export function setMembership(m: Membership | undefined): void {
  memoryClass = m;
  write(CLASS_KEY, m ? JSON.stringify(m) : null);
}

// The exercises this learner finished, to tick them in the list.
export function finished(): string[] {
  try { return JSON.parse(read(DONE_KEY) ?? "null") ?? memoryDone; } catch { return memoryDone; }
}

export function markFinished(id: string): void {
  const all = [...new Set([...finished(), id])];
  memoryDone = all;
  write(DONE_KEY, JSON.stringify(all));
}
