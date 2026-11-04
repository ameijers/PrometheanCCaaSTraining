// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Plays a call from ring to a representative in a real browser (phase 6): the learner signs in as a
// representative in the agent view, calls their queue on the phone, accepts the call, ends it and closes
// it; the Diagram's Live tab shows the call with the representative. Saves a screenshot of each step.
// Serve the build first (npm run serve), then:  node scripts/agent.js <screenshot folder> [port]

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [out = "walkthrough/agent", port = "5480"] = process.argv.slice(2);

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
  const waitText = (selector, text) => { last = `${selector} "${text}"`; return page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 15000 }, selector, text); };

  try {
    await page.goto(`http://localhost:${port}/?seed=1#agent`, { waitUntil: "networkidle0" });
    // The representative least active routing picks first in the Returns queue: the first one there who is
    // signed in and available (nobody has had a call yet, so the order they joined decides).
    const { name, dial } = await page.evaluate(() => {
      const { store } = window.__ccaasTraining;
      const returns = store.table("queue").find((q) => q.name === "Returns");
      const ready = store.table("queuemembership").filter((m) => m.queueid === returns.queueid).map((m) => m.systemuserid).find((id) => {
        const s = store.table("msdyn_agentstatus").find((x) => x._msdyn_agentid_value === id);
        return s && s.msdyn_isagentloggedin && store.find("msdyn_presence", s._msdyn_currentpresenceid_value).msdyn_name === "Available";
      });
      const ws = store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice");
      const channel = store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid);
      return { name: store.find("systemuser", ready).fullname, dial: store.find("msdyn_ocphonenumber", channel._msdyn_phonenumberid_value).msdyn_phonenumber };
    });
    console.log(`signing in as ${name}; calling ${dial}`);

    await (await page.waitForSelector(".agent-side [role=combobox]")).click();
    await click("[role=option]", name);
    await waitText(".agent-queues", "Returns");
    await shot("signed-in");

    await click("[role=tab]", "Phone");
    await page.$eval(".phone-pad input", (e) => e.select());
    await page.keyboard.type(dial);
    await click(".phone-ivr label", "Returns");
    await click(".phone-pad button", "Call");
    await waitText(".phone-steps", "offered to you in the agent view");
    await shot("call-offered");

    await click("[role=tab]", "Agent");
    await waitText(".agent-offer", "Incoming call");
    await shot("incoming-call");
    await click(".agent-offer button", "Accept");
    await waitText(".phone-badge", "On the call");
    await shot("on-the-call");

    await click("[role=tab]", "Diagram");
    await new Promise((r) => setTimeout(r, 6000));
    const frame = page.frames().find((f) => /diagram2d/.test(f.url()));
    const live = frame && (await frame.$$("button, [role=tab]")).length ? await frame.evaluateHandle(() => [...document.querySelectorAll("button, [role=tab]")].find((e) => e.textContent.trim() === "Live")) : null;
    if (live && live.asElement()) {
      await live.asElement().click();
      // The Live tab reads activity once "Live activity" is ticked.
      const box = await frame.waitForSelector("input[type=checkbox]");
      await box.click();
      await new Promise((r) => setTimeout(r, 4000));
    }
    await shot("diagram-live");

    await click("[role=tab]", "Agent");
    await click(".agent-main button", "End call");
    await waitText(".phone-badge", "Wrap-up");
    await shot("wrap-up");
    await click(".agent-main button", "Close");
    await waitText(".agent-main", "No calls for you right now");
    await shot("closed");
  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png") });
    throw new Error(`${e.message} (after step ${n}, waiting for ${last})${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
  }
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
