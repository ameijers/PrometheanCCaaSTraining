// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Deploys the training to Azure Static Web Apps from this computer (decision 15.4, phase 9), without
// GitHub: the static web app's source is "Other", and this uses its deployment token. Run it only when
// Alexander says so.
//
//   In PowerShell:  $env:SWA_CLI_DEPLOYMENT_TOKEN = "<the token from Manage deployment token>"
//   then:           npm run deploy:azure
//
// The token stays in the environment variable: it's never written to a file or printed. The steps follow
// Microsoft Learn's "Deploy a static web app with Azure Static Web Apps CLI" (ms.date 2024-02-05):
// swa deploy <built app> --api-location <api>, with the token from SWA_CLI_DEPLOYMENT_TOKEN.

const { execSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const run = (label, command, cwd = root) => {
  console.log(`\n== ${label}`);
  execSync(command, { cwd, stdio: "inherit", env: process.env });
};

if (!process.env.SWA_CLI_DEPLOYMENT_TOKEN) {
  console.error("Set the deployment token first (Azure portal > the static web app > Overview > Manage deployment token):\n  $env:SWA_CLI_DEPLOYMENT_TOKEN = \"<token>\"\nThen run npm run deploy:azure again.");
  process.exit(1);
}

run("Tests", "npx jest --runInBand");
run("Typecheck", "npx tsc --noEmit -p .");
run("Build the training", "npx webpack");
run("Build the backend", "npx webpack --config webpack.backend.js");
// The Functions app needs its packages next to it (api/package.json).
run("Install the backend's packages", "npm install --omit=dev --no-audit --no-fund", path.join(root, "api"));
run("Deploy", "npx --yes @azure/static-web-apps-cli@2.1.0 deploy ./dist --api-location ./api --api-language node --api-version 22 --env production");
console.log("\nDeployed. Open the site's address (Azure portal > the static web app > Overview > URL).");
