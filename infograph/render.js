// node render.js <repo> <html> <png>: render the infographic at 1080x1350, twice the pixels, and report overflow.
const path = require("path");
const { launch } = require(path.join(process.argv[2], "scripts/browser.js"));
(async () => {
  const browser = await launch({ defaultViewport: { width: 1080, height: 1350, deviceScaleFactor: 2 } });
  const page = await browser.newPage();
  await page.goto("file:///" + path.resolve(process.argv[3]).replace(/\\/g, "/"), { waitUntil: "load" });
  const fit = await page.evaluate(() => {
    const p = document.querySelector(".page"), f = document.querySelector("footer");
    const over = [...document.querySelectorAll(".page *")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible").length;
    return { contentBottom: Math.round(f.getBoundingClientRect().bottom), pageHeight: p.clientHeight, scrollH: p.scrollHeight, over };
  });
  console.log(JSON.stringify(fit));
  await page.screenshot({ path: process.argv[4], clip: { x: 0, y: 0, width: 1080, height: 1350 } });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
