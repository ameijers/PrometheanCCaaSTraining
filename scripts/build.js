// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Plays the two exercise kinds of phase 7 in a real browser: the level 2 customer interview (ask the
// questions, then build the queue, its team and the rule) and the level 4 build (assignment method and the
// capacity profile's work item limit). Saves a screenshot of each step. Works with the AI switched off.
// Serve the build first (npm run serve), then:  node scripts/build.js <screenshot folder> [port]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [out = "walkthrough/build", port = "5480"] = process.argv.slice(2);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/localhost:7071/.test(m.text())) errors.push(m.text().slice(0, 600)); });
  let n = 0, last = "";
  const shot = async (name) => { await new Promise((r) => setTimeout(r, 500)); await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`) }); console.log(`step ${n}: ${name}`); };
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
  const addUsers = async (count) => {
    await click(".admin-main button", "+ Add users");
    await page.waitForSelector("[role=dialog] input[type=checkbox]");
    // The panel slides in and redraws on each tick: read the people's labels once, then tick each by its label.
    await new Promise((r) => setTimeout(r, 800));
    const labels = await page.$$eval("[role=dialog] input[type=checkbox][aria-label^='Select ']", (boxes) => boxes.map((b) => b.getAttribute("aria-label")));
    for (const label of labels.slice(0, count)) {
      await page.click(`[role=dialog] input[aria-label="${label}"]`);
      await new Promise((r) => setTimeout(r, 150));
    }
    await click(".admin-drawer-actions button", "Add");
  };
  const openQueue = async (name) => {
    await click("[role=tab]", "Admin center");
    await click(".admin-nav", "Queues");
    await click(".admin-main button", "Manage");
    await click(".admin-main button", name);
  };

  try {
    await page.goto(`http://localhost:${port}/?seed=1`, { waitUntil: "networkidle0" });

    // ---- Customer interview, level 2 ----
    await choose("What does the service manager need?");
    await shot("interview-start");
    for (const q of ["How will callers tell you they're calling about a warranty?", "Who should answer the warranty calls?", "When do you want to start?", "Is anything else not working well at the moment?"]) await click(".interview-ask", q);
    await waitText(".lesson-done", "You've found everything");
    await shot("interview-found");

    // The queue and its team.
    await click("[role=tab]", "Admin center");
    await click(".admin-nav", "Queues");
    await click(".admin-main button", "Manage");
    await click(".admin-main button", "+ New queue");
    await page.waitForSelector("[role=dialog] input");
    const fields = await page.$$("[role=dialog] input");
    await fields[0].type("Warranty Claims");
    await fields[1].type("1");
    await (await page.$("[role=dialog] [role=combobox]")).click();
    await click("[role=option]", "Voice");
    await click("[role=dialog] button", "Create");
    await waitText(".admin-title", "Warranty Claims");
    await addUsers(3);
    await waitText(".admin-main", "3 of 3");

    // The rule on the customer service line.
    await click(".admin-nav", "Workstreams");
    await click(".admin-main button", "Customer Service – Voice");
    await click(".admin-main button", "Customer Service – Voice route to queue");
    await click(".admin-main button", "+ Create rule");
    await page.waitForSelector("[role=dialog] input");
    await (await page.$$("[role=dialog] input"))[0].type("Warranty");
    await click("[role=dialog] button", "+ Add ⌄");
    await click("[role=menuitem]", "Add row");
    await (await page.waitForSelector("[role=dialog] [aria-label=Field]")).click();
    await click("[role=option]", "SelectedMenuItem");
    await page.type("[role=dialog] input[aria-label=Value]", "Warranty");
    await (await page.$$("[role=dialog] [role=combobox]")).pop().click();
    // Queues are listed as "Name (N users)", as in the admin center.
    await (await page.waitForFunction((t) => [...document.querySelectorAll("[role=option]")].find((e) => e.textContent.trim().startsWith(t + " (")), {}, "Warranty Claims")).asElement().click();
    await click(".admin-drawer-actions button", "Create");
    await waitText(".admin-main td", "Warranty");

    // One more person in Escalations.
    await openQueue("Escalations");
    await addUsers(1);
    await page.waitForSelector(".lesson-finished");
    await shot("interview-built");

    // ---- Build to requirements, level 4 ----
    await choose("Spread the work");
    await shot("build4-start");
    await openQueue("Billing");
    await click(".admin-main button", "See more");
    await page.click('input[aria-label="Advanced round robin"]');
    await click(".admin-main button", "Save & close");
    await click(".admin-nav", "User management");
    await click(".admin-main button", "Manage");
    await click(".admin-main button", "Default voice inbound");
    const limit = await page.waitForSelector(".admin-main input[type=number]");
    await limit.focus();
    await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control");
    await limit.type("2");
    await click(".admin-main button", "Save");
    await page.waitForSelector(".lesson-finished");
    await shot("build4-done");
    console.log("both exercises finished");

    // What was built, as the Toolbox's CSV files, in the order to run them.
    await click("header button", "Export");
    await waitText("[role=dialog]", "in this order");
    await shot("export");
  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
  }
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
