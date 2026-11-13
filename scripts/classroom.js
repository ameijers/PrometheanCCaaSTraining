// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Plays a class in a real browser (phase 8): a trainer signs in (on this computer, a stand-in for the
// Microsoft sign-in), creates a class from Your classes, a learner (in a separate browser profile) joins with
// the code, works on an exercise, and the trainer sees the progress and manages the class. Then the guided
// tour. Needs the build served (npm run serve) and the backend running (npm run backend).
//   node scripts/classroom.js <screenshot folder> [port]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [out = "walkthrough/classroom", port = "5480"] = process.argv.slice(2);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const errors = [];
  const open = async (context) => {
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on("dialog", (d) => d.accept(d.type() === "prompt" ? d.defaultValue() : undefined));
    page.on("pageerror", (e) => errors.push(e.message));
    return page;
  };
  let n = 0, last = "";
  const shot = async (page, name) => { await new Promise((r) => setTimeout(r, 500)); await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`) }); console.log(`step ${n}: ${name}`); };
  const click = async (page, selector, text) => {
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
  const waitText = (page, selector, text, timeout = 15000) => { last = `${selector} "${text}"`; return page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout }, selector, text); };
  let current;

  try {
    // The trainer creates a class with two exercises.
    const trainer = current = await open(browser.defaultBrowserContext());
    await trainer.goto(`http://localhost:${port}/?seed=1`, { waitUntil: "networkidle0" });
    await click(trainer, ".training-env button", "Sign in"); // the name prompt is accepted as it is
    await trainer.waitForNavigation({ waitUntil: "networkidle0" });
    await waitText(trainer, ".lesson-title", "Your classes");
    await shot(trainer, "trainer-your-classes");
    await click(trainer, ".trainer button", "Create a class");
    await trainer.waitForSelector(".trainer input");
    await trainer.type(".trainer input", "Contoso onboarding, November");
    for (const title of ["First day on the switchboard", "Monday morning, and nobody answers"]) {
      await trainer.evaluate((t) => [...document.querySelectorAll(".trainer-pick label")].find((l) => l.textContent.includes(t)).click(), title);
    }
    await shot(trainer, "trainer-create");
    await click(trainer, ".trainer button", "Create the class");
    await trainer.waitForSelector(".trainer-code");
    const code = await trainer.$eval(".trainer-code", (e) => e.textContent.trim());
    await shot(trainer, "trainer-class-created");
    console.log(`class code ${code}`);

    // A learner joins in another browser profile with the class link, and answers the calls.
    const learnerContext = await browser.createBrowserContext();
    const learner = current = await open(learnerContext);
    await learner.goto(`http://localhost:${port}/?class=${code}`, { waitUntil: "networkidle0" });
    await learner.waitForSelector("[role=dialog] input");
    const inputs = await learner.$$("[role=dialog] input:not([type=checkbox])");
    await inputs[1].type("Sam");
    await shot(learner, "learner-join");
    await click(learner, "[role=dialog] button", "Join");
    current = trainer;
    await waitText(trainer, ".trainer-table", "Sam", 15000); // the trainer sees Sam as soon as they join
    await shot(trainer, "trainer-sees-join");
    current = learner;
    // Right after joining: the personal code, shown clearly.
    await waitText(learner, ".code-big", "");
    await shot(learner, "learner-personal-code");
    await click(learner, "[role=dialog] button", "Carry on");
    await waitText(learner, ".picker-class", "First day on the switchboard");
    await shot(learner, "learner-class-exercises");
    await click(learner, ".picker-class .picker-item span", "First day on the switchboard");
    await waitText(learner, ".lesson-title", "First day on the switchboard");
    // The answer choices load a moment after the exercise starts.
    await learner.waitForSelector(".lesson-tasks input[type=radio]");
    await new Promise((r) => setTimeout(r, 800));
    const calls = await learner.$$eval(".lesson-tasks > li", (l) => l.length);
    for (let i = 0; i < calls; i++) {
      const item = (await learner.$$(".lesson-tasks > li"))[i];
      await (await item.$("input[type=radio]")).click();
      await (await item.$(".lesson-actions button")).click();
      await learner.waitForFunction((j) => /done|missed/.test(document.querySelectorAll(".lesson-tasks > li")[j].className), { timeout: 10000 }, i);
    }
    await learner.waitForSelector(".lesson-finished");
    await new Promise((r) => setTimeout(r, 4500)); // progress is sent 1.5 seconds after the last change, work 3 seconds

    // Sam carries on in another browser with their personal code: the finished exercise comes with them.
    const personal = await learner.evaluate(() => JSON.parse(localStorage.getItem("ccaas-training-class")).rejoinCode);
    console.log(`personal code ${personal}`);
    const laptop = current = await open(await browser.createBrowserContext());
    await laptop.goto(`http://localhost:${port}/?class=${code}`, { waitUntil: "networkidle0" });
    await laptop.waitForSelector("[role=dialog] input");
    await laptop.evaluate(() => [...document.querySelectorAll("[role=dialog] label")].find((l) => l.textContent.includes("I joined this class before")).click());
    await laptop.waitForFunction(() => [...document.querySelectorAll("[role=dialog] label")].some((l) => l.textContent.includes("Your personal code")));
    await (await laptop.$$("[role=dialog] input:not([type=checkbox])"))[1].type(personal);
    await shot(laptop, "learner-rejoin");
    await click(laptop, "[role=dialog] button", "Carry on");
    await waitText(laptop, ".training-message", "Welcome back");
    await shot(laptop, "learner-rejoined-ticks");
    await laptop.evaluate(() => [...document.querySelectorAll(".picker-class .picker-item span")].find((e) => e.textContent.includes("First day on the switchboard")).click());
    await waitText(laptop, ".training-message", "where you left off");
    await laptop.waitForSelector(".lesson-finished");
    await shot(laptop, "learner-carries-on");
    await laptop.close();
    current = learner;

    // The trainer sees Sam's progress (the page reads it every 10 seconds).
    current = trainer;
    await waitText(trainer, ".trainer-table", "Sam", 15000);
    await shot(trainer, "trainer-progress");

    // Managing the class: close it, and a new learner can't join; reopen it; remove Sam.
    await click(trainer, ".trainer-manage button", "Close the class");
    await waitText(trainer, ".trainer-status", "Closed");
    await shot(trainer, "trainer-class-closed");
    const late = current = await open(await browser.createBrowserContext());
    await late.goto(`http://localhost:${port}/?class=${code}`, { waitUntil: "networkidle0" });
    await late.waitForSelector("[role=dialog] input");
    await (await late.$$("[role=dialog] input:not([type=checkbox])"))[1].type("Kim");
    await click(late, "[role=dialog] button", "Join");
    await waitText(late, "[role=dialog]", "is closed");
    await shot(late, "learner-class-closed");
    current = trainer;
    await click(trainer, ".trainer-manage button", "Reopen the class");
    await waitText(trainer, ".trainer-status", "Open");
    await trainer.click("button[aria-label='Remove Sam']");
    await waitText(trainer, ".trainer-body", "Nobody has joined yet");
    await shot(trainer, "trainer-learner-removed");

    // The guided tour, on the learner's screen.
    current = learner;
    await click(learner, ".training-env button", "Tour");
    await learner.waitForSelector(".tour");
    await shot(learner, "tour-step-1");
    await learner.click(".tour-controls button[aria-label='Next step']");
    await learner.click(".tour-controls button[aria-label='Next step']");
    await learner.click(".tour-controls button[aria-label='Next step']");
    await shot(learner, "tour-admin-center");

    // The trainer's list shows the class; they open it again and delete it: its code stops working.
    current = trainer;
    await click(trainer, ".trainer-head button", "All your classes");
    await waitText(trainer, ".trainer-list", code);
    await shot(trainer, "trainer-class-list");
    // Ticking the class shows "Delete the selected classes"; the row's Delete button removes it.
    await trainer.click(".trainer-list tbody input[type=checkbox]");
    await waitText(trainer, ".trainer-body button", "Delete the selected classes (1)");
    await shot(trainer, "trainer-class-list-selected");
    await trainer.click(".trainer-list button[aria-label^='Delete']");
    await trainer.waitForFunction((c) => !document.querySelector(".trainer-list") || !document.querySelector(".trainer-list").textContent.includes(c), { timeout: 10000 }, code);
    await shot(trainer, "trainer-class-deleted");
    await click(trainer, ".trainer-head button", "Sign out");
    await trainer.waitForNavigation({ waitUntil: "networkidle0" });
    await waitText(trainer, ".training-env button", "Sign in");
    console.log(`class ${code} deleted`);
  } catch (e) {
    if (current) await current.screenshot({ path: path.join(out, "failure.png") });
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
  }
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
