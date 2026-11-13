// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import * as fs from "fs";
import * as path from "path";
import { ArticleCache } from "./cache";
import { Concept, statusOf } from "./learn";

// npm run learn:review — checks every concept against its Microsoft Learn article now, and lists what a
// person should look at (manual 7.4): an article whose date moved, or a quote that's no longer in it.
// Exits with 1 when something needs a look.

const ROOT = path.resolve(__dirname, "../..");

async function main(): Promise<void> {
  const concepts: Concept[] = JSON.parse(fs.readFileSync(path.join(ROOT, "content/concepts.json"), "utf8")).concepts;
  const cache = new ArticleCache(path.join(ROOT, "backend/.cache/learn"), fetch, 0);
  let review = 0;
  for (const c of concepts) {
    try {
      const { article, fetchedAt, source } = await cache.get(c.learn.url);
      const s = statusOf(c, article, source, fetchedAt);
      const problems = [s.dateChanged ? `article updated ${c.learn.date} → ${s.date}` : "", s.quoteFound ? "" : "quote not found"].filter(Boolean);
      if (problems.length) review++;
      console.log(`${problems.length ? "REVIEW" : "ok    "}  ${c.id.padEnd(18)} ${problems.join("; ")}${source === "cache" ? " (Learn not reached: cached copy)" : ""}`);
    } catch (e) {
      review++;
      console.log(`ERROR   ${c.id.padEnd(18)} ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(review ? `\n${review} concept(s) to review in content/concepts.json.` : "\nEvery quote is still in its article, and no article date moved.");
  process.exitCode = review ? 1 : 0;
}

void main();
