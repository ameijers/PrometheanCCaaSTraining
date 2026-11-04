// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Plays the first lesson in a real browser, the way a learner would (clicking, typing), and saves a
// screenshot of each step. Proves the lesson can be finished in the browser (manual, phase 3).
// Serve the build first (npm run serve), then:  node scripts/walkthrough.js <screenshot folder> [port] [variant seed]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [out = "walkthrough", port = "5480", seed = "1"] = process.argv.slice(2);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 600)); });
  let n = 0;
  const shot = async (name) => { await new Promise((r) => setTimeout(r, 300)); await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`) }); console.log(`step ${n}: ${name}`); };

  // Clicks the element matching the selector whose own text is exactly this.
  const click = async (selector, text) => {
    last = `click ${selector} "${text}"`;
    await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => [t, t + t].includes(e.textContent.trim())), { timeout: 10000 }, selector, text);
    const handles = await page.$$(selector);
    // The first match that can be clicked (Fluent keeps some hidden copies, and disabled buttons).
    for (const h of handles) {
      if (![text, text + text].includes(await h.evaluate((e) => e.textContent.trim()))) continue;
      if (await h.evaluate((e) => e.disabled || e.offsetParent === null)) continue;
      await h.click();
      return;
    }
    throw new Error(`nothing clickable: ${selector} "${text}"`);
  };
  let last = "";
  const waitText = (selector, text) => (last = `${selector} "${text}"`, 0) || page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 10000 }, selector, text);
  const doneCount = () => page.$$eval(".lesson-tasks li.done", (l) => l.length);

  try {
  // The lesson is a template: read what this run picked.
  await page.goto(`http://localhost:${port}/?seed=${seed}#phone`, { waitUntil: "networkidle0" });
  await waitText(".phone-says", "What is your call about?");
  const { choice, workstream, variable } = await page.evaluate(() => {
    const l = window.__ccaasTraining.lesson;
    return { choice: l.variant.choice, workstream: l.variant.workstream, variable: l.line.ivr.variable };
  });
  const slip = choice.slice(0, -1); // a typing slip: one letter missing
  console.log(`variant ${seed}: ${choice} on ${workstream} (slips: "${slip}")`);
  await shot("start");

  // 1. Call and choose the new option: it ends in the fallback queue.
  await click(".phone-ivr label", choice);
  await click(".phone-pad button", "Call");
  await waitText(".phone-badge", "Waiting in Overflow");
  await waitText(".lesson-tasks li.done", "Call the line");
  await shot("new-choice-goes-to-overflow");

  // 2. Create the voice queue: Queues › Advanced queues (Manage) › New queue.
  await click("[role=tab]", "Admin center");
  await click(".admin-nav", "Queues");
  await click(".admin-main button", "Manage");
  await click(".admin-main button", "+ New queue");
  await page.waitForSelector("[role=dialog] input");
  const fields = await page.$$("[role=dialog] input");
  await fields[0].type(slip); // a slip in the name: it counts, with a note
  await fields[1].type("1");
  await (await page.$("[role=dialog] [role=combobox]")).click();
  await click("[role=option]", "Voice");
  await shot("create-a-queue");
  await click("[role=dialog] button", "Create");
  await waitText(".admin-title", slip);
  await waitText(".lesson-tasks li.done", "Create a voice queue");
  await waitText(".lesson-note", "That's fine");

  // 3. Add two users: Add users, tick two, Add.
  await click(".admin-main button", "+ Add users");
  await page.waitForSelector("[role=dialog] input[type=checkbox]");
  const boxes = await page.$$("[role=dialog] input[type=checkbox]");
  await boxes[0].click();
  await boxes[1].click();
  await shot("add-users");
  await click(".admin-drawer-actions button", "Add");
  await waitText(".admin-main", "2 of 2");
  await waitText(".lesson-tasks li.done", "Add at least two users");
  await shot("queue-with-users");

  // 4. The route-to-queue rule: Workstreams › the line's workstream › its ruleset › Create rule.
  await click(".admin-nav", "Workstreams");
  await click(".admin-main button", workstream);
  await shot("workstream");
  await click(".admin-main button", `${workstream} route to queue`);
  await click(".admin-main button", "+ Create rule");
  await page.waitForSelector("[role=dialog] input");
  await (await page.$$("[role=dialog] input"))[0].type(choice);
  await click("[role=dialog] button", "+ Add ⌄");
  await click("[role=menuitem]", "Add row");
  await (await page.waitForSelector("[role=dialog] [aria-label=Field]")).click();
  await click("[role=option]", variable);
  await page.type("[role=dialog] input[aria-label=Value]", slip); // a slip in the value: the call is misrouted
  await (await page.$$("[role=dialog] [role=combobox]")).pop().click();
  await click("[role=option]", slip);
  await shot("create-route-to-queue-rule");
  await click(".admin-drawer-actions button", "Create");
  await waitText(".admin-main td", slip);
  await waitText(".lesson-problem", "The IVR sends");
  await shot("rule-value-slip-explained");
  await page.click(`input[aria-label="Select ${choice}"]`);
  await click(".admin-card button", "Edit");
  const value = await page.waitForSelector("[role=dialog] input[aria-label=Value]");
  await new Promise((r) => setTimeout(r, 800)); // the panel slides in
  await value.focus();
  await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control");
  await value.type(choice);
  await click(".admin-drawer-actions button", "Save");
  await waitText(".lesson-tasks li.done", `Route ${choice} calls`);
  await shot("decision-list");

  // 5. Test it.
  await click("[role=tab]", "Phone");
  await click(".phone-pad button", "Call");
  await waitText(".phone-badge", `Waiting in ${slip}`);
  await page.waitForSelector(".lesson-finished");
  await shot("lesson-complete");

  await click("[role=tab]", "Diagram");
  await new Promise((r) => setTimeout(r, 6000));
  await shot("diagram");

  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    const pageErrors = errors.length ? `\npage errors:\n${errors.join("\n")}` : "";
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${pageErrors}`);
  }
  console.log(`tasks done: ${await doneCount()} of 5`);
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  await browser.close();
  if ((await Promise.resolve(errors.length)) > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(`failed: ${e.message}`); process.exit(1); });
