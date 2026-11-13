// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

const fs = require("fs");
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const TOOLBOX = path.resolve(__dirname, "vendor/toolbox/tools");

// The Toolbox pages learners see, built straight from the submodule into dist/tools/<key>/: the tool's own
// HTML page (plus the bridge script, loaded first), its stylesheet and its bundle. Only the Environment
// Diagram: the training teaches Contact Center, not the Toolbox (manual 2.5). The entry and stylesheet
// come from the Toolbox's own webpack entries and its "demo:<key>" script (or the tool's only stylesheet).
const SHOWN = ["diagram2d"];
const TOOLBOX_ROOT = path.resolve(__dirname, "vendor/toolbox");
const TOOLS = (() => {
  const entries = require(path.join(TOOLBOX_ROOT, "webpack.config.js")).entry;
  const scripts = require(path.join(TOOLBOX_ROOT, "package.json")).scripts;
  return Object.entries(entries).filter(([key]) => SHOWN.includes(key)).map(([key, entry]) => {
    const folder = entry.split("/")[2];
    const webresource = path.join(TOOLBOX, folder, "webresource");
    const html = fs.readdirSync(webresource).filter((f) => f.endsWith(".html"));
    if (html.length !== 1) throw new Error(`ToolPages: expected one page in ${webresource}, found ${html.length}`);
    const demo = scripts[`demo:${key}`] ?? "";
    const cssFromDemo = demo.match(/copyFileSync\('(tools\/[^']+\.css)'/)?.[1];
    const ownCss = fs.existsSync(path.join(TOOLBOX, folder, "css")) ? fs.readdirSync(path.join(TOOLBOX, folder, "css")).filter((f) => f.endsWith(".css")) : [];
    const css = cssFromDemo ? path.join(TOOLBOX_ROOT, cssFromDemo) : ownCss.length === 1 ? path.join(TOOLBOX, folder, "css", ownCss[0]) : undefined;
    if (!css) throw new Error(`ToolPages: no stylesheet found for ${key}`);
    return { key, folder, htmlFile: path.join(webresource, html[0]), cssFile: css, entry: path.join(TOOLBOX_ROOT, entry) };
  });
})();

// Writes each tool's page: the Toolbox's HTML with the bridge script put in front of the tool's bundle.
class ToolPages {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("ToolPages", (compilation) => {
      compilation.hooks.processAssets.tap({ name: "ToolPages", stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
        const { RawSource } = compiler.webpack.sources;
        for (const tool of TOOLS) {
          const { htmlFile, cssFile } = tool;
          compilation.fileDependencies.add(htmlFile);
          compilation.fileDependencies.add(cssFile);
          const html = fs.readFileSync(htmlFile, "utf8");
          const withBridge = html.replace(/<script src="bundle\.js/, '<script src="../bridge.js"></script>\n<script src="bundle.js');
          if (withBridge === html) throw new Error(`ToolPages: no bundle.js script tag in ${htmlFile}`);
          compilation.emitAsset(`tools/${tool.key}/index.html`, new RawSource(withBridge));
          compilation.emitAsset(`tools/${tool.key}/style.css`, new RawSource(fs.readFileSync(cssFile)));
        }
      });
    });
  }
}

module.exports = {
  mode: "production",
  entry: {
    "shell/bundle": "./src/shell/index.tsx",
    "tools/bridge": "./src/tools/bridge.ts",
    ...Object.fromEntries(TOOLS.map((t) => [`tools/${t.key}/bundle`, t.entry]))
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    // Toolbox code is used straight from the submodule, never copied.
    alias: { "@toolbox": TOOLBOX }
  },
  module: {
    rules: [
      // Only the files in the bundle are type-checked here (npx tsc checks everything): otherwise the build
      // now and then trips over Toolbox tools the training doesn't include.
      { test: /\.tsx?$/, loader: "ts-loader", exclude: /node_modules/, options: { onlyCompileBundledFiles: true } },
      // 3D models from the Toolbox go inside the bundle, as in the Toolbox.
      { test: /\.glb$/, type: "asset/inline" }
    ]
  },
  performance: { hints: false },
  plugins: [
    new HtmlWebpackPlugin({ template: "./public/index.html", chunks: ["shell/bundle"] }),
    new ToolPages(),
    // Azure Static Web Apps reads its configuration from the root of what is deployed (phase 9).
    { apply: (compiler) => compiler.hooks.thisCompilation.tap("SwaConfig", (compilation) => compilation.hooks.processAssets.tap({ name: "SwaConfig", stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
      compilation.emitAsset("staticwebapp.config.json", new compiler.webpack.sources.RawSource(fs.readFileSync(path.resolve(__dirname, "public/staticwebapp.config.json"))));    })) }
  ]
};
