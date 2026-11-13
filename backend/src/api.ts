// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { chooseProvider } from "./ai/choose";
import { UsageLimits } from "./ai/limits";
import { AiError, AiProvider } from "./ai/provider";
import { answerAsCustomer, Attempt, MAX_ATTEMPTS, writeCaller, writeHint, writeScenarioAttempt } from "./ai/scenarios";
import { ArticleCache } from "./cache";
import { Classes, isLearnerId, sameSecret, Who } from "./classes";
import { KvStore } from "./kv";
import { Feedback } from "./feedback";
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
//   POST /feedback                     { type, message, name?, email?, context?, environment? }: anyone's feedback
//   GET  /admin/feedback               all feedback, newest first (role admin)
//   GET  /admin/feedback/<id>/environment   the environment sent with it (role admin)
//   POST /admin/feedback/<id>          { status?, note? }; POST /admin/feedback/<id>/delete (role admin)
//   GET  /ai/scenarios                the AI-written scenarios that passed every check
//   POST /ai/scenario                 { kind, level, previous? }: one try: the AI writes a scenario, code checks it (manual 8.3).
//                                     It answers the scenario, or the problems and the draft; the browser sends
//                                     earlier tries back as previous, up to 3 tries (each request under 45 seconds).
//   POST /ai/caller                   { dial }: the AI plays a caller on that line (manual 5.5)
//   POST /ai/interview                { scenario, talk, question }: the AI customer answers (manual 8.2)
//   POST /ai/hint                     { requirement, checks, concept }: a hint based on the concept's Learn passage
//   GET  /trainer                     whether creating a class needs the trainer passcode
//   POST /classes                     { name, scenarios, openUntil?, passcode? }: a trainer creates a class (manual 10)
//   GET  /classes/<code>              the class's name and exercises, while it's open
//   POST /classes/<code>/join         { learnerId, name }: a learner joins, while the class is open; answers their personal code
//   POST /classes/<code>/rejoin       { rejoinCode }: the same learner in another browser; answers their learner id
//   POST /classes/<code>/work         { scenarioId, data }: the learner's work on a class exercise (header X-Learner)
//   GET  /classes/<code>/work/<id>    that work, for the learner (header X-Learner)
//   GET  /classes/<code>/work/<learner>/<id>?key=   a learner's work, for the trainer (or /manage/classes/... signed in)
//   POST /classes/<code>/progress     a learner's progress on an exercise, while the class is open
//   GET  /classes/<code>/progress?key the class's progress, for its trainer
//   POST /classes/<code>/settings     { key, openUntil?, closed? }: the trainer sets an end date, or closes or reopens it
//   POST /classes/<code>/remove       { key, learnerId }: the trainer removes a learner and their progress
//   POST /classes/<code>/delete       { key }: the trainer deletes the class and all its progress
//   GET  /me                          who is signed in, and whether they're a trainer
// For a signed-in trainer (role "trainer"; Static Web Apps also only lets that role through, see
// public/staticwebapp.config.json), the same without the key, for the classes they own:
//   GET  /manage/classes              their classes
//   POST /manage/classes              { name, scenarios, openUntil? }: create a class they own
//   POST /manage/claim                { code, key }: add a class made with a trainer link to their list
//   GET  /manage/classes/<code>       the class's progress
//   POST /manage/classes/<code>/(settings|remove|delete)   as above, without the key
// POSTs are only taken from the training's own pages. AI requests carry the learner's random id
// (header X-Learner), for the per-learner limit.

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  origin?: string;
  learner?: string;
  // Who signed in, as Static Web Apps says (the x-ms-client-principal header), if anyone.
  user?: User;
  body(limit?: number): Promise<any>;
}

export interface User { id: string; name: string; roles: string[] }
export const TRAINER_ROLE = "trainer";
export const ADMIN_ROLE = "admin";

// Reads Static Web Apps' client principal: Base64 JSON with userId, userDetails and userRoles.
// Role names compare without capitals or stray spaces: "Trainer" or " admin" typed in Role management still count.
export function readPrincipal(header: string | null | undefined): User | undefined {
  if (!header) return undefined;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (typeof p?.userId !== "string" || !/^[\w-]{1,100}$/.test(p.userId)) return undefined;
    return { id: p.userId, name: String(p.userDetails ?? "").slice(0, 200), roles: Array.isArray(p.userRoles) ? p.userRoles.map((r: unknown) => String(r).trim().toLowerCase()).filter(Boolean) : [] };
  } catch {
    return undefined;
  }
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
const TRAINER_CLASSES_PER_DAY = 30;

const concepts = (): Concept[] => (conceptsJson as { concepts: Concept[] }).concepts;

export function createApi(o: ApiOptions) {
  const cache = new ArticleCache(o.cacheDir);
  const limits = new UsageLimits(o.store, o.settings.dailyLimit, o.settings.learnerLimit);
  const chosen = o.provider ? { provider: o.provider, off: undefined } : chooseProvider(o.settings);
  const classes = new Classes(o.store);
  const feedback = new Feedback(o.store);
  const admin = (r: ApiRequest): User => {
    if (!r.user) throw new AiError("Sign in first.", 401);
    if (!r.user.roles.includes(ADMIN_ROLE)) throw new AiError("You're signed in, but not as an admin. Ask whoever runs the training for an admin invitation.", 403);
    return r.user;
  };

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

  // A few classes a day, counted per browser, or per trainer when signed in.
  const countClass = async (who: string, max: number) => {
    const key = `${new Date().toISOString().slice(0, 10)}:classes:${who}`;
    const made = (await o.store.get<number>("usage", key)) ?? 0;
    if (made >= max) throw new AiError(`You've created ${max} classes today. Try again tomorrow.`, 429);
    return () => o.store.put("usage", key, made + 1);
  };

  const trainer = (r: ApiRequest): User => {
    if (!r.user) throw new AiError("Sign in as a trainer first.", 401);
    if (!r.user.roles.includes(TRAINER_ROLE)) throw new AiError("You're signed in, but not as a trainer. Ask whoever runs the training for a trainer invitation.", 403);
    return r.user;
  };

  // The trainer's changes to a class: with its key, or as its owner.
  const manageClass = async (code: string, action: string, who: Who, body: any): Promise<ApiResponse> => {
    const ok = (b: unknown): ApiResponse => ({ status: 200, body: b });
    if (action === "settings") return ok(await classes.update(code, who, { ...("openUntil" in (body ?? {}) ? { openUntil: body.openUntil } : {}), closed: body?.closed }));
    if (action === "remove") { await classes.removeLearner(code, who, body?.learnerId); return ok({ removed: true }); }
    await classes.delete(code, who);
    return ok({ deleted: true });
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
      if (p === "/trainer") return ok({ passcodeRequired: !!o.settings.trainerPasscode });
      if (p === "/me") return ok(r.user ? { signedIn: true, name: r.user.name, trainer: r.user.roles.includes(TRAINER_ROLE), admin: r.user.roles.includes(ADMIN_ROLE) } : { signedIn: false, trainer: false, admin: false });
      if (p === "/admin/feedback") { admin(r); return ok({ feedback: await feedback.list() }); }
      const fbEnvironment = p.match(/^\/admin\/feedback\/([\w-]+)\/environment$/);
      if (fbEnvironment) { admin(r); return ok(await feedback.environment(fbEnvironment[1])); }
      if (p === "/manage/classes") return ok({ classes: await classes.ownedBy(trainer(r).id) });
      const theirs = p.match(/^\/manage\/classes\/(\w+)\/work\/(\w+)\/([\w-]+)$/);
      if (theirs) return ok(await classes.learnerWork(theirs[1], { owner: trainer(r).id }, theirs[2], theirs[3]));
      const theirsByKey = p.match(/^\/classes\/(\w+)\/work\/(\w+)\/([\w-]+)$/);
      if (theirsByKey) return ok(await classes.learnerWork(theirsByKey[1], { key: r.query.get("key") }, theirsByKey[2], theirsByKey[3]));
      const mine = p.match(/^\/manage\/classes\/(\w+)$/);
      if (mine) return ok(await classes.progress(mine[1], { owner: trainer(r).id }));
      const cls = p.match(/^\/classes\/(\w+)$/);
      if (cls) return ok(await classes.get(cls[1]));
      const prog = p.match(/^\/classes\/(\w+)\/progress$/);
      if (prog) return ok(await classes.progress(prog[1], { key: r.query.get("key") }));
      const work = p.match(/^\/classes\/(\w+)\/work\/([\w-]+)$/);
      if (work) return ok(await classes.work(work[1], r.learner, work[2]));
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
        // With TRAINER_PASSCODE set, only people who have the passcode may.
        if (!isLearnerId(r.learner)) throw new AiError("The training didn't say who's asking.", 400);
        const { name, scenarios: list, openUntil, passcode } = await r.body();
        if (o.settings.trainerPasscode && !sameSecret(passcode, o.settings.trainerPasscode)) throw new AiError("That isn't the trainer passcode. Ask whoever runs the training for it.", 403);
        const counted = await countClass(r.learner, CLASSES_PER_DAY);
        const created = await classes.create(name, list, openUntil);
        await counted();
        return ok(created);
      }
      if (p === "/manage/classes") {
        const me = trainer(r);
        const { name, scenarios: list, openUntil } = await r.body();
        const counted = await countClass(me.id, TRAINER_CLASSES_PER_DAY);
        const created = await classes.create(name, list, openUntil, me.id);
        await counted();
        return ok(created);
      }
      if (p === "/feedback") return ok(await feedback.submit(r.learner, await r.body(50_000)));
      const fbDelete = p.match(/^\/admin\/feedback\/([\w-]+)\/delete$/);
      if (fbDelete) { admin(r); await feedback.remove(fbDelete[1]); return ok({ deleted: true }); }
      const fbChange = p.match(/^\/admin\/feedback\/([\w-]+)$/);
      if (fbChange) { admin(r); return ok(await feedback.update(fbChange[1], await r.body())); }
      if (p === "/manage/claim") {
        const me = trainer(r);
        const { code, key } = await r.body();
        return ok(await classes.claim(String(code ?? ""), key, me.id));
      }
      const mineAction = p.match(/^\/manage\/classes\/(\w+)\/(settings|remove|delete)$/);
      if (mineAction) return manageClass(mineAction[1], mineAction[2], { owner: trainer(r).id }, await r.body());
      const joined = p.match(/^\/classes\/(\w+)\/join$/);
      if (joined) return ok(await classes.join(joined[1], await r.body()));
      const rejoined = p.match(/^\/classes\/(\w+)\/rejoin$/);
      if (rejoined) return ok(await classes.rejoin(rejoined[1], (await r.body())?.rejoinCode));
      const saving = p.match(/^\/classes\/(\w+)\/work$/);
      if (saving) {
        const { scenarioId, data } = await r.body(40_000);
        await classes.saveWork(saving[1], r.learner, scenarioId, data);
        return ok({ saved: true });
      }
      const prog = p.match(/^\/classes\/(\w+)\/progress$/);
      if (prog) { await classes.report(prog[1], await r.body(50_000)); return ok({ saved: true }); }
      const manage = p.match(/^\/classes\/(\w+)\/(settings|remove|delete)$/);
      if (manage) {
        const body = await r.body();
        return manageClass(manage[1], manage[2], { key: body?.key }, body);
      }
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
