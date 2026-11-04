// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Plays one "Fix the broken contact center" and one "Where does this call go?" scenario in a real browser,
// the way a learner would, and saves a screenshot of each step. Proves both exercise kinds can be
// finished and graded in the browser (manual, phase 5). Uses the ready-made scenarios, so it runs with
// the AI switched off. Serve the build first (npm run serve), then:
//   node scripts/scenarios.js <screenshot folder> [port]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [out = "walkthrough/scenarios", port = "5480"] = process.argv.slice(2);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/localhost:7071/.test(m.text())) errors.push(m.text().slice(0, 600)); });
  let n = 0, last = "";
  const shot = async (name) => { await new Promise((r) => setTimeout(r, 400)); await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`) }); console.log(`step ${n}: ${name}`); };
  const click = async (selector, text) => {
    last = `click ${selector} "${text}"`;
    await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => [t, t + t].includes(e.textContent.trim())), { timeout: 10000 }, selector, text);
    for (const h of await page.$$(selector)) {
      if (![text, text + text].includes(await h.evaluate((e) => e.textContent.trim()))) continue;
      if (await h.evaluate((e) => e.disabled || e.offsetParent === null)) continue;
      await h.click();
      return;
    }
    throw new Error(`nothing clickable: ${selector} "${text}"`);
  };
  const waitText = (selector, text) => { last = `${selector} "${text}"`; return page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 10000 }, selector, text); };
  const choose = async (title) => {
    await click(".training-env button", "Choose an exercise");
    await page.waitForSelector(".picker");
    await click(".picker-item span", title);
    await waitText(".lesson-title", title);
  };

  try {
    await page.goto(`http://localhost:${port}/?seed=1`, { waitUntil: "networkidle0" });
    await click(".training-env button", "Choose an exercise");
    await page.waitForSelector(".picker");
    await shot("choose-an-exercise");
    await page.keyboard.press("Escape");

    // ---- Fix the broken contact center: "Monday morning, and nobody answers" ----
    await choose("Monday morning, and nobody answers");
    await waitText(".lesson-tasks", "Problem 2: not fixed yet");
    await new Promise((r) => setTimeout(r, 6000)); // the Diagram loads
    await shot("fix-start-diagram");
    await click(".lesson-actions button", "Hint");
    await shot("fix-hint");

    // Billing has no members: Queues › Manage › Billing › Add users.
    await click("[role=tab]", "Admin center");
    await click(".admin-nav", "Queues");
    await click(".admin-main button", "Manage");
    await click(".admin-main button", "Billing");
    await click(".admin-main button", "+ Add users");
    await page.waitForSelector("[role=dialog] input[type=checkbox]");
    const boxes = await page.$$("[role=dialog] input[type=checkbox]");
    await boxes[0].click();
    await boxes[1].click();
    await click(".admin-drawer-actions button", "Add");
    await waitText(".lesson-tasks li.done", "Billing");
    await shot("fix-billing-has-users");

    // Retail Sales' fallback queue was switched off: Workstreams › Retail Sales – Voice › Fallback queue › Edit.
    await click(".admin-nav", "Workstreams");
    await click(".admin-main button", "Retail Sales – Voice");
    await shot("fix-fallback-queue-off");
    await click(".admin-main button", "Edit");
    await (await page.waitForSelector(".admin-main [aria-label='Fallback queue']")).click();
    await click("[role=option]", "Overflow");
    await page.waitForSelector(".lesson-finished");
    await shot("fix-all-fixed");

    // ---- Where does this call go?: "Late calls and long waits" ----
    await choose("Late calls and long waits");
    await shot("route-start");
    const calls = await page.$$eval(".lesson-tasks > li", (l) => l.length);
    for (let i = 0; i < calls; i++) {
      const item = (await page.$$(".lesson-tasks > li"))[i];
      // Pick the first choice each time: some right, some wrong, both graded by the call engine.
      await (await item.$("input[type=radio]")).click();
      await (await item.$(".lesson-actions button")).click();
      await page.waitForFunction((j) => /done|missed/.test(document.querySelectorAll(".lesson-tasks > li")[j].className), { timeout: 10000 }, i);
      if (i === 0) await shot("route-first-answer");
    }
    await page.waitForSelector(".lesson-finished");
    await shot("route-graded");
    console.log(`route grade: ${await page.$eval(".lesson-finished strong", (e) => e.textContent)}`);

    // The phone with a time: a sales call at 22:00 goes to voicemail.
    await click("[role=tab]", "Phone");
    await page.select(".phone-time select", "2");
    // A time field: hours, minutes, then AM/PM.
    await (await page.$(".phone-time input")).click();
    await page.keyboard.type("1000P");
    await click(".phone-ivr label", "Sales");
    await click(".phone-pad button", "Call");
    await waitText(".phone-badge", "voicemail");
    await shot("phone-after-hours");
  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
  }
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
