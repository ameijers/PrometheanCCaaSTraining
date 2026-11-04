# Hosting the training

Phase 9, decision 15.4: Azure Static Web Apps, with the backend as Azure Functions. Everything is prepared; nothing has been deployed. Deploy only when Alexander says so.

## What goes where

| Part | Hosted as | From |
| --- | --- | --- |
| The training (browser) | Static Web Apps' static content | `dist/` (`npm run build`), with [public/staticwebapp.config.json](../public/staticwebapp.config.json) copied into it |
| The backend | Static Web Apps' managed Functions, under `/api` | `api/` (`npm run backend:build` writes `api/dist/index.js` from [backend/src/functions.ts](../backend/src/functions.ts)) |
| Classes, progress, AI usage, AI scenarios | Azure Table Storage, one table named `training` | [backend/src/tableStore.ts](../backend/src/tableStore.ts) |
| Learn articles | fetched by the backend, cached in the function's temporary folder | unchanged |

The browser finds the backend by itself: `http://localhost:7071` on this machine, `/api` on any other address ([src/learn/client.ts](../src/learn/client.ts)).

## One-time setup in Azure

1. **A storage account** (Standard, general-purpose v2). Copy its connection string (Access keys).
2. **A static web app.** Plan: Free is enough to try it; Standard if you need custom authentication, networking rules or a bigger quota. Deployment source: *Other* (the workflow deploys it with a token). Copy the deployment token (Manage deployment token).
3. **App settings** of the static web app (Settings > Environment variables):

| Setting | Value |
| --- | --- |
| `SITE_ORIGIN` | the site's address, e.g. `https://<name>.azurestaticapps.net` (only pages from there may write) |
| `STORAGE_CONNECTION_STRING` | the storage account's connection string |
| `ANTHROPIC_API_KEY` and optionally `AI_MODEL` | for Claude (decision 15.3) |
| or `AI_PROVIDER=azure-openai`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` | for Azure OpenAI |
| `AI_DAILY_LIMIT`, `AI_LEARNER_LIMIT` | optional; 40 and 15 by default |

   Without an AI key the training runs on its ready-made scenarios. Without a storage connection string the backend keeps classes in its temporary folder, which is lost when it restarts: fine for a look, not for a class.

4. **GitHub secrets** of the repo: `AZURE_STATIC_WEB_APPS_API_TOKEN` (the deployment token), and `TOOLBOX_TOKEN` (read access to the Toolbox repo, if it's private, so the submodule can be checked out).

## Deploying

**From this computer, without GitHub** (the static web app's source is *Other*): put the deployment token in an environment variable for this terminal only, then run the deploy script. It runs the tests and the typecheck, builds the site and the backend, installs the backend's packages and deploys with the Static Web Apps CLI ([scripts/deploy-azure.js](../scripts/deploy-azure.js)). The token is never written to a file or printed.

```
$env:SWA_CLI_DEPLOYMENT_TOKEN = "<token>"
npm run deploy:azure
```

**From GitHub**, once the repo is there: Actions > **Deploy the training** > Run workflow ([.github/workflows/azure-static-web-apps.yml](../.github/workflows/azure-static-web-apps.yml)). It runs the tests and the typecheck, builds the site and the backend, and deploys both. It never runs on a push.

## After the first deploy

- Open the site, select **Tour**, and run an exercise. Check the AI's status in **Choose an exercise** (it says whether the AI is on, or why not).
- Create a class and join it from another browser: progress should show on the trainer's page.
- The Content Security Policy and other headers come from the config file; `node scripts/csp.js` checks the policy against the pages before deploying.

## Not done here

- A custom domain (Static Web Apps > Custom domains), if Promethean Academy wants one.
- Sign-in with Entra ID (decision 15.5 chose class codes; Entra ID can come later).
- Monitoring (Application Insights on the Functions).

The steps above follow Microsoft Learn's "Configure Azure Static Web Apps" (ms.date 2024-05-24) and "Build configuration for Azure Static Web Apps" (ms.date 2024-11-04). Check them again when deploying: portal screens change.
