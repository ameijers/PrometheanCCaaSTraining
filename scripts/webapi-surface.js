// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Writes docs/webapi-surface.md: every Web API call in the Toolbox (vendor/toolbox/tools/*/src), per
// tool, with the line, the method, the table and the query as written in the code.
// Run after moving the submodule:  npm run surface

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TOOLS = path.join(ROOT, "vendor/toolbox/tools");
const OUT = path.join(ROOT, "docs/webapi-surface.md");

const CALL = /\b(readAll|readByIds|readByIdBatches|readSelect|read|retrieveMultipleRecords|retrieveRecord|createRecord|updateRecord|deleteRecord|send|post|getJson|fetch)\(/g;
// Helper definitions and calls that pass their arguments straight on aren't calls to list.
const SKIP = /^\s*(export\s+)?(async\s+)?function\b|^\s*\/\/|^\s*\*/;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

function args(line, start) {
  let depth = 0, i = start, quote = null;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote && line[i - 1] !== "\\") quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") { if (depth === 0) break; depth--; }
  }
  return line.slice(start, i);
}

const md = (text) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const short = (text, n = 220) => (text.length > n ? `${text.slice(0, n)}…` : text);

const sections = [];
let total = 0;
for (const tool of fs.readdirSync(TOOLS).sort()) {
  const src = path.join(TOOLS, tool, "src");
  if (!fs.existsSync(src)) continue;
  const rows = [];
  for (const file of files(src)) {
    if (/demo|\.test\./i.test(path.basename(file))) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, n) => {
      if (SKIP.test(line)) return;
      for (const m of line.matchAll(CALL)) {
        const method = m[1];
        const a = args(line, m.index + m[0].length);
        // "fetch" and the small send/post helpers only count when they reach the Web API.
        if (["fetch", "send", "post", "getJson", "read"].includes(method) && !/api\/data|\$|\?|ENTITY_SET|\(\$\{|"(POST|PATCH|DELETE)"/.test(a)) continue;
        if (method === "read" && !/^"/.test(a)) continue;
        rows.push(`| ${path.relative(path.join(TOOLS, tool), file).replace(/\\/g, "/")}:${n + 1} | ${method} | ${md(short(a))} |`);
      }
    });
  }
  if (!rows.length) continue;
  total += rows.length;
  sections.push(`### ${tool}\n\n| Where | Call | Arguments, as written |\n| --- | --- | --- |\n${rows.join("\n")}\n`);
}

const header = fs.readFileSync(path.join(__dirname, "webapi-surface.header.md"), "utf8");
const commit = (() => {
  try {
    return require("child_process").execFileSync("git", ["-C", path.join(ROOT, "vendor/toolbox"), "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch { return "unknown"; }
})();
fs.writeFileSync(OUT, `${header.replace("{{COMMIT}}", commit).replace("{{TOTAL}}", String(total))}\n## Every call, per tool\n\n${sections.join("\n")}`);
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${total} calls.`);
