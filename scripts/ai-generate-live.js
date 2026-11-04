// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Has the hosted training's AI write scenarios, the way the browser's "Write a new one with AI" does: one
// try per request (each under the 45-second limit), earlier tries sent back with what failed in them, up to
// three. The hosted backend checks every try (manual 8.3) and keeps the ones that pass, so learners see them
// at once. A copy of each goes to content/scenarios/generated/ for a person to look at.
//
//   node scripts/ai-generate-live.js <site address> [count]
//
// Every try counts towards the site's AI limits (AI_DAILY_LIMIT; AI_LEARNER_LIMIT for this script's own
// learner id, like any learner).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const [site, countArg = "10"] = process.argv.slice(2);
if (!site || !/^https:\/\//.test(site)) { console.error("Give the site's address: node scripts/ai-generate-live.js https://<name>.azurestaticapps.net [count]"); process.exit(1); }
const base = site.replace(/\/+$/, "");
const count = Number(countArg);
const learner = crypto.randomBytes(16).toString("hex");
const out = path.join(__dirname, "../content/scenarios/generated");
// Every kind and level (src/scenarios/scenario.ts LEVELS), in turn.
const plan = [["fix", 1], ["fix", 2], ["route", 1], ["route", 2], ["route", 3], ["build", 1], ["build", 2], ["build", 3], ["build", 4], ["build", 5], ["interview", 2], ["interview", 4]];

async function attempt(kind, level, previous) {
  const res = await fetch(`${base}/api/ai/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, "X-Learner": learner },
    body: JSON.stringify({ kind, level, previous })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The site answered ${res.status}.`);
  return body;
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  let passed = 0, tries = 0;
  for (let i = 0; i < count; i++) {
    const [kind, level] = plan[i % plan.length];
    const previous = [];
    try {
      for (;;) {
        const started = Date.now();
        const r = await attempt(kind, level, previous);
        tries++;
        const secs = ((Date.now() - started) / 1000).toFixed(0);
        if (r.scenario) {
          passed++;
          fs.writeFileSync(path.join(out, `${r.scenario.id}.json`), JSON.stringify(r.scenario, null, 2) + "\n");
          console.log(`pass  ${kind} level ${level}  “${r.scenario.title}” (try ${r.attempt}, ${secs} s)`);
          break;
        }
        console.log(`      ${kind} level ${level}  try ${r.attempt} failed (${secs} s): ${r.problems.join(" | ")}`);
        previous.push({ text: r.text, problems: r.problems });
        if (previous.length >= r.maxAttempts) { console.log(`drop  ${kind} level ${level}`); break; }
      }
    } catch (e) {
      console.log(`error ${kind} level ${level}  ${e.message}`);
      if (/limit/.test(e.message)) break;
    }
  }
  console.log(`\n${passed} of ${count} scenarios passed every check, in ${tries} AI requests. Copies in content/scenarios/generated.`);
  process.exit(passed === count ? 0 : 1);
}

main();
