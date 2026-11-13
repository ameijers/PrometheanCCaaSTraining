// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

const path = require("path");

// The backend, bundled for Node: it uses the training's own scenario checks (src/scenarios), which use
// the Toolbox through the @toolbox alias, so it's built like the browser part rather than with tsc alone.
// Packages from node_modules stay outside the bundle.
const backend = {
  mode: "none",
  target: "node",
  entry: {
    server: "./backend/src/server.ts",
    review: "./backend/src/review.ts",
    generate: "./backend/src/generate.ts"
  },
  output: { path: path.resolve(__dirname, "backend/dist"), filename: "[name].js", clean: true },
  // __dirname is the bundle's own folder (backend/dist), as the code expects.
  node: { __dirname: false },
  devtool: "source-map",
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".json"],
    alias: { "@toolbox": path.resolve(__dirname, "vendor/toolbox/tools") }
  },
  externals: [({ request }, callback) => (/^[a-z@][^:]*$/i.test(request) && !request.startsWith("@toolbox") ? callback(null, `commonjs ${request}`) : callback())],
  module: {
    rules: [{ test: /\.tsx?$/, loader: "ts-loader", options: { configFile: path.resolve(__dirname, "tsconfig.json"), onlyCompileBundledFiles: true } }]
  }
};

// The same backend as an Azure Functions app (phase 9): api/dist/index.js, deployed by Azure Static Web Apps
// from the api folder, whose package.json lists the packages it needs at run time.
const functions = {
  ...backend,
  entry: { index: "./backend/src/functions.ts" },
  output: { path: path.resolve(__dirname, "api/dist"), filename: "[name].js", clean: true, library: { type: "commonjs2" } }
};

module.exports = [backend, functions];
