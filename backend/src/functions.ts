// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import * as os from "os";
import * as path from "path";
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { createApi, readPrincipal } from "./api";
import { FileStore, KvStore } from "./kv";
import { settings } from "./settings";
import { TableStore } from "./tableStore";
import { AiError } from "./ai/provider";

// The backend when hosted on Azure Static Web Apps (decision 15.4, phase 9): one HTTP function that hands
// every /api/* request to the same handler the local server uses (api.ts). Static Web Apps sends
// /api/<path> to it; its app settings hold the keys (manual 14), never the browser.
//
// App settings it reads, besides the AI's (settings.ts):
//   SITE_ORIGIN                 the training's own address, e.g. https://<name>.azurestaticapps.net:
//                               only pages from there may POST
//   STORAGE_CONNECTION_STRING   Azure Table Storage for classes, progress, AI usage and AI scenarios.
//                               Without it, they're kept in the function's temporary folder and lost
//                               when it restarts: fine for a try-out, not for a class.

const store: KvStore = process.env.STORAGE_CONNECTION_STRING
  ? new TableStore(process.env.STORAGE_CONNECTION_STRING)
  : new FileStore(path.join(os.tmpdir(), "ccaas-training-data"));

const site = process.env.SITE_ORIGIN?.replace(/\/+$/, "");

const api = createApi({
  settings,
  store,
  cacheDir: path.join(os.tmpdir(), "ccaas-training-learn"),
  allowed: (origin) => !!origin && !!site && origin === site
});

app.http("api", {
  route: "{*path}",
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const url = new URL(request.url);
    // The function's own path, without Static Web Apps' /api prefix.
    const p = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
    const out = await api.handle({
      method: request.method,
      path: p,
      query: request.query,
      origin: request.headers.get("origin") ?? undefined,
      learner: request.headers.get("x-learner") ?? undefined,
      // Static Web Apps adds who signed in to each API request (Microsoft Learn: Accessing user information).
      user: readPrincipal(request.headers.get("x-ms-client-principal")),
      body: async (limit = 10_000) => {
        const text = await request.text();
        if (text.length > limit) throw new AiError("The request is too large.", 413);
        try { return text ? JSON.parse(text) : {}; } catch { throw new AiError("The request is not valid JSON.", 400); }
      }
    });
    return { status: out.status, jsonBody: out.body, headers: { "Cache-Control": "no-store" } };
  }
});
