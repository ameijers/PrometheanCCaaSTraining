// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Asks the training's backend (npm run backend) how a concept's Microsoft Learn article stands now.
// Without the backend the training still works: it shows the saved explanation and says so (manual 7.4).

// Where the backend is: on this machine while developing (npm run backend), or /api on the same site when
// hosted (Azure Static Web Apps sends /api to the Functions, phase 9).
export const BACKEND = typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname) ? "/api" : "http://localhost:7071";

export interface LearnStatus {
  id: string;
  date?: string;
  dateChanged: boolean;
  quoteFound: boolean;
  source: "live" | "cache";
  fetchedAt: string;
}

const known = new Map<string, Promise<LearnStatus | undefined>>();

export function learnStatus(conceptId: string, timeoutMs = 4000): Promise<LearnStatus | undefined> {
  if (!known.has(conceptId)) {
    const ask = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${BACKEND}/learn/concept/${encodeURIComponent(conceptId)}`, { signal: controller.signal });
        return response.ok ? (await response.json()) as LearnStatus : undefined;
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    })();
    known.set(conceptId, ask);
    // Not reached: ask again next time, the backend may have been started since.
    void ask.then((s) => { if (!s) known.delete(conceptId); });
  }
  return known.get(conceptId)!;
}
