// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Rows } from "./store";

// Keeps the learner's session in the browser (IndexedDB), so a reload carries on where they were.
// If IndexedDB isn't there (a private window, blocked storage), the session simply isn't kept.

const DB = "ccaas-training";
const STORE = "sessions";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Storage that is blocked can leave IndexedDB without an answer at all, so give up after a while
// rather than keep the training from starting.
const GIVE_UP_MS = 2000;

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const attempt = (async () => {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  })();
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), GIVE_UP_MS));
  try {
    return await Promise.race([attempt, timeout]);
  } catch {
    return undefined;
  }
}

// The environment's rows, and the lesson the learner is doing in it (a lesson from a template differs per run).
export interface Session { rows: Rows; lesson?: unknown; scenario?: unknown; clock?: number; lab?: unknown }

export async function loadSession(): Promise<Session | undefined> {
  const saved = await run<Session | Rows>("readonly", (s) => s.get(KEY));
  if (!saved) return undefined;
  // Sessions saved before lessons were kept with them hold only the rows.
  return "rows" in saved && typeof (saved as Session).rows === "object" ? saved as Session : { rows: saved as Rows };
}

export const saveSession = (session: Session): Promise<unknown> => run("readwrite", (s) => s.put(session, KEY));
export const clearSession = (): Promise<unknown> => run("readwrite", (s) => s.delete(KEY));
