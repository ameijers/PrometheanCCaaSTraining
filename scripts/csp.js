// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Checks the site's Content Security Policy (public/staticwebapp.config.json) against the real pages,
// before hosting (phase 9): serves every page with the policy's headers, as Azure Static Web Apps will,
// goes through the screens, and lists anything the browser blocked. Serve the build first (npm run serve).
//   node scripts/csp.js [port]
// The local backend's address is allowed here only: when hosted, the backend is on the same site (/api).

const fs = require("fs");
const path = require("path");
const { launch } = require("./browser");

const [port = "5480"] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/staticwebapp.config.json"), "utf8"));
const headers = { ...config.globalHeaders };
headers["Content-Security-Policy"] = headers["Content-Security-Policy"].replace("connect-src 'self'", "connect-src 'self' http://localhost:7071");

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  const blocked = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) blocked.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => blocked.push(`page error: ${e.message}`));
  // Every document (the page and the Diagram's iframe) comes back with the policy's headers.
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    if (req.resourceType() !== "document" || !req.url().startsWith(`http://localhost:${port}`)) return req.continue();
    const res = await fetch(req.url());
    req.respond({ status: res.status, headers: { "Content-Type": res.headers.get("content-type") ?? "text/html", ...headers }, body: Buffer.from(await res.arrayBuffer()) });
  });
  const tab = async (name) => {
    await page.evaluate((n) => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.trim().startsWith(n)).click(), name);
    await new Promise((r) => setTimeout(r, name === "Diagram" ? 7000 : 1500));
  };
  await page.goto(`http://localhost:${port}/?seed=1`, { waitUntil: "networkidle0" });
  for (const name of ["Admin center", "Diagram", "Phone", "Agent"]) await tab(name);
  await page.evaluate(() => [...document.querySelectorAll(".phone-pad button")].find((b) => b.textContent.trim() === "Call")?.click());
  await page.evaluate(() => [...document.querySelectorAll(".training-env button")].find((b) => b.textContent.trim() === "Tour").click());
  await new Promise((r) => setTimeout(r, 1500));
  const fromPages = [...blocked];
  // A test that the policy is really on: an inline script must be refused.
  await page.evaluate(() => { const s = document.createElement("script"); s.textContent = "window.__cspCanary = true"; document.body.appendChild(s); });
  await new Promise((r) => setTimeout(r, 500));
  const canaryRan = await page.evaluate(() => window.__cspCanary === true);
  await browser.close();
  if (canaryRan) { console.log("The policy wasn't applied: an inline script ran."); process.exit(1); }
  console.log(fromPages.length ? `Blocked by the policy:\n${fromPages.join("\n")}` : "Nothing the pages need was blocked, and an inline script was refused: the policy is on and fits the pages.");
  process.exit(fromPages.length ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
