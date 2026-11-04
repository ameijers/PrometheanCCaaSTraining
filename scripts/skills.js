// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Plays the skills exercise (level 4) and the outbound profile exercise (level 5) in a real browser:
// Skills hub, a skill attachment rule, Exact Match on the workstream, then Productivity › Outbound and inbound
// profiles. Saves a screenshot of each step.
// Serve the build first (npm run serve), then:  node scripts/skills.js <screenshot folder> [port]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [out = "walkthrough/skills", port = "5480"] = process.argv.slice(2);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/localhost:7071|status of 404/.test(m.text())) errors.push(m.text().slice(0, 600)); });
  let n = 0, last = "";
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => { await pause(500); await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`) }); console.log(`step ${n}: ${name}`); };
  const same = (a, t) => a === t || a === t + t;
  const click = async (selector, text) => {
    last = `click ${selector} "${text}"`;
    await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => [t, t + t].includes(e.textContent.trim())), { timeout: 10000 }, selector, text);
    for (const h of await page.$$(selector)) {
      if (!same(await h.evaluate((e) => e.textContent.trim()), text)) continue;
      if (await h.evaluate((e) => e.disabled || e.offsetParent === null)) continue;
      await h.click();
      return;
    }
    throw new Error(`nothing clickable: ${selector} "${text}"`);
  };
  const waitText = (selector, text) => { last = `${selector} "${text}"`; return page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 10000 }, selector, text); };
  const pick = async (label, option) => {
    last = `pick ${label} ${option}`;
    // A dropdown by its aria-label or its field's label (a required field's label ends in "*").
    const find = (l) => [...document.querySelectorAll("[role=dialog] [role=combobox]")].find((c) => c.getAttribute("aria-label") === l)
      ?? [...document.querySelectorAll("[role=dialog] label")].filter((x) => x.textContent.replace(/[\s*]+$/, "") === l).map((x) => document.getElementById(x.htmlFor)).find((c) => c?.getAttribute("role") === "combobox");
    await page.waitForFunction(`(${find})(${JSON.stringify(label)}) !== undefined`, { timeout: 10000 });
    await page.evaluate(`(${find})(${JSON.stringify(label)}).click()`);
    await click("[role=option]", option);
  };
  const choose = async (title) => {
    await click(".training-env button", "Choose an exercise");
    await page.waitForSelector(".picker");
    await click(".picker-item span", title);
    await waitText(".lesson-title", title);
  };

  try {
    await page.goto(`http://localhost:${port}/?seed=1`, { waitUntil: "networkidle0" });

    // ---- Level 4: Returns need the right people ----
    await choose("Returns need the right people");
    await shot("skills-start");
    await click("[role=tab]", "Admin center");

    // Exact Match on the workstream, and a skill attachment rule.
    await click(".admin-nav", "Workstreams");
    await click(".admin-main button", "Customer Service – Voice");
    await (await page.waitForSelector(".admin-main [aria-label='Default skill matching algorithm']")).click();
    await click("[role=option]", "Exact Match");
    await click(".admin-main button", "+ Create ruleset");
    await waitText(".admin-title", "Work classification");
    await click(".admin-main button", "+ Create Rule");
    await page.waitForSelector("[role=dialog] input");
    await (await page.$("[role=dialog] input")).type("Returns need Returns");
    await pick("Field", "SelectedMenuItem");
    await page.type("[role=dialog] input[aria-label=Value]", "Returns");
    await pick("Skill", "Returns");
    await pick("Proficiency", "Intermediate");
    await shot("skill-rule");
    await click(".admin-drawer-actions button", "Create");
    await waitText(".admin-main td", "Returns need Returns");
    await shot("classification");

    // The skill for one more person in the Returns queue.
    const name = await page.evaluate(() => {
      const s = window.__ccaasTraining.store;
      const q = s.table("queue").find((x) => x.name === "Returns" && x.statecode === 0);
      const skill = s.table("characteristic").find((c) => c.name === "Returns");
      const has = (u) => { const r = s.table("bookableresource").find((x) => x._userid_value === u); return r && s.table("bookableresourcecharacteristic").some((l) => l._resource_value === r.bookableresourceid && l._characteristic_value === skill.characteristicid); };
      const m = s.table("queuemembership").filter((x) => x.queueid === q.queueid).map((x) => x.systemuserid).find((u) => !has(u));
      return s.find("systemuser", m).fullname;
    });
    await click(".admin-nav", "User management");
    await page.evaluate(() => [...document.querySelectorAll(".admin-main .admin-card")].find((c) => c.textContent.includes("Skills hub")).querySelector("button").click());
    await waitText(".admin-title", "Skills");
    await click(".admin-main button", "Returns");
    await page.waitForSelector("[role=dialog]");
    await pause(800);
    await click("[role=dialog] button", "+ Add");
    await page.waitForSelector("[role=dialog] input[type=checkbox]");
    await pause(500);
    await page.evaluate((who) => [...document.querySelectorAll("[role=dialog] label")].find((l) => l.textContent.trim() === who).click(), name);
    await click("[role=dialog] button", "Add selected users");
    await page.waitForSelector(`[role=dialog] input[aria-label="Select ${name}"]`);
    await page.click(`[role=dialog] input[aria-label="Select ${name}"]`);
    await click("[role=dialog] button", "Update proficiency ⌄");
    await click("[role=menuitem]", "Intermediate");
    await shot("edit-skill");
    await page.waitForSelector(".lesson-finished");
    await click(".admin-drawer-actions button", "Close");
    await shot("skills-done");

    // ---- Level 5: Calling customers back ----
    await choose("Calling customers back");
    await click("[role=tab]", "Admin center");
    await pause(800);
    await click(".admin-nav", "Productivity");
    await waitText(".admin-title", "Productivity");
    await click(".admin-main button", "Manage");
    await waitText(".admin-title", "Outbound and inbound profiles");
    await click(".admin-main button", "+ New profile");
    await page.waitForSelector("[role=dialog] input");
    await (await page.$("[role=dialog] input")).type("Billing Outbound");
    await pick("Shared numbers", "+44 20 7946 0100");
    await pick("Queue", "Billing");
    await shot("new-profile");
    await click(".admin-drawer-actions button", "Save and close");
    await waitText(".admin-main td", "Billing Outbound");
    await page.waitForSelector(".lesson-finished");
    await shot("outbound-done");
    console.log("both exercises finished");
  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
  }
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
