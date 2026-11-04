// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Learner } from "./learner";
import { WebApi } from "./webapi";

// The Xrm object and fetch wrapper the Toolbox talks to. Toolbox code finds Xrm through resolveXrm()
// (tools/shared/src/xrm.ts) on its page, its parent or top, so the same object serves the shell and
// the tool iframes.

export interface Navigate { kind: "navigateTo" | "openUrl"; target: unknown }

export function makeXrm(api: WebApi, learner: Learner, onNavigate: (n: Navigate) => void = () => undefined): any {
  // Xrm.WebApi answers asynchronously and rejects with the error object, like the real one.
  const later = <T>(work: () => T): Promise<T> => new Promise((resolve, reject) => {
    try { resolve(work()); } catch (error) { reject(error); }
  });
  const context = {
    getClientUrl: () => api.clientUrl,
    userSettings: { userId: `{${learner.userId.toUpperCase()}}`, userName: learner.userName, languageId: 1033 },
    getVersion: () => "9.2.0.0 (training simulator)"
  };
  return {
    WebApi: {
      retrieveMultipleRecords: (entity: string, options?: string, maxPageSize?: number) => later(() => api.retrieveMultiple(entity, options, maxPageSize)),
      retrieveRecord: (entity: string, id: string, options?: string) => later(() => api.retrieve(entity, id, options)),
      // Each resolves with { entityType, id }, like the real ones.
      createRecord: (entity: string, data: Record<string, unknown>) => later(() => ({ entityType: entity, id: api.create(entity, data) })),
      updateRecord: (entity: string, id: string, data: Record<string, unknown>) => later(() => { api.update(entity, id, data); return { entityType: entity, id: id.replace(/[{}]/g, "").toLowerCase() }; }),
      deleteRecord: (entity: string, id: string) => later(() => { api.remove(entity, id); return { entityType: entity, id: id.replace(/[{}]/g, "").toLowerCase() }; })
    },
    Utility: { getGlobalContext: () => context },
    Navigation: {
      navigateTo: (target: unknown) => { onNavigate({ kind: "navigateTo", target }); return Promise.resolve(); },
      openUrl: (target: unknown) => { onNavigate({ kind: "openUrl", target }); }
    },
    simulator: true
  };
}

// fetch that answers requests to the simulated address from the simulator and passes everything else on.
export function makeFetch(api: WebApi, realFetch: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!api.handles(url)) return realFetch(input, init);
    const request = typeof input === "object" && "method" in input ? input : undefined;
    const headers = init?.headers ?? request?.headers;
    const plain = headers instanceof Headers ? headersObject(headers) : Array.isArray(headers) ? Object.fromEntries(headers) : headers as Record<string, string> | undefined;
    return api.fetch(url, { method: init?.method ?? request?.method, body: init?.body, headers: plain });
  }) as typeof fetch;
}

function headersObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => { out[key] = value; });
  return out;
}
