// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { chooseProvider } from "./ai/choose";
import { UsageLimits } from "./ai/limits";
import { AiError, AiProvider } from "./ai/provider";
import { answerAsCustomer, Attempt, MAX_ATTEMPTS, writeCaller, writeHint, writeScenarioAttempt } from "./ai/scenarios";
import { ArticleCache } from "./cache";
import { Classes, isLearnerId } from "./classes";
import { KvStore } from "./kv";
import { Concept, ConceptStatus, statusOf } from "./learn";
import { Settings } from "./settings";
import { Scenario } from "../../src/scenarios/scenario";
import conceptsJson from "../../content/concepts.json";

// The training's backend, as one request handler: the local server (server.ts) and Azure Functions
// (api/, phase 9) both call it. Routes:
//   GET  /health
//   GET  /learn/concept/<id>          how a concept's Learn article stands: its date, and whether the quote is still in it
//   GET  /learn/review                the same for every concept, for a person to review (manual 7.4)
//   GET  /ai/status                   whether the AI is on, and how much of today's limits is used
//   GET  /ai/scenarios                the AI-written scenarios that passed every check
//   POST /ai/scenario                 { kind, level, previous? }: one try: the AI writes a scenario, code checks it (manual 8.3).
//                                     It answers the scenario, or the problems and the draft; the browser sends
//                                     earlier tries back as previous, up to 3 tries (each request under 45 seconds).
//   POST /ai/caller                   { dial }: the AI plays a caller on that line (manual 5.5)
//   POST /ai/interview                { scenario, talk, question }: the AI customer answers (manual 8.2)
//   POST /ai/hint                     { requirement, checks, concept }: a hint based on the concept's Learn passage
//   POST /classes                     { name, scenarios }: a trainer creates a class (manual 10)
//   GET  /classes/<code>              the class's name and exercises
//   POST /classes/<code>/progress     a learner's progress on an exercise
//   GET  /classes/<code>/progress?key the class's progress, for its trainer
// POSTs are only taken from the training's own pages. AI requests carry the learner's random id
// (header X-Learner), for the per-learner limit.

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  origin?: string;
  learner?: string;
  body(limit?: number): Promise<any>;
}

export interface ApiResponse { status: number; body?: unknown }

export interface ApiOptions {
  settings: Settings;
  store: KvStore;
  cacheDir: string;
  // AI-written scenarios that were reviewed and shipped with the training (content/scenarios/generated), if any.
  generatedDir?: string;
  // Whether a page from this origin may POST. The training's own pages only.
  allowed(origin: string | undefined): boolean;
  // For tests: an AI to use instead of the one the settings choose.
  provider?: AiProvider;
}

const CLASSES_PER_DAY = 10;

const concepts = (): Concept[] => (conceptsJson as { concepts: Concept[] }).concepts;

export function createApi(o: ApiOptions) {
  const cache = new ArticleCache(o.cacheDir);
  const limits = new UsageLimits(o.store, o.settings.dailyLimit, o.settings.learnerLimit);
  const chosen = o.provider ? { provider: o.provider, off: undefined } : chooseProvider(o.settings);
  const classes = new Classes(o.store);

  const status = async (concept: Concept): Promise<ConceptStatus> => {
    const { article, fetchedAt, source } = await cache.get(concept.learn.url);
    return statusOf(concept, article, source, fetchedAt);
  };

  // The AI for this request: every request to the model counts towards both limits.
  const aiFor = (learner: string | undefined): AiProvider => {
    const provider = chosen.provider;
    if (!provider) throw new AiError(`The AI is switched off: ${chosen.off}.`, 503);
    if (!isLearnerId(learner)) throw new AiError("The training didn't say who's asking, so it can't count the AI's limits.", 400);
    return {
      name: provider.name,
      complete: async (...args) => { await limits.take(learner); return provider.complete(...args); },
      chat: async (...args) => { await limits.take(learner); return provider.chat(...args); }
    };
  };

  const scenarios = async (): Promise<Scenario[]> => {
    const shipped = o.generatedDir && fs.existsSync(o.generatedDir)
      ? fs.readdirSync(o.generatedDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(o.generatedDir!, f), "utf8")) as Scenario) : [];
    const written = (await o.store.list<Scenario>("scenario")).map((r) => r.value);
    return [...written, ...shipped.filter((s) => !written.some((w) => w.id === s.id))].sort((a, b) => String(b.createdOn).localeCompare(String(a.createdOn)));
  };

  async function route(r: ApiRequest): Promise<ApiResponse> {
    const ok = (body: unknown): ApiResponse => ({ status: 200, body });
    const p = r.path.replace(/\/+$/, "") || "/";
    if (r.method === "GET") {
      if (p === "/health") return ok({ ok: true });
      const one = p.match(/^\/learn\/concept\/([\w-]+)$/);
      if (one) {
        const concept = concepts().find((c) => c.id === one[1]);
        return concept ? ok(await status(concept)) : { status: 404, body: { error: `No concept “${one[1]}”.` } };
      }
      if (p === "/learn/review") return ok({ checkedAt: new Date().toISOString(), concepts: await Promise.all(concepts().map((c) => status(c).catch((e) => ({ id: c.id, error: String(e.message ?? e) })))) });
      if (p === "/ai/status") {
        const used = await limits.used(new Date(), isLearnerId(r.learner) ? r.learner : undefined);
        return ok({ available: !!chosen.provider, provider: chosen.provider?.name, off: chosen.off, usedToday: used.today, dailyLimit: limits.daily, usedByYou: used.learner, learnerLimit: limits.perLearner });
      }
      if (p === "/ai/scenarios") return ok({ scenarios: await scenarios() });
      const cls = p.match(/^\/classes\/(\w+)$/);
      if (cls) return ok(await classes.get(cls[1]));
      const prog = p.match(/^\/classes\/(\w+)\/progress$/);
      if (prog) return ok(await classes.progress(prog[1], r.query.get("key")));
    }
    if (r.method === "POST") {
      if (p === "/ai/scenario") {
        const { kind, level, previous } = await r.body(200_000);
        if (!["fix", "route", "build", "interview"].includes(kind)) return { status: 400, body: { error: "kind must be fix, route, build or interview." } };
        // Earlier tries come back from the browser: only their text and problems, within limits. Whatever they
        // say, the new scenario is checked by code like any other.
        const earlier: Attempt[] = (Array.isArray(previous) ? previous : []).slice(0, MAX_ATTEMPTS - 1)
          .map((a: any) => ({ text: String(a?.text ?? "").slice(0, 40_000), problems: (Array.isArray(a?.problems) ? a.problems : []).map(String).slice(0, 30) }));
        const avoid = (await scenarios()).filter((s) => s.kind === kind && s.level === level).map((s) => s.title).slice(0, 20);
        const tried = await writeScenarioAttempt(aiFor(r.learner), kind, Number(level), { avoid, previous: earlier });
        if (!tried.scenario) return ok({ problems: tried.problems, text: tried.text, attempt: earlier.length + 1, maxAttempts: MAX_ATTEMPTS });
        await o.store.put("scenario", tried.scenario.id.replace(/[^\w:-]/g, "-").slice(0, 120), tried.scenario);
        return ok({ scenario: tried.scenario, attempt: earlier.length + 1 });
      }
      if (p === "/ai/interview") {
        const { scenario, talk, question } = await r.body(100_000);
        const turns = (Array.isArray(talk) ? talk : []).slice(-20).flatMap((t: any) => [{ role: "user" as const, text: String(t?.q ?? "") }, { role: "assistant" as const, text: String(t?.a ?? "") }]);
        return ok(await answerAsCustomer(aiFor(r.learner), scenario, turns, String(question ?? "")));
      }
      if (p === "/ai/hint") {
        const { requirement, checks, concept } = await r.body();
        const c = concepts().find((x) => x.id === concept);
        if (!c) return { status: 400, body: { error: `No concept “${concept}”.` } };
        return ok({ hint: await writeHint(aiFor(r.learner), String(requirement ?? "").slice(0, 400), (Array.isArray(checks) ? checks : []).map(String).slice(0, 10), { title: c.learn.title, quote: c.learn.quote }), concept: c.id });
      }
      if (p === "/ai/caller") {
        const { dial } = await r.body();
        return ok({ caller: await writeCaller(aiFor(r.learner), String(dial ?? "")) });
      }
      if (p === "/classes") {
        // Anyone on the site may create a class, so a few a day per browser, to keep the store from filling up.
        if (!isLearnerId(r.learner)) throw new AiError("The training didn't say who's asking.", 400);
        const key = `${new Date().toISOString().slice(0, 10)}:classes:${r.learner}`;
        const made = (await o.store.get<number>("usage", key)) ?? 0;
        if (made >= CLASSES_PER_DAY) throw new AiError(`You've created ${CLASSES_PER_DAY} classes today. Try again tomorrow.`, 429);
        const { name, scenarios: list } = await r.body();
        const created = await classes.create(name, list);
        await o.store.put("usage", key, made + 1);
        return ok(created);
      }
      const prog = p.match(/^\/classes\/(\w+)\/progress$/);
      if (prog) { await classes.report(prog[1], await r.body(50_000)); return ok({ saved: true }); }
    }
    return { status: 404, body: { error: "Not found." } };
  }

  return {
    chosen,
    limits,
    async handle(r: ApiRequest): Promise<ApiResponse> {
      try {
        if (r.method === "OPTIONS") return { status: 204 };
        // A page from anywhere else may not make the backend spend AI requests or write.
        if (r.method === "POST" && !o.allowed(r.origin)) return { status: 403, body: { error: "Only the training's own pages may ask for this." } };
        return await route(r);
      } catch (error) {
        return { status: error instanceof AiError ? error.status : 502, body: { error: error instanceof Error ? error.message : String(error) } };
      }
    }
  };
}
