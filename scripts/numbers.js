// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Plays the number pool in a real browser (phase 6): Channels › Phone numbers › Add ACS number, find and
// purchase a fictional number, set it up on a voice workstream, and call it. Saves a screenshot of each step.
// Serve the build first (npm run serve), then:  node scripts/numbers.js <screenshot folder> [port]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [out = "walkthrough/numbers", port = "5480"] = process.argv.slice(2);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage();
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

  try {
    await page.goto(`http://localhost:${port}/?seed=1#admin`, { waitUntil: "networkidle0" });
    await click(".admin-nav", "Channels");
    await click(".admin-main button", "Manage");
    await waitText(".admin-title", "Phone numbers");
    await shot("phone-numbers");

    await click(".admin-main button", "+ Add ACS number");
    await page.waitForSelector("[role=dialog]");
    await shot("add-phone-number");
    await click("[role=dialog] button", "Find numbers");
    await waitText("[role=dialog] .admin-number", "+1 206 555 01");
    const number = await page.$eval("[role=dialog] .admin-number", (e) => e.textContent.trim());
    await click("[role=dialog] button", "Purchase phone number");
    await waitText("[role=dialog]", "Ready for setup");
    await shot("purchased");
    await click("[role=dialog] button", "Done");
    await waitText(".admin-main td", number);

    await page.click(`input[aria-label="Select ${number}"]`);
    await click(".admin-main button", "Setup workstream");
    await (await page.waitForSelector("[role=dialog] [role=combobox]")).click();
    await click("[role=option]", "Partner Line – Voice");
    await shot("setup-workstream");
    await click("[role=dialog] button", "Save and close");
    await waitText(".admin-main td", "Connected");
    await shot("connected");

    await click("[role=tab]", "Phone");
    await page.$eval(".phone-pad input", (e) => e.select());
    await page.keyboard.type(number);
    await click(".phone-pad button", "Call");
    await waitText(".phone-steps", "Partner Line – Voice");
    await shot("new-number-rings");
    console.log(`${number} rings Partner Line – Voice`);

    // The new line, exported for the Toolbox's Voice Channel Builder.
    await click("header button", "My work ▾");
    await click("[role=menuitem]", "Export");
    await waitText("[role=dialog]", "Voice Channel Builder");
    await shot("export-voice-channels");
  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
  }
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
