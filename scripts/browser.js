// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Starts a headless browser for the walkthrough scripts: Edge, or Chrome when Edge won't start (on this
// machine Edge's headless mode stopped working on 2026-11-04). CCAAS_BROWSER picks a browser explicitly.

const fs = require("fs");
const puppeteer = require("puppeteer-core");

const CANDIDATES = [
  process.env.CCAAS_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
].filter((p) => p && fs.existsSync(p));

async function launch(options = {}) {
  let last;
  for (const executablePath of CANDIDATES) {
    try {
      return await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 }, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], ...options, executablePath });
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("No Edge or Chrome found. Set CCAAS_BROWSER to a browser's path.");
}

module.exports = { launch };
