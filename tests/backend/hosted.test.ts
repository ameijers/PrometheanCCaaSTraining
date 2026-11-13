// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The hosted backend (phase 9) without Azure: the Functions entry hands /api/* to the same handler, only
// the site's own pages may write, and the Table Storage store keeps values the way the backend expects.
// @azure/functions and @azure/data-tables are replaced by small stand-ins.

const registered: { options?: any } = {};
jest.mock("@azure/functions", () => ({ app: { http: (_name: string, options: any) => { registered.options = options; } } }));

const rows = new Map<string, { partitionKey: string; rowKey: string; value: string }>();
jest.mock("@azure/data-tables", () => ({
  TableClient: {
    fromConnectionString: () => ({
      createTable: async () => undefined,
      getEntity: async (p: string, k: string) => { const r = rows.get(`${p}|${k}`); if (!r) throw Object.assign(new Error("Not found"), { statusCode: 404 }); return r; },
      upsertEntity: async (e: any) => { rows.set(`${e.partitionKey}|${e.rowKey}`, e); },
      deleteEntity: async (p: string, k: string) => { if (!rows.delete(`${p}|${k}`)) throw Object.assign(new Error("Not found"), { statusCode: 404 }); },
      listEntities: (o: any) => {
        const p = /PartitionKey eq '([^']+)'/.exec(o.queryOptions.filter)![1];
        return (async function* () { for (const r of rows.values()) if (r.partitionKey === p) yield r; })();
      }
    })
  }
}));

process.env.SITE_ORIGIN = "https://training.example/";
process.env.STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("../../backend/src/functions");
import { TableStore } from "../../backend/src/tableStore";
import { FileStore } from "../../backend/src/kv";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const call = (method: string, url: string, body?: unknown, origin?: string, extra: Record<string, string> = {}) => registered.options.handler({
  method, url, query: new URL(url).searchParams,
  headers: new Headers({ "x-learner": "e".repeat(32), ...(origin ? { origin } : {}), ...extra }),
  text: async () => (body === undefined ? "" : JSON.stringify(body))
});

test("the function registers one route for everything under /api, for anyone", () => {
  expect(registered.options).toMatchObject({ route: "{*path}", authLevel: "anonymous", methods: ["GET", "POST", "OPTIONS"] });
});

test("/api/<path> reaches the handler, and a class lives in Table Storage", async () => {
  expect(await call("GET", "https://training.example/api/health")).toMatchObject({ status: 200, jsonBody: { ok: true } });
  const created = await call("POST", "https://training.example/api/classes", { name: "Hosted class", scenarios: ["route-1-first-day"] }, "https://training.example");
  expect(created.status).toBe(200);
  const read = await call("GET", `https://training.example/api/classes/${created.jsonBody.code}`);
  expect(read.jsonBody).toEqual({ code: created.jsonBody.code, name: "Hosted class", scenarios: ["route-1-first-day"] });
  expect([...rows.values()].some((r) => r.partitionKey === "class" && r.rowKey === created.jsonBody.code)).toBe(true);
});

test("who signed in comes from Static Web Apps' header, not from the local stand-in", async () => {
  const principal = Buffer.from(JSON.stringify({ identityProvider: "aad", userId: "u1", userDetails: "ann@contoso.example", userRoles: ["anonymous", "authenticated", "trainer"] })).toString("base64");
  expect((await call("GET", "https://training.example/api/me", undefined, undefined, { "x-ms-client-principal": principal })).jsonBody).toEqual({ signedIn: true, name: "ann@contoso.example", trainer: true, admin: false });
  expect((await call("GET", "https://training.example/api/me", undefined, undefined, { "x-dev-principal": principal })).jsonBody).toEqual({ signedIn: false, trainer: false, admin: false });
});

test("only the site's own pages may write, and bad JSON is refused", async () => {
  expect((await call("POST", "https://training.example/api/classes", { name: "x", scenarios: ["a"] }, "https://evil.example")).status).toBe(403);
  const bad = await registered.options.handler({ method: "POST", url: "https://training.example/api/classes", query: new URLSearchParams(), headers: new Headers({ origin: "https://training.example", "x-learner": "e".repeat(32) }), text: async () => "{nope" });
  expect(bad).toMatchObject({ status: 400, jsonBody: { error: "The request is not valid JSON." } });
});

test("the Table Storage store gets, puts, lists by partition and removes", async () => {
  const store = new TableStore("UseDevelopmentStorage=true");
  expect(await store.get("counts", "2026-11-03")).toBeUndefined();
  await store.put("counts", "2026-11-03", 4);
  await store.put("counts", "2026-11-04", 1);
  expect(await store.get("counts", "2026-11-03")).toBe(4);
  expect((await store.list<number>("counts")).map((r) => r.key).sort()).toEqual(["2026-11-03", "2026-11-04"]);
  await expect(store.put("bad partition", "k", 1)).rejects.toThrow(/Not a valid key/);
  await store.remove("counts", "2026-11-03");
  await store.remove("counts", "2026-11-03"); // already gone: nothing happens
  expect((await store.list<number>("counts")).map((r) => r.key)).toEqual(["2026-11-04"]);
});

test("the file store removes too", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kv-"));
  const store = new FileStore(dir);
  await store.put("class", "ABCDEF", { name: "A" });
  await store.put("class", "GHJKLM", { name: "B" });
  await store.remove("class", "ABCDEF");
  await store.remove("class", "NOPQRS");
  expect((await store.list("class")).map((r) => r.key)).toEqual(["GHJKLM"]);
});
