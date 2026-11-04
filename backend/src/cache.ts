// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Article, fetchArticle } from "./learn";

// Learn articles cached on disk (backend/.cache, not in git): fresh for a day, and used when Learn
// can't be reached, so explanations keep working offline (manual 7.4).

const DAY = 24 * 3600 * 1000;

interface Entry { article: Article; fetchedAt: string }

export class ArticleCache {
  constructor(private folder: string, private fetchImpl: typeof fetch = fetch, private maxAge = DAY) {
    fs.mkdirSync(folder, { recursive: true });
  }

  private file(url: string): string {
    return path.join(this.folder, `${createHash("sha1").update(url.split("#")[0]).digest("hex")}.json`);
  }

  private read(url: string): Entry | undefined {
    try { return JSON.parse(fs.readFileSync(this.file(url), "utf8")) as Entry; } catch { return undefined; }
  }

  async get(url: string, now = new Date()): Promise<{ article: Article; fetchedAt: string; source: "live" | "cache" }> {
    const cached = this.read(url);
    if (cached && now.getTime() - Date.parse(cached.fetchedAt) < this.maxAge) return { ...cached, source: "cache" };
    try {
      const article = await fetchArticle(url, this.fetchImpl);
      const entry: Entry = { article, fetchedAt: now.toISOString() };
      fs.writeFileSync(this.file(url), JSON.stringify(entry));
      return { ...entry, source: "live" };
    } catch (error) {
      if (cached) return { ...cached, source: "cache" };
      throw error;
    }
  }
}
