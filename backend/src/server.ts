// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as http from "http";
import * as path from "path";
import { createApi, readPrincipal } from "./api";
import { FileStore } from "./kv";
import { AiError } from "./ai/provider";
import { ROOT, settings } from "./settings";

// The backend on this machine: npm run backend (port 7071). The routes are in api.ts. It only listens on
// this computer, and only the training's own pages, served from this computer, may use it.
// There's no Static Web Apps sign-in here: the page's "Trainer sign-in" sends a made-up principal in the
// X-Dev-Principal header instead (src/classroom/account.ts). Only this local server reads that header.

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const api = createApi({
  settings,
  store: new FileStore(path.join(ROOT, "backend/.data")),
  cacheDir: path.join(ROOT, "backend/.cache/learn"),
  generatedDir: path.join(ROOT, "content/scenarios/generated"),
  allowed: (origin) => !!origin && LOCAL.test(origin)
});

async function readBody(req: http.IncomingMessage, limit: number): Promise<any> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new AiError("The request is too large.", 413);
  }
  try { return JSON.parse(text || "{}"); } catch { throw new AiError("The request isn't valid JSON.", 400); }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url ?? "/", "http://localhost");
  const learner = req.headers["x-learner"];
  const out = await api.handle({
    method: req.method ?? "GET", path: url.pathname, query: url.searchParams, origin,
    learner: typeof learner === "string" ? learner : undefined,
    user: readPrincipal(typeof req.headers["x-dev-principal"] === "string" ? req.headers["x-dev-principal"] : undefined),
    body: (limit = 10_000) => readBody(req, limit)
  });
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  // Only the training itself, served from this machine, may read the answers.
  if (origin && LOCAL.test(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Learner, X-Dev-Principal";
  }
  res.writeHead(out.status, headers);
  res.end(out.body === undefined ? "" : JSON.stringify(out.body));
});

server.listen(settings.port, "127.0.0.1", async () => {
  const used = await api.limits.used();
  console.log(`Training backend on http://localhost:${settings.port}. Learn: read-only. AI: ${api.chosen.provider ? `on, ${api.chosen.provider.name}, ${used.today} of ${api.limits.daily} requests used today` : `off: ${api.chosen.off}`}.`);
});
