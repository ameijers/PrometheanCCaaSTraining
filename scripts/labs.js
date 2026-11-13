// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Goes through the labs in a real browser the way a new learner does: lab 1 from its first Learn page
// through the quiz and every hands-on task to the challenge list, the lab list, and lab 4's call taken in
// the Agent tab. Saves a screenshot of each step.
// Serve the build first (npm run serve), then:  node scripts/labs.js <screenshot folder> [port]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");
const labs = require("../content/labs/labs.json").labs;

const [out = "walkthrough/labs", port = "5480"] = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/localhost:7071|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text().slice(0, 600)); });
  let n = 0, last = "";
  const shot = async (name) => { await wait(500); await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`) }); console.log(`step ${n}: ${name}`); };
  // Fluent tabs repeat their text for layout, so "Lab" can read "LabLab".
  const click = async (selector, text) => {
    last = `click ${selector} "${text}"`;
    await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => [t, t + t].includes(e.textContent.trim()) && !e.disabled), { timeout: 10000 }, selector, text);
    for (const h of await page.$$(selector)) {
      if (![text, text + text].includes(await h.evaluate((e) => e.textContent.trim()))) continue;
      if (await h.evaluate((e) => e.disabled || e.offsetParent === null)) continue;
      await h.click();
      await wait(300);
      return;
    }
    throw new Error(`nothing clickable: ${selector} "${text}"`);
  };
  const waitText = (selector, text) => { last = `${selector} "${text}"`; return page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 15000 }, selector, text); };
  const answer = async (value) => {
    last = `answer ${value}`;
    await page.waitForSelector(".lesson-answer select, .lesson-answer input");
    if (await page.$(".lesson-answer select")) await page.select(".lesson-answer select", value);
    else { await page.click(".lesson-answer input"); await page.keyboard.type(value); }
    await click(".lesson-answer button", "Check answer");
  };
  const lastQueue = () => page.evaluate(() => {
    const { store } = window.__ccaasTraining;
    const call = store.table("msdyn_ocliveworkitem").sort((a, b) => String(b.createdon).localeCompare(String(a.createdon)))[0];
    return store.find("queue", call._msdyn_cdsqueueid_value).name;
  });

  try {
    // A new learner starts at lab 1, on its first Learn page.
    await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle0" });
    const lab1 = labs.find((l) => l.number === 1);
    await waitText(".lab-view", lab1.learn[0].title);
    await shot("lab1-learn-first-page");
    for (let i = 1; i < lab1.learn.length; i++) await click(".lab-nav button", "Next");
    await waitText(".lab-view", lab1.learn[lab1.learn.length - 1].title);
    await click(".lab-nav button", "To the quiz");
    // One wrong answer first, then the right ones.
    for (const [i, q] of lab1.quiz.entries()) await click(`.lab-question:nth-of-type(${i + 1}) label`, q.options[i === 0 ? (q.answer + 1) % q.options.length : q.answer]);
    await click(".lab-nav button", "Check my answers");
    await waitText(".lab-view", "Not quite");
    await shot("lab1-quiz-one-wrong");
    await click(".lab-question:nth-of-type(1) label", lab1.quiz[0].options[lab1.quiz[0].answer]);
    await click(".lab-nav button", "Check my answers");
    await click(".lab-nav button", "Start the hands-on part");

    // Do: follow a call.
    await waitText(".lesson", "Follow a call");
    const choices = await page.evaluate(() => window.__ccaasTraining.lesson.line.ivr.options.map((o) => o.label));
    const workstream = await page.evaluate(() => window.__ccaasTraining.lesson.line.ivr.workstream);
    await click(".phone-ivr label", choices[0]);
    await click(".phone-pad button", "Call");
    await waitText(".lesson-tasks li.done", "Call the");
    await answer(workstream);
    await answer(await lastQueue());
    await click("[role=tab]", "Diagram");
    await click("[role=tab]", "Phone");
    await click(".phone-ivr label", choices[1]);
    await click(".phone-pad button", "Call");
    await waitText(".lesson-tasks li.current", "Where did that call go?");
    await answer(await lastQueue());
    await waitText(".lesson-finished", "Hands-on part done");
    await shot("lab1-do-finished");

    await click(".lab-parts button", "Challenge");
    await waitText(".lab-view", "Try it without the steps");
    await shot("lab1-challenge");
    await click(".lab-challenges button", "Start");
    await waitText(".lab-back", "Back to lab 1");
    await shot("lab1-challenge-started");
    await click(".lab-back", `← Back to lab 1: ${lab1.title}`);

    // The lab list: lab 1 done, lab 2 recommended next.
    await click(".training-env button", "Labs and practice");
    await waitText(".picker-lab-next", "Lab 2");
    await shot("lab-list");

    // Lab 4's call, in the Agent tab.
    await page.evaluate(() => [...document.querySelectorAll(".picker-lab")].find((b) => b.textContent.includes("Lab 4:")).click());
    await wait(300);
    await click(".lab-parts button", "Do");
    await waitText(".lesson", "A queue and a call of your own");
    const rep = await page.evaluate(() => window.__ccaasTraining.lesson.tasks.find((t) => t.id === "sign-in").title.replace(/^Sign in as (.*) and be Available$/, "$1"));
    await click("[role=tab]", "Agent");
    await (await page.waitForSelector(".ws-training [role=combobox]")).click();
    await click("[role=option]", rep);
    await click("[role=tab]", "Phone");
    const lab4choice = await page.evaluate(() => window.__ccaasTraining.lesson.line.ivr.options[0].label);
    await click(".phone-ivr label", lab4choice);
    await click(".phone-pad button", "Call");
    await click("[role=tab]", "Agent");
    await click(".ws-notification button", "Accept");
    await page.click(".ws-controls .ws-end");
    await click(".ws-form button", "Close session");
    await waitText(".lesson-tasks", "End the call and close the session");
    const done = await page.$$eval(".lesson-tasks li.done", (li) => li.map((l) => l.textContent.trim()));
    console.log("lab 4 tasks done:", done.length);
    await shot("lab4-call-taken");
  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
  }
  console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "page errors: none");
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
