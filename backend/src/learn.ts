// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Microsoft Learn, read by the backend (manual 7): an article's text and its own date, and whether a
// passage the training quotes is still in it. Learn serves an article as Markdown when asked with
// "Accept: text/markdown", with its date in the front matter (ms.date). See docs/learn-source.md.
// Pure functions plus one fetch, so they test without the network and can move into a Function as they are.

export interface Article {
  url: string;
  title: string;
  // The article's own date (ms.date), as YYYY-MM-DD.
  date?: string;
  text: string;
}

export interface Concept {
  id: string;
  title: string;
  kind?: string;
  learn: { title: string; url: string; date: string; checkedOn: string; quote: string };
}

export interface ConceptStatus {
  id: string;
  url: string;
  // The article's date now, and whether it moved since the concept was checked.
  date?: string;
  dateChanged: boolean;
  // Whether the quoted passage is still in the article, word for word (ignoring formatting).
  quoteFound: boolean;
  // "live": fetched now; "cache": from the backend's cache (Learn not reached, or fetched recently).
  source: "live" | "cache";
  fetchedAt: string;
}

// Only Learn: the backend never fetches anything else.
export function isLearnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "learn.microsoft.com";
  } catch {
    return false;
  }
}

export function parseArticle(url: string, markdown: string): Article {
  const front = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = front ? front[1] : "";
  const title = (meta.match(/^title:\s*(.+)$/m)?.[1] ?? "").replace(/\s*\|\s*Microsoft Learn\s*$/, "").trim();
  const date = meta.match(/^ms\.date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
  return { url, title, date, text: front ? markdown.slice(front[0].length) : markdown };
}

// Text without Markdown formatting, so a quote matches however the article formats it.
export function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")          // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")         // links: keep the text
    .replace(/[*_`]/g, "")                           // emphasis and code marks: "**Voice**:" reads "Voice:"
    .replace(/[#>]/g, " ")                           // headings, block quotes
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, " ")          // list bullets and step numbers
    .replace(/[‘’]/g, "'").replace(/[“”]/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A quote may skip text with "…"; every part must be in the article, in order.
export function quoteFound(articleText: string, quote: string): boolean {
  const text = plain(articleText);
  let from = 0;
  for (const part of quote.split("…").map(plain).filter(Boolean)) {
    const at = text.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

export async function fetchArticle(url: string, fetchImpl: typeof fetch = fetch): Promise<Article> {
  if (!isLearnUrl(url)) throw new Error(`Not a Microsoft Learn address: ${url}`);
  const response = await fetchImpl(url.split("#")[0], { headers: { Accept: "text/markdown" }, redirect: "follow" });
  if (!response.ok) throw new Error(`Microsoft Learn answered ${response.status} for ${url}`);
  return parseArticle(url, await response.text());
}

export function statusOf(concept: Concept, article: Article, source: ConceptStatus["source"], fetchedAt: string): ConceptStatus {
  return {
    id: concept.id, url: concept.learn.url, date: article.date,
    dateChanged: !!article.date && article.date !== concept.learn.date,
    quoteFound: quoteFound(article.text, concept.learn.quote),
    source, fetchedAt
  };
}
