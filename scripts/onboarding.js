// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Plays the level 5 onboarding exercise in a real browser: a business unit and an owner team with three
// members, in the simulated Power Platform admin center. Saves a screenshot of each step.
// Serve the build first (npm run serve), then:  node scripts/onboarding.js <screenshot folder> [port]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [out = "walkthrough/onboarding", port = "5480"] = process.argv.slice(2);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/localhost:7071/.test(m.text())) errors.push(m.text().slice(0, 600)); });
  let n = 0, last = "";
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => { await pause(500); await page.screenshot({ path: path.join(out, `${String(++n).padStart(2, "0")}-${name}.png`) }); console.log(`step ${n}: ${name}`); };
  const click = async (selector, text) => {
    last = `click ${selector} "${text}"`;
    await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.trim() === t), { timeout: 10000 }, selector, text);
    for (const h of await page.$$(selector)) {
      if ((await h.evaluate((e) => e.textContent.trim())) !== text) continue;
      if (await h.evaluate((e) => e.disabled || e.offsetParent === null)) continue;
      await h.click();
      return;
    }
    throw new Error(`nothing clickable: ${selector} "${text}"`);
  };
  const waitText = (selector, text) => { last = `${selector} "${text}"`; return page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 10000 }, selector, text); };

  try {
    await page.goto(`http://localhost:${port}/?seed=1`, { waitUntil: "networkidle0" });
    await click(".training-env button", "Labs and practice");
    await page.waitForSelector(".picker");
    await click(".picker-item span", "A home for the new parts team");
    await waitText(".lesson-title", "A home for the new parts team");
    await shot("start");

    // The business unit, under Contoso (the parent is filled in with the root unit).
    await click("[role=tab]", "Admin center");
    await click(".admin-app", "Power Platform admin center");
    await waitText(".admin-title", "Business units");
    await click(".admin-main button", "+ New business unit");
    await page.waitForSelector("[role=dialog] input");
    await (await page.$("[role=dialog] input")).type("Contoso Parts");
    await shot("new-business-unit");
    await click(".admin-drawer-actions button", "Save");
    await waitText(".admin-main td", "Contoso Parts");
    await shot("business-units");

    // The owner team in that unit.
    await click(".admin-nav", "Teams");
    await click(".admin-main button", "+ Create team");
    await page.waitForSelector("[role=dialog] input");
    await (await page.$("[role=dialog] input")).type("Parts Support");
    await (await page.$("[role=dialog] [role=combobox][placeholder='Select a business unit'], [role=dialog] button[role=combobox]")).click();
    await click("[role=option]", "Contoso Parts");
    await shot("create-team");
    await click(".admin-drawer-actions button", "Save");
    await waitText(".admin-main td", "Parts Support");

    // Three members.
    const row = await page.waitForFunction(() => [...document.querySelectorAll(".admin-main tr")].find((r) => r.textContent.startsWith("Parts Support")));
    await (await row.asElement().$("button")).click();
    await page.waitForSelector("[role=dialog] input[type=checkbox]");
    await pause(800);
    for (let i = 0; i < 3; i++) {
      const boxes = await page.$$("[role=dialog] input[type=checkbox]:not(:checked):not(:disabled)");
      await boxes[0].click();
      await pause(150);
    }
    await shot("manage-members");
    await click(".admin-drawer-actions button", "+ Add team members");
    await page.waitForSelector(".lesson-finished");
    await shot("done");
    console.log("onboarding exercise finished");
  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
  }
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
