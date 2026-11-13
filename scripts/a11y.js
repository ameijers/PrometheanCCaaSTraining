// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The accessibility check of phase 9: runs axe-core (the open-source checker) on each main screen in Edge
// and lists what it finds, worst first. Serve the build first (npm run serve).
//   node scripts/a11y.js [port]
// Exits with 1 when something serious or critical is found.

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [port = "5480"] = process.argv.slice(2);
const AXE = require.resolve("axe-core/axe.min.js");

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  const found = new Map();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = (selector, text) => page.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t))?.click(), selector, text);
  const check = async (screen) => {
    await page.addScriptTag({ path: AXE });
    // Left out on purpose:
    // - the Diagram: the Toolbox's own page, in an iframe; it's checked in the Toolbox;
    // - Fluent UI's focus helpers (Tabster's DummyInput, <i data-tabster-dummy>): hidden, and focusable on
    //   purpose to keep keyboard focus inside dialogs and lists. They're the component library's, not our pages'.
    const result = await page.evaluate(() => window.axe.run({ exclude: [["iframe"], ["[data-tabster-dummy]"]] }, { resultTypes: ["violations"] }));
    for (const v of result.violations) {
      const key = v.id;
      const entry = found.get(key) ?? { impact: v.impact, help: v.help, screens: new Set(), nodes: [] };
      entry.screens.add(screen);
      entry.nodes.push(...v.nodes.slice(0, 3).map((n) => `${screen}: ${n.target.join(" ")}`));
      found.set(key, entry);
    }
    console.log(`checked: ${screen}`);
  };

  await page.goto(`http://localhost:${port}/?seed=1#phone`, { waitUntil: "networkidle0" });
  await check("lesson and phone");
  await clickText("[role=tab]", "Admin center"); await wait(800);
  await check("admin center: workstreams");
  await clickText(".admin-nav", "Queues"); await wait(300); await clickText(".admin-main button", "Manage"); await wait(300); await clickText(".admin-main button", "Billing"); await wait(800);
  await check("admin center: a queue");
  await clickText(".admin-main button", "Edit"); await wait(800);
  await check("admin center: overflow handling");
  await clickText(".admin-nav", "Channels"); await wait(300); await clickText(".admin-main button", "Manage"); await wait(800);
  await check("admin center: phone numbers");
  await clickText(".admin-nav", "User management"); await wait(300); await clickText(".admin-main button", "Manage"); await wait(800);
  await check("admin center: capacity profiles");
  await clickText("[role=tab]", "Agent"); await wait(800);
  await check("agent view");
  await clickText(".training-env button", "Labs and practice"); await wait(800);
  await check("choose an exercise");
  await clickText(".picker-item span", "Late calls and long waits"); await wait(2000);
  await check("where does this call go");
  await clickText(".training-env button", "Labs and practice"); await wait(800);
  await clickText(".picker-item span", "What does the service manager need?"); await wait(2000);
  await check("customer interview");
  await clickText(".training-env button", "Labs and practice"); await wait(800);
  await clickText("[role=dialog] button", "For trainers"); await wait(800);
  await check("trainer: sign in");
  await browser.close();

  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const list = [...found.entries()].sort((a, b) => order[a[1].impact] - order[b[1].impact]);
  if (!list.length) { console.log("\nNo accessibility problems found."); return; }
  console.log("");
  for (const [id, v] of list) console.log(`${v.impact.toUpperCase()}  ${id}: ${v.help}\n  on: ${[...v.screens].join(", ")}\n  ${v.nodes.slice(0, 4).join("\n  ")}`);
  process.exit(list.some(([, v]) => v.impact === "critical" || v.impact === "serious") ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
