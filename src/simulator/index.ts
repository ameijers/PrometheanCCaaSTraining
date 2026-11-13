// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { LEARNER } from "./learner";
import { trainingSeed } from "./seeds/training";
import { Rows, Store } from "./store";
import { WebApi } from "./webapi";
import { makeFetch, makeXrm, Navigate } from "./xrmShim";

// One simulated environment: the store, the Web API on top of it, and the Xrm and fetch the Toolbox uses.

export { LEARNER };

// A reserved .example address (RFC 2606), so a request that ever slipped past the simulator could not
// reach a real server.
export const SIMULATED_URL = "https://contoso.simulated.example";

export interface Simulator {
  store: Store;
  api: WebApi;
  xrm: any;
  fetch: typeof fetch;
}

export interface SimulatorOptions {
  // The rows to start with. Defaults to the training seed (seeds/training.ts).
  rows?: Rows;
  pageSize?: number;
  realFetch?: typeof fetch;
  onNavigate?: (n: Navigate) => void;
}

export function createSimulator(options: SimulatorOptions = {}): Simulator {
  const store = new Store(options.rows ?? trainingSeed());
  const api = new WebApi(store, { clientUrl: SIMULATED_URL, pageSize: options.pageSize });
  const realFetch = options.realFetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  return { store, api, xrm: makeXrm(api, LEARNER, options.onNavigate), fetch: makeFetch(api, realFetch) };
}
