// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Phase 4: explanations from Microsoft Learn. The backend's pure parts (no network), the cache's offline
// fallback, and every Diagram shape kind having an explanation.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { KINDS, NodeKind } from "@toolbox/environment-3d-explorer/src/model";
import { ArticleCache } from "../../backend/src/cache";
import { isLearnUrl, parseArticle, plain, quoteFound, statusOf } from "../../backend/src/learn";
import { conceptForRecord, recordLink } from "../../src/learn/records";
import { createSimulator } from "../../src/simulator";
import conceptsJson from "../../content/concepts.json";

const ARTICLE = `---
title: Create and manage queues for unified routing | Microsoft Learn
ms.date: 2026-07-22T00:00:00.0000000Z
---
# Create and manage queues

- **Voice**: To route calls made to support phone numbers listed on the customer portal.

The queue types allow issues to be routed correctly and help avoid cross-queue assignments.

1. In the site map of Copilot Service admin center, select **Queues** in **Customer support**.
2. On the **Queues** page, select **Manage** for [Advanced queues](link).
`;

describe("reading a Learn article", () => {
  test("title and date come from the front matter", () => {
    const a = parseArticle("https://learn.microsoft.com/x", ARTICLE);
    expect(a.title).toBe("Create and manage queues for unified routing");
    expect(a.date).toBe("2026-07-22");
  });

  test("quotes match whatever the article's formatting, and skipped text is marked with …", () => {
    const text = parseArticle("u", ARTICLE).text;
    expect(plain("**Voice**: To route")).toBe("voice: to route");
    expect(quoteFound(text, "Voice: To route calls made to support phone numbers listed on the customer portal.")).toBe(true);
    expect(quoteFound(text, "In the site map of Copilot Service admin center, select Queues in Customer support. On the Queues page, select Manage for Advanced queues.")).toBe(true);
    expect(quoteFound(text, "Voice: To route calls … help avoid cross-queue assignments.")).toBe(true);
    expect(quoteFound(text, "help avoid cross-queue assignments. … Voice: To route calls")).toBe(false); // parts out of order
    expect(quoteFound(text, "Voice: To route chats")).toBe(false);
  });

  test("only Microsoft Learn is fetched", () => {
    expect(isLearnUrl("https://learn.microsoft.com/en-us/dynamics365/x")).toBe(true);
    expect(isLearnUrl("http://learn.microsoft.com/x")).toBe(false);
    expect(isLearnUrl("https://learn.microsoft.com.evil.example/x")).toBe(false);
    expect(isLearnUrl("not a url")).toBe(false);
  });

  test("a moved date or a missing quote shows in the status", () => {
    const concept = { id: "queue-type", title: "Queue type", learn: { title: "t", url: "u", date: "2026-07-01", checkedOn: "2026-07-02", quote: "Voice: To route calls" } };
    const s = statusOf(concept, parseArticle("u", ARTICLE), "live", "2026-11-03T00:00:00Z");
    expect(s).toMatchObject({ dateChanged: true, date: "2026-07-22", quoteFound: true });
  });
});

describe("the article cache", () => {
  const url = "https://learn.microsoft.com/en-us/test";
  const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "learn-cache-"));
  const ok = (async () => new Response(ARTICLE, { status: 200 })) as unknown as typeof fetch;
  const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;

  test("fetches, then serves from the cache while it's fresh", async () => {
    const dir = folder();
    const first = await new ArticleCache(dir, ok).get(url, new Date("2026-11-03T08:00:00Z"));
    expect(first.source).toBe("live");
    const again = await new ArticleCache(dir, offline).get(url, new Date("2026-11-03T09:00:00Z"));
    expect(again).toMatchObject({ source: "cache", article: { date: "2026-07-22" } });
  });

  test("uses an old copy when Learn can't be reached, and says so", async () => {
    const dir = folder();
    await new ArticleCache(dir, ok).get(url, new Date("2026-11-01T08:00:00Z"));
    const later = await new ArticleCache(dir, offline).get(url, new Date("2026-11-03T08:00:00Z"));
    expect(later.source).toBe("cache");
  });

  test("without a copy and without Learn, it fails clearly", async () => {
    await expect(new ArticleCache(folder(), offline).get(url)).rejects.toThrow("offline");
  });
});

describe("explanations for the Diagram", () => {
  const concepts = conceptsJson.concepts as { id: string; kind?: string; learn: { url: string; date: string; checkedOn: string; quote: string } }[];

  test("every shape kind of the Diagram has one explanation", () => {
    for (const kind of Object.keys(KINDS) as NodeKind[]) expect(concepts.filter((c) => c.kind === kind).map((c) => c.id)).toHaveLength(1);
  });

  test("every explanation quotes Learn, with its link and dates", () => {
    for (const c of concepts) {
      expect(isLearnUrl(c.learn.url)).toBe(true);
      expect(c.learn.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.learn.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.learn.quote.length).toBeGreaterThan(30);
    }
  });

  test("a shape's Open record link leads to its explanation", () => {
    const store = createSimulator().store;
    const queue = store.table("queue")[0].queueid;
    const bot = store.table("systemuser").find((u) => u.accessmode === 4)!.systemuserid;
    const person = store.table("systemuser").find((u) => u.accessmode === 0)!.systemuserid;
    const link = (etn: string, id: string) => recordLink(`https://contoso.simulated.example/main.aspx?pagetype=entityrecord&etn=${etn}&id=${id}`)!;
    expect(conceptForRecord(store, link("queue", queue))).toBe("queue");
    expect(conceptForRecord(store, link("systemuser", bot))).toBe("ai-agent");
    expect(conceptForRecord(store, link("systemuser", person))).toBe("representative");
    expect(conceptForRecord(store, link("msdyn_ocphonenumber", "x"))).toBe("phone-number");
    expect(conceptForRecord(store, link("nosuchtable", "x"))).toBeUndefined();
  });
});
