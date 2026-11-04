# Promethean CCaaS Training — Build Manual

This is the manual for building **Promethean CCaaS Training**: a training app that teaches Dynamics 365 Contact Center (CCaaS) without a Dynamics 365 environment and without real phone numbers. It's written for Claude Code working in this folder, and for Alexander Meijers, who owns the project.

The training is built on top of the **Promethean CCaaS Toolbox** (section 2). The Toolbox is a head start for *building* the training, not its subject: its code runs underneath, and learners never use its tools. Read that section before writing any code: most of what the training needs already exists there.

Written 2026-11-02. Where this manual and the code disagree later, the code is right for *how* things work and this manual is right for *what we're aiming for*. Update this manual when a decision changes.

---

## Contents

1. What we're building
2. The Promethean CCaaS Toolbox, and how the training uses it
3. Architecture
4. The simulated environment
5. Simulated phone numbers and calls
6. Simulated admin pages
7. Explanations from Microsoft Learn
8. The AI: scenarios, callers and feedback
9. Exercises and grading
10. Learners and trainers
11. Repository layout
12. Stack and conventions
13. Phases, each with "done when"
14. Ground rules
15. Open decisions
16. Words used in this manual

---

## 1. What we're building

### The idea

People learn Dynamics 365 Contact Center by doing it: setting up workstreams, queues, routing rules and phone numbers, then calling in to see what happens. Today that needs a Dynamics 365 environment and phone numbers, and both are expensive. The training puts **both inside the app**:

- a **simulated environment**: an in-browser copy of the Contact Center data (the same tables and columns as Dataverse) that the training's code (and the Toolbox code it reuses) reads and writes as if it were real;
- **simulated phone numbers and calls**: fictional numbers, a dial pad in the page, and a routing engine that puts each call through the configuration;
- the **Environment Diagram** (from the Toolbox) to show how everything is connected;
- **simulated admin pages** that show *where* each setting is configured in the Copilot Service admin center;
- **explanations taken from Microsoft Learn**, with a link and a date, so the training keeps up as the product changes;
- **AI-written scenarios**: made-up companies, their contact centers, planted problems, callers and requirements.

### Who it's for

Primary: consultants and administrators who set up Contact Center. Secondary: supervisors and team leads who need to understand routing. (Open decision 15.1: confirm.)

### Principles

1. **No real environment, no real numbers.** The app never calls a real Dataverse environment or a real carrier. Everything runs against the simulator.
2. **The AI writes, the code grades.** The AI writes stories, companies, callers, hints and feedback. Whether an answer is right is decided by code: the Toolbox health checks, the routing simulation and rule checks on the simulated data. The AI never decides alone whether a learner was right.
3. **Explanations come from Microsoft Learn, never from the AI's memory.** Every explanation shows the Learn article it comes from, with its link and date.
4. **Real names.** Tables, columns, menu paths, page names and field labels are the real ones, so what a learner practises transfers to a real environment.
5. **Reuse the Toolbox, don't copy it, and don't teach it.** The training runs the Toolbox's own code (graph, health checks, routing evaluator, Environment Diagram) as a head start. It teaches Contact Center, not the Toolbox: learners don't use the Toolbox's tools. A fix that the training needs in Toolbox code is made in the Toolbox (section 2.4).
6. **Plain language.** The same tone as the Toolbox: short sentences, no jargon that isn't explained, say what happens and what to do.

### What it does not try to teach

Audio quality, carrier and Azure Communication Services setup, Teams integration, licensing, real AI models in Copilot Studio, the agent desktop's every detail, and the Promethean CCaaS Toolbox's tools. The app says so in its help, so nobody thinks the simulation covers these.

---

## 2. The Promethean CCaaS Toolbox, and how the training uses it

### 2.1 Where it is

- Folder: `C:\Users\alexander.meijers\OneDrive - Avanade\Github\Promethean CCaaS Toolbox` (next to this folder).
- GitHub: https://github.com/ameijers/PrometheanCCaaSToolbox (branch `main`).
- License: MIT, copyright Alexander Meijers.
- What it is: 21 tools plus Toolbox Home, as Dataverse web resources (React 18, TypeScript, webpack, jest). Packaged as the Power Platform solution `power_platform_solution/PrometheanCCaaSToolbox_1_0_0_20.zip`.
- Overview: `Readme.md` in the Toolbox root. Each tool has a `README.md`, an `IMPLEMENTATION_STATUS.md` and often a `manual.md` with screenshots.

### 2.2 The tools (deploy key, group)

From `tools/toolbox-home/src/tools.ts`, which is the master list:

| Group | Tool | Folder | Writes? |
| --- | --- | --- | --- |
| Diagnose | Visual Routing Tester | `tools/visual-routing-tester` | no |
| Diagnose | Context Variable Monitor | `tools/context-variable-monitor` | no |
| Diagnose | Agent Readiness Checker | `tools/agent-readiness-checker` | no |
| Diagnose | Environment Artifact Finder | `tools/environment-artifact-finder` | no |
| Visualization | 3D Contact Center | `tools/contact-center-3d` | no |
| Visualization | Environment Diagram | `tools/environment-diagram` | no |
| Visualization | 3D Explorer | `tools/environment-3d-explorer` | no |
| Create in bulk | Voice Workstream Builder | `tools/voice-workstream-builder` | yes |
| Create in bulk | Queue Builder | `tools/queue-builder` | yes |
| Create in bulk | Profile Builder | `tools/profile-builder` | yes |
| Create in bulk | Queue Assignment Method Copier | `tools/assignment-method-copier` | yes |
| Create in bulk | Route-to-Queue Builder | `tools/route-to-queue-builder` | yes |
| Create in bulk | Voicemail Builder | `tools/voicemail-builder` | yes |
| Change and assign in bulk | Recording & Transcription | `tools/voice-recording-provisioner` | yes |
| Change and assign in bulk | Queue Membership | `tools/queue-membership` | yes |
| Change and assign in bulk | Skill Assignment | `tools/skill-assignment` | yes |
| Change and assign in bulk | Capacity Profile Assignment | `tools/capacity-profile-assignment` | yes |
| Change and assign in bulk | Phone Number Changer | `tools/phone-number-changer` | yes |
| Onboard agents | Business Units Builder | `tools/business-unit-builder` | yes |
| Onboard agents | Team Builder | `tools/team-builder` | yes |
| Onboard agents | User Setup | `tools/user-setup` | yes |
| (landing page) | Toolbox Home | `tools/toolbox-home` | no |

### 2.3 What the training reuses

| Toolbox code | What it gives the training |
| --- | --- |
| `tools/environment-3d-explorer/src/model.ts` | The graph model: node kinds (phone, channel, bot, workstream, variable, rule, hours, queue, overflow, agent, capacity, skill, team, business unit), edge kinds, and each kind's Dataverse table. |
| `tools/environment-3d-explorer/src/graph.ts` | `RawEnvironment` (the rows Dataverse returns) and `buildGraph(raw)`. Option-set constants such as `VOICE_STREAM` and `QUEUE_IDENTIFICATION`. |
| `tools/environment-3d-explorer/src/dataverse.ts` | `loadRaw()`: exactly which tables, columns, filters and `$expand`s are read. The simulator must answer all of them. |
| `tools/environment-3d-explorer/src/demoData.ts` | `demoRaw()`: a made-up contact center in Dataverse row shapes. The first seed for the simulator and a reference for scenario JSON. |
| `tools/environment-3d-explorer/src/health.ts` | `findIssues(graph)`: structural health checks with severity, title, detail and fix. **The main grader** for "fix the broken contact center". |
| `tools/environment-3d-explorer/src/ride.ts` | Follow-the-call along the graph (`rideOptions`, `extendRide`, `defaultRideStart`). |
| `tools/environment-3d-explorer/src/live.ts`, `demoLive.ts` | Live activity from `msdyn_agentstatus` and `msdyn_ocliveworkitem` rows. When the call simulator writes those rows, every Live tab works. |
| `tools/environment-3d-explorer/src/tour.tsx` | The guided-tour engine. A model for "show me" mode. |
| `tools/environment-diagram/` | The Environment Diagram: `layout.ts` (pure layout), `Diagram.tsx` (SVG view with `reveal`, `fitAll`, `svg`, `png`), `Centers.tsx`, `App.tsx`. The main picture of the training. |
| `tools/contact-center-3d/src/centers.ts`, `store.ts` | Customer centers (grouping workstreams). Saved per environment under `pct.contactcenter3d.centers.<env>`. |
| `tools/visual-routing-tester/src/evaluator.ts` | `simulate(workstream, model, values, queueValues)`: which route-to-queue rule fires, and the trace. **The routing engine** of the call simulator. |
| `tools/visual-routing-tester/src/operatingHours.ts` | `isWithinOperatingHours(rules, localTime)`. |
| `tools/visual-routing-tester/src/ruleXml.ts` | `parseDecisionXml(xml)`: reads the rule definitions stored in `msdyn_decisionruleset.msdyn_rulesetdefinition`. |
| `tools/visual-routing-tester/src/dataverse.ts` | `loadRoutingModel()`: the routing model the evaluator needs (a second reader, with its own tables). |
| `tools/shared/src/xrm.ts` | `resolveXrm()` finds `Xrm` on the page, its parent or top. `readAll()` follows `@odata.nextLink`. `clientUrl()`, `recordUrl()`. The simulator plugs in here (section 4.3). |
| `tools/shared/src/ProvisioningApp.tsx`, `runner.ts`, `columns.ts`, `model.ts` | The shared kit of the bulk tools: CSV in, plan, preview, run, run log. |
| `tools/*/src/template.ts` and `tools/*/examples/*.csv` | The CSV templates of the bulk tools. The examples are run in tests against the simulator (section 2.5); the templates may later be used for an optional export (section 9.5). |
| `tools/*/tests/readOnly.test.ts`, `writeScope.test.ts` | How the Toolbox proves what each tool may touch. Copy the idea for the simulator's own tests. |

### 2.4 How the code gets into the training

- Add the Toolbox as a **git submodule** at `vendor/toolbox`, pinned to a commit on `main`.
- A webpack and TypeScript path alias `@toolbox/*` → `vendor/toolbox/tools/*`, and a jest `moduleNameMapper` for the same.
- **Never copy Toolbox files into this repo and edit them.** If the training needs a change in Toolbox code (an extra export, a hook, a bug fix):
  1. make it in the Toolbox repo, on a branch, with its tests passing (`npx jest`, `npx tsc --noEmit -p .`, `npx webpack` in the Toolbox root);
  2. merge it there only when Alexander asks (he decides on pushes and solution versions);
  3. move the submodule to the new commit.
- Toolbox changes made for the training must keep every Toolbox tool working in a real Dataverse environment.
- The Toolbox's own rules still apply when working in it. Its deploy script (`scripts/deploy.ps1`) deploys only to the environment in `deploy.config.json` (academyexperiment), and only when Alexander asks. The environment `pt-ccaas-dev` is never written to and never added to that file.

### 2.5 The Toolbox is a head start, not the subject

Decided 2026-11-02: the training teaches Contact Center, not the Toolbox. So:

- **Learners don't see or use the Toolbox's tools.** They make changes the way they would in a real environment: in the simulated admin pages (section 6).
- **The Toolbox's code runs underneath:** the graph, health checks, routing evaluator, live view and tour engine (section 2.3).
- **The Environment Diagram is the one Toolbox page learners see**, as the training's main picture. It runs unchanged against the simulator (section 4.3).
- **The Toolbox's tools are a test bench for the simulator.** Their loaders and write code were tested live against Dataverse, so running them against the simulator in tests proves the simulator behaves like Dataverse (section 4.5).

---

## 3. Architecture

```
┌──────────────────────────────── Browser ─────────────────────────────────┐
│                                                                          │
│  Training shell (React)                                                  │
│   ├─ Lessons and exercises        ├─ Learn panel (explanations + link)   │
│   ├─ Environment Diagram  ◄───────┼──── same store ────►  Admin pages    │
│   ├─ (Diagram in an iframe)       ├─ Dial pad / softphone, agent view    │
│   └─ Grading panel                └─ Clock (move time)                   │
│                    │                          │                          │
│                    ▼                          ▼                          │
│  Simulator ───────────────────────────────────────────────────────────── │
│   ├─ Store: Dataverse-shaped rows per table (IndexedDB)                  │
│   ├─ Web API: Xrm.WebApi + fetch("/api/data/v9.2/…") answered locally    │
│   ├─ Call engine: number → channel → workstream → rules → queue → agent  │
│   │    (Toolbox evaluator + operating hours), writes live rows           │
│   └─ Agents: simulated presence and capacity                             │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS (no secrets in the browser)
┌──────────────────────────────────▼───────────────────────────────────────┐
│  Backend (Azure Functions)                                               │
│   ├─ /ai/*      scenario writing, AI caller, feedback (model API key here)│
│   ├─ /learn/*   Microsoft Learn search and fetch, with a cache           │
│   └─ /progress  learner progress and trainer classes (later phase)       │
└──────────────────────────────────────────────────────────────────────────┘
```

The browser part works **without the backend** for everything except AI and fresh Learn content. Ready-made scenarios and cached explanations ship with the app, so a lesson also runs offline.

---

## 4. The simulated environment

### 4.1 The store

- One store per learner **session**. It holds rows per Dataverse table, keyed by the table's logical name, with the real primary-key and column names (`queueid`, `msdyn_liveworkstreamid`, `_msdyn_defaultqueue_value`…).
- Lookups are stored the way the Web API returns them (`_x_value`), with the `@OData.Community.Display.V1.FormattedValue` and `@Microsoft.Dynamics.CRM.lookuplogicalname` annotations the tools read.
- Option sets use the real values. Take them from the Toolbox (`graph.ts`, `demoData.ts`, each tool's `model.ts`), not from memory. If a value isn't in the Toolbox, look it up on Microsoft Learn (the entity reference pages) and note the source in a code comment.
- Saved in IndexedDB. Learners can **reset** to the scenario's starting point, take a **snapshot**, and **download or upload** a session as a JSON file.

### 4.2 Tables

At least every table the Toolbox reads or writes. From a scan of `tools/*/src`:

- **Routing:** `msdyn_liveworkstream`, `msdyn_routingconfiguration`, `msdyn_routingconfigurationstep`, `msdyn_decisionruleset`, `msdyn_decisioncontract`, `msdyn_ocruleitem`, `msdyn_ocliveworkstreamcontextvariable`, `msdyn_assignmentconfiguration`, `msdyn_assignmentconfigurationstep`, `msdyn_overflowactionconfig`, `msdyn_operatinghour`.
- **Voice:** `msdyn_ocphonenumber`, `msdyn_ocvoicechannelsetting`, `msdyn_ocvoicechannellanguagesetting`, outbound and inbound profiles (`msdyn_voice_inbound_profile`, `msdyn_voice_default_outbound_profile` columns; check the Profile Builder for the exact table).
- **Queues and people:** `queue`, `queuemembership`, `systemuser`, `team`, `teammembership`, `businessunit`, `role`, `bookableresource`, `bookableresourcecharacteristic`, `characteristic`, rating models and values, `msdyn_capacityprofile`, `msdyn_bookableresourcecapacityprofile`, `msdyn_liveworkstreamcapacityprofile`.
- **Other settings:** `msdyn_omnichannelconfiguration`, `msdyn_notificationtemplate`, `msdyn_soundnotificationsetting`, `msdyn_escalationprofile` (as far as the tools touch them).
- **Live:** `msdyn_ocliveworkitem` (conversations), `msdyn_agentstatus` with `msdyn_presence`.
- **Metadata:** `EntityDefinitions` (the Context Variable Monitor reads `LogicalName` and `EntitySetName`).

The first task in phase 1 is to produce the exact list from the code: every `readAll`, `retrieveMultipleRecords`, `retrieveRecord`, `createRecord`, `updateRecord`, `deleteRecord` and `fetch(.../api/data/v9.2/...)` in `vendor/toolbox/tools/*/src`, with its table, columns, filters and expands. Save it as `docs/webapi-surface.md` and keep it current when the Toolbox changes.

### 4.3 The Web API, answered locally

The Toolbox talks to Dataverse in two ways. The simulator answers both:

1. **`Xrm.WebApi`** (`retrieveMultipleRecords`, `retrieveRecord`, `createRecord`, `updateRecord`, `deleteRecord`). The simulator puts a `window.Xrm` object on the page. Toolbox code finds it through `resolveXrm()` in `tools/shared/src/xrm.ts`, which looks on the page, its parent and top. It also provides:
   - `Xrm.Utility.getGlobalContext()` with `getClientUrl()` returning a fixed address such as `https://contoso.sim.ccaas.training` and `userSettings` for the learner;
   - `Xrm.Navigation.navigateTo` and `openUrl`, so links in the Diagram (such as "Open record") open things inside the training.
2. **`fetch` to `<clientUrl>/api/data/v9.2/…`**. Several tools call the Web API directly for `$ref` associations (queue members, team roles), bound actions (`Microsoft.Dynamics.CRM.AddMembersTeam`), functions (`LocalTimeFromUtcTime`) and some creates and updates. The simulator wraps `window.fetch`: requests to the simulated address go to the store; everything else passes through.

OData the simulator must support (what the tools use; confirm against `docs/webapi-surface.md`):

- `$select`, `$filter` with `eq`, `ne`, `and`, `or`, `ge`, `le`, `gt`, `lt`, `null`, `contains`, `startswith`, GUIDs and option-set values;
- `$expand` of single-valued navigation properties with their own `$select`;
- `$orderby`, `$top`, and paging through `@odata.nextLink` (use a small page size in tests, so paging is exercised);
- `@odata.bind` on create and update; `/$ref` POST and DELETE for many-to-many;
- the actions and functions the tools call, nothing more;
- errors in the Web API's shape (`{ error: { code, message } }`), so the tools' own error messages show.

Anything not supported fails loudly, with the request in the message (`Simulator: $apply isn't supported yet`), never silently with empty results.

**The Environment Diagram runs in an iframe** inside the training shell. The iframe page is the tool's own `index.html` and `bundle.js`, built from the submodule, plus one small script loaded first that installs the `Xrm` object and the `fetch` wrapper, both talking to the simulator in the parent page.

**Business rules the platform normally enforces** (required columns, unique names, "a queue member must be a bookable resource", cascade deletes) live in one file, `src/simulator/rules.ts`. Start with the ones the Toolbox's own checks depend on, and add one only with a source on Learn.

### 4.4 Seeds

- Phase 1 seed: convert `demoRaw()` from `tools/environment-3d-explorer/src/demoData.ts` into table rows.
- Later seeds are written by the AI (section 8) in the same row format, then checked.

### 4.5 Tests that prove the simulator is right

- **Same picture both ways:** `buildGraph(demoRaw())` must equal the graph from the Toolbox's own `loadRaw()` running against the simulator seeded with the converted demo rows.
- **Routing model:** `loadRoutingModel()` from the Visual Routing Tester runs against the simulator and gives the routing tester's expected model for the seed.
- **The Toolbox's tools as a test bench:** every tool's loader reads the simulator without an error, and each bulk tool's write code runs its own example CSV (`tools/*/examples/*.csv`) to the end, after which the Diagram's graph shows the new records. The records the examples need live in a test fixture, not in a learner's environment.
- **Unsupported OData fails loudly** (one test per unsupported feature that a tool might reach).

---

## 5. Simulated phone numbers and calls

### 5.1 Numbers

- Only numbers reserved for fiction, so a simulated number can never be a real one:
  - North America: 555-0100 to 555-0199 in any area code, for example `+1 425 555 0142`;
  - United Kingdom (Ofcom's drama ranges): London `+44 20 7946 0000` to `0999`, mobile `+44 7700 900000` to `900999`.
- Add other countries only with an official fiction range and its source.
- A **number pool** page works like getting numbers: choose a country and features (inbound, outbound, voice), and the number becomes a `msdyn_ocphonenumber` row. Assign it to a voice channel in the admin pages.
- The training explains that real numbers come through Azure Communication Services or a carrier, with the Learn link, and that this step is simulated.

### 5.2 A call, step by step

1. The learner dials a number on the **dial pad** (or a scenario places a call).
2. Number → voice channel → workstream, read from the store.
3. **Operating hours** of the workstream or queue are checked with `isWithinOperatingHours` (Visual Routing Tester), against the simulated clock.
4. **Bot**: if the workstream has a bot, a simulated IVR asks the scenario's questions and fills context variables. The learner (or the AI caller) answers with keys or text.
5. **Route-to-queue rules** run through `simulate()` from the Visual Routing Tester, which returns the queue and the trace of rules checked.
6. **Overflow** before and in queue: the queue's overflow rules and actions (voicemail, callback, transfer, end call), with the triggers the routing tester already models.
7. **Assignment** to an agent: presence, capacity and skills, with the queue's assignment method. This is the simplified part: write it in `src/simulator/assignment.ts`, base each rule on a Learn article (linked in a comment), and show "Simplified" in the trace where the real platform does more.
8. The call is offered to the agent, accepted, talked through, ended, and wrapped up.

At every step the simulator writes the rows the real platform would: `msdyn_ocliveworkitem` with state, status, queue (`_msdyn_cdsqueueid_value`), workstream and agent (`_msdyn_activeagentid_value`), and `msdyn_agentstatus` changes. Because those are the rows the Toolbox's live view reads, **the Live tabs of the Environment Diagram, 3D Contact Center and 3D Explorer work on simulated calls with no extra code**.

The **call trace** (each step, the rule or setting that decided it, and the Learn article that explains it) is shown next to the call and saved with the session.

### 5.3 Agents

- Agents are the scenario's `systemuser` rows with bookable resources, skills, capacity profiles and queue memberships.
- Each agent has a simulated presence (available, busy, do not disturb, away, offline) and capacity in use. The scenario sets starting values and simple behaviour (for example "Noor goes on a break at 10:30").
- The learner can **take a call as an agent** in a simple agent view: accept, reject, hold, transfer, end, wrap up.

### 5.4 The clock

The simulated clock can run in real time, run faster, or jump ("Monday 22:00", "Christmas Day"). Operating hours and the time-zone function (`LocalTimeFromUtcTime`) use it.

### 5.5 The AI caller

In scenario calls the caller is played by the AI: a persona with a reason to call, a language, a mood, and the answers the IVR asks for. Text first. Speech (the browser's speech synthesis and recognition) is an optional later step, and the training must work without it.

---

## 6. Simulated admin pages

### 6.1 What they're for

They show *where* each setting is configured in the Copilot Service admin center (check the current product name on Learn at build time), with the real menu path, page names and field labels. The Environment Diagram shows *how* things connect; the admin pages show *where* they're set.

### 6.2 Same names, own look

- Menu paths, page names, section names and field labels match Microsoft's exactly: they're what the learner must find later.
- The **look is our own**. Use Fluent UI React v9 (`@fluentui/react-components`, MIT, Microsoft's open-source design system) for a familiar feel. No Microsoft logos or product icons, and no copies of Microsoft's screens.
- A fixed banner on every admin page: "Training simulation by Promethean Academy, not Microsoft's admin center", with links to the real admin center and the Learn article for the page.
- Nothing on these pages asks for a sign-in or real credentials.

### 6.3 Pages are data

Every page is a definition file in `content/admin-pages/`, not hand-written UI:

```json
{
  "id": "workstream-routing-rules",
  "path": ["Customer support", "Workstreams", "{workstream}", "Routing rules"],
  "title": "Routing rules",
  "table": "msdyn_liveworkstream",
  "sections": [
    {
      "title": "Route to queues",
      "kind": "ruleList",
      "source": "msdyn_decisionruleset",
      "learn": "https://learn.microsoft.com/…/configure-route-to-queue-rules"
    }
  ],
  "fields": [
    { "label": "Fallback queue", "column": "_msdyn_defaultqueue_value", "kind": "lookup", "target": "queue",
      "learn": "https://learn.microsoft.com/…" }
  ],
  "checkedAgainstLearn": "2026-11-02"
}
```

A small set of generic page parts (record list, form, rule list, lookup, toggle, time-table) renders every definition. When Microsoft changes the admin center, updating the training means editing these files.

### 6.4 Linked to the diagram

- In the Environment Diagram, **"Where is this configured?"** on a selected shape opens its admin page with the field highlighted and the menu path visible.
- A change saved on an admin page changes the store, and the diagram redraws straight away.
- **"Show me" mode**: a cursor walks the menu path step by step, with the Learn explanation of each field. It builds on the Toolbox tour engine's ideas (`tour.tsx`).

### 6.5 Order of pages

1. Workstreams and their routing rules (phase 3).
2. Queues: members, operating hours, overflow, assignment method.
3. Voice channels and phone numbers.
4. Users as agents: capacity profiles, skills, presence.
5. Operating hours, capacity profiles, skills.

### 6.6 Staying current

Learn articles describe the steps ("In the site map of Copilot Service admin center, select **Workstreams** in **Customer support**"). A backend job compares each page definition's path and labels with its Learn article and lists the pages that look out of date, for a person to fix. It never changes a definition by itself.

---

## 7. Explanations from Microsoft Learn

### 7.1 Source

- Microsoft Learn's public search and article content. Microsoft offers a Learn MCP server (`https://learn.microsoft.com/api/mcp`, with search and fetch tools) and the article pages themselves. Check the current endpoints and terms at build time and record them in `docs/learn-source.md`.
- Calls go through the backend (`/learn/*`), which caches results.

### 7.2 Concepts map to articles

`content/concepts.json` lists every concept the training explains: one per node kind in the Toolbox model (`model.ts` `KINDS`), one per admin-page field, and one per routing step. Each concept has a short plain-language summary, written once and reviewed by a person, and one to three Learn articles.

### 7.3 What the learner sees

- The training's short summary of the concept.
- The relevant passage from the Learn article, quoted, with the article title, link and the article's own date (`ms.date` or "updated" date).
- "Read the full article on Microsoft Learn".

### 7.4 Rules

- No explanation without a source. If Learn can't be reached and there's no cache, show the summary and say the explanation couldn't be loaded.
- The AI may shorten or simplify a Learn passage for a hint, but the hint shows the passage it came from.
- When an article's date changes, the concepts that use it are listed for review ("Learn changed: check these summaries and exercises").
- Respect Learn's terms of use; quote passages, don't mirror whole articles.

---

## 8. The AI: scenarios, callers and feedback

### 8.1 Where it runs

Only in the backend. The model's API key never reaches the browser. One interface, `AiProvider` (`complete(prompt, schema)` and `chat(messages)`), so the provider can be Claude (Anthropic API) or Azure OpenAI (open decision 15.3). Send no personal data about learners to the model.

### 8.2 What it writes

| Job | Input | Output (JSON, checked against a schema) |
| --- | --- | --- |
| Scenario | level, topics, company type, country, faults wanted | company story, seed rows, planted faults, goals, checks (section 9) |
| Caller | scenario, persona, IVR prompts | caller lines and IVR answers, call by call |
| Customer interview | scenario requirements | answers to the learner's questions, without giving the solution away |
| Feedback | the learner's change, the grader's result, Learn passages | short feedback and a hint that cites a Learn passage |

### 8.3 Every scenario is checked before a learner sees it

1. The JSON matches the schema.
2. The seed rows load into the simulator and `buildGraph` builds a graph without warnings.
3. `findIssues` (Toolbox health checks) finds **exactly** the planted faults, no more and no fewer, unless an extra one is listed as intended.
4. Each "where does this call go?" question gives the stated answer when run through the call engine.
5. Each "build to requirements" goal fails on the starting data and passes on the scenario's reference solution.

A scenario that fails a check is sent back to the AI with the failure, up to three times, then dropped. Scenarios that pass are saved to `content/scenarios/` (or the backend's store) and reused. Generating isn't needed for every learner.

### 8.4 Costs

Cache scenarios, and set limits per learner and per day. Ready-made scenarios ship with the app, so a class can run without AI calls.

---

## 9. Exercises and grading

### 9.1 Kinds

| Kind | The learner | Graded by |
| --- | --- | --- |
| **Explain** | clicks any shape or field and reads what it is and why it matters | nothing (reference) |
| **Fix the broken contact center** | finds and fixes 3–5 planted faults, in the admin pages | `findIssues` from the Toolbox: the planted faults are gone and no new problems appeared |
| **Where does this call go?** | predicts where a call ends ("a Spanish speaker calls at 22:00 about billing") | the call engine's result and trace |
| **Build to requirements** | builds what a company asks for | checks on the store and on calls (9.2) |
| **Customer interview** | asks an AI customer questions to find the requirements, then builds | a checklist of requirements found, then 9.2 |
| **My own environment** (later, optional) | loads an export of their own environment and asks "explain this" | nothing (reference) |

### 9.2 Checks are data

A scenario's checks are declarative, so code decides, not the AI:

```json
[
  { "type": "row", "table": "queue", "where": { "name": "Billing" }, "expect": { "_msdyn_operatinghourid_value": { "lookupName": "Office hours NL" } } },
  { "type": "health", "expectNo": ["routes-nowhere", "missing-default-queue"] },
  { "type": "call", "dial": "+44 20 7946 0123", "at": "2026-11-02T22:00:00+01:00", "ivr": { "Language": "Spanish" },
    "expect": { "outcome": "Voicemail", "queue": "Billing ES" } }
]
```

The grading panel shows each check as passed or not, in plain words, with a link to the concept behind it.

### 9.3 Levels

1. One number, one channel, one workstream, one queue.
2. Route-to-queue rules and context variables (IVR choices).
3. Operating hours, overflow and voicemail.
4. Skills, capacity profiles and assignment methods.
5. Several workstreams, outbound profiles, and onboarding (business units, teams, users). (Customer centers dropped 2026-11-04: they're a Toolbox viewer grouping, not a product setting.)

Every level has ready-made scenarios, and the AI can write more.

### 9.4 Hints

Three steps per check: what area to look at; which setting; then the Learn passage. Using a hint is noted, not punished.

### 9.4a Forgiving checks (Alexander, 2026-11-03)

Small typing slips must not block a learner. Checks treat two kinds of input differently:

- **Names the learner chooses** (a queue's name, a rule's name): the check looks at what the record *does*, not its exact name. Example: "a voice queue that the Repairs rule routes to, with at least two users" instead of "a queue named Repairs". A name close to the brief's (case, plural, one or two letters off) passes, with a friendly note.
- **Values that must match the system** (a rule's value against what the IVR sends, a phone number): a mismatch breaks routing in a real environment too, so the call really goes elsewhere. The check then says exactly why ("The IVR sends **Repairs**, your rule checks **Repair**"), and the learner can fix it. That needs **Edit** and **Delete** on rules in the admin pages. (Done 2026-11-03: names within one or two letters pass with a note; a misrouting rule is explained; the decision list has Edit, Delete, Move up and Move down.)

### 9.4b Variety (Alexander, 2026-11-03)

A lesson shouldn't be the same every time. Two layers:

- **Lessons as templates**, before any AI: a lesson describes a pattern ("a new IVR choice needs its own queue and rule"); each run picks its details (company, menu choice, phone line, agents) from the simulated environment. Checks are written against the picked details, so every variant can be checked. (Done 2026-11-03 for "A new menu choice": each run picks one of three lines with an IVR and a new choice that fits that line; every variant is played through by code in tests/lessons/variants.test.ts. "Start again" gives a new variant.)
- **AI on top** (phase 5): the AI writes the story, the company, the caller and new patterns; code still decides what's right (principle 2), and every variant is played through by code before a learner sees it (8.3).

### 9.5 From the training to a real environment

Optional, later, and only if Alexander wants it: a design built in the training can be **exported as the Toolbox's CSV templates** (`tools/*/src/template.ts`): workstreams for Voice Workstream Builder, queues for Queue Builder, rules for Route-to-Queue Builder, members for Queue Membership, and so on. The Toolbox can then build it in a real environment. The export uses the template definitions from the submodule, so it stays in step with the Toolbox.

---

## 10. Learners and trainers

- **Self-study:** pick a level or topic, get a scenario, work through it. Progress is saved in the browser at first, then in the backend (phase 6).
- **Trainer mode:** a trainer picks or generates a scenario, gets a class link and a code, and sees each learner's progress per check. No personal data beyond a display name and, if Alexander decides so, a sign-in (open decision 15.5).
- **Help and tour:** a guided tour of the training itself, in the style of the Toolbox tours.

---

## 11. Repository layout

```
Promethean CCaaS Training/
  CLAUDE.md                     short rules for Claude; points here
  README.md                     what it is, how to run it, link to the Toolbox
  LICENSE
  docs/
    BUILD_MANUAL.md             this manual
    webapi-surface.md           every Web API call the Toolbox makes (phase 1)
    learn-source.md             Learn endpoints and terms (phase 4)
    decisions.md                decisions as they're made, with dates
  vendor/toolbox/               git submodule: Promethean CCaaS Toolbox
  src/
    shell/                      app frame, navigation, lessons, grading panel
    simulator/
      store.ts                  rows per table, IndexedDB, snapshots
      odata.ts                  query parsing and evaluation
      webapi.ts                 Xrm.WebApi + fetch answers
      xrmShim.ts                window.Xrm for the shell and the tool iframes
      rules.ts                  platform rules the simulator enforces
      seeds/                    demo seed converted from demoRaw()
    calls/
      engine.ts                 a call step by step (uses the Toolbox evaluator)
      assignment.ts             simplified assignment, each rule linked to Learn
      clock.ts
      numbers.ts                fictional number ranges
      agents.ts
      DialPad.tsx, AgentView.tsx, CallTrace.tsx
    admin/
      pages/                    generic page parts
      AdminCenter.tsx
    learn/                      concept panel, cache client
    exercises/                  kinds, checks, grading
    tools/                      runs the Environment Diagram in an iframe (bridge.ts)
  content/
    concepts.json
    admin-pages/*.json
    scenarios/*.json
  backend/                      Azure Functions: ai, learn, progress
  tests/
```

---

## 12. Stack and conventions

- Same as the Toolbox where possible, so code moves easily: React 18, TypeScript (strict), webpack 5, jest with ts-jest. Fluent UI React v9 for the admin pages; the shell may use it too. Three.js and react-three-fiber only through the Toolbox's 3D tools.
- Backend: Azure Functions (Node, TypeScript). Hosting: Azure Static Web Apps, or another host Alexander picks (open decision 15.4).
- Every source file starts with the Toolbox's header:
  ```
  // Copyright (c) 2026 Alexander Meijers
  // SPDX-License-Identifier: MIT
  ```
  (MIT, decided 2026-11-02.)
- Pure logic (OData, call engine, checks, layout) in plain `.ts` files with unit tests; React only for showing things.
- UI text: plain language, short, says what to do. British or American spelling: follow the Toolbox (American "color" in code, plain English in text).
- Comments explain *why*, briefly.
- Before saying something is done: `npx jest`, `npx tsc --noEmit -p .` and `npx webpack` pass, and the page has been opened and looked at (headless screenshots work: see 12.1).

### 12.1 Screenshots without a person

As in the Toolbox: serve the build with `npx serve`, open it with Edge headless (`--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=25000 --screenshot=<path without spaces>`), save to the scratchpad and copy. Open the root address (`http://localhost:PORT/?…`), because `serve` drops the query string when it redirects to `index.html`. Give each run a timeout.

---

## 13. Phases, each with "done when"

### Phase 0 — Set up the project

- `git init`, README, LICENSE, `.gitignore`, the Toolbox as a submodule, webpack, TypeScript, jest, and the `@toolbox` alias.
- **Done when:** a test imports `buildGraph` and `demoRaw` from `@toolbox/environment-3d-explorer/src/…` and builds the demo graph; `npm run build` makes an empty shell page.

### Phase 1 — The simulator, with the Environment Diagram on it

- `docs/webapi-surface.md` from the Toolbox code.
- Store, OData, Web API, `Xrm` and `fetch` shims, demo seed.
- The Environment Diagram from the Toolbox, running in the shell against the simulator.
- **Done when:** the tests in 4.5 "same picture both ways" and "routing model" pass; the Diagram shows the demo contact center from the simulator; a screenshot proves it.

### Phase 2 — Writes, checked with the Toolbox's code

- Writes in the simulator: create, update, delete, `$ref`, the actions the Toolbox code uses, and what the platform does by itself (`rules.ts`).
- The Toolbox's tools run against the simulator in tests only (section 2.5). Learners don't see them.
- **Done when:** every tool's loader reads the simulator without an error; each bulk tool's write code runs its example CSV to the end in a test; the Diagram's graph shows the result. (Done 2026-11-02. First built with the tools in the learner's view; changed the same day, see section 2.5.)

### Phase 3 — One complete lesson

Changed 2026-11-02: one lesson end to end before building out, so the training feels like training early. The lesson is hand-written (no AI yet), and its Learn passages are quoted in the content (no backend yet).

- The learner's screen: a lesson panel (story, tasks that tick off by themselves, hints), a workspace with **Admin center**, **Diagram** and **Phone** tabs, and a Learn strip with the passage for the current task.
- Admin center: its frame (site map, breadcrumb, training banner) and the pages the lesson needs: Queues (list, **Create a queue**, the queue page with **Add users** and **Assignment method**) and Workstreams (list, the workstream page with **Routing rules**, **Route to queues**, **Create route to queue rule**, and **Fallback queue**). Names from Learn, look from Fluent UI.
- Phone: dial a number, answer the IVR, and see the call trace. The call engine uses the Toolbox's routing model and evaluator, and writes the call as a live work item so the Diagram's Live tab shows it.
- Checks as data (section 9.2): a row exists, a queue has members, a call ends in a queue, the learner made such a call.
- First lesson: "A new menu choice": route the IVR's new "Repairs" choice to a new Repairs queue.
- **Done when:** the lesson can be finished in the browser using only the admin center and the phone; every task ticks off by itself; each task shows its Learn passage with link and date; the Diagram shows the new queue and the call. (Done 2026-11-02: `npm run walkthrough` plays it to the end.)

Still to come, from the old phase 3: number pool, clock and operating hours, simulated agents and assignment, the agent view, and "Where is this configured?" from the Diagram. (All done since: "Where is this configured?" in phase 4, operating hours in phase 5, the rest in phase 6.)

### Phase 4 — Microsoft Learn

- Backend `/learn/*` with cache; `content/concepts.json` for every node kind and every field on the phase 3 pages; the Learn panel.
- **Done when:** every shape kind and phase 3 field shows a summary, a quoted Learn passage, its link and date; with the backend off, the cached version shows. (Done 2026-11-03, with the backend running locally (decision 15.4): 20 concepts, one per Diagram shape kind plus the phase 3 pages, each quote confirmed in its live article by npm run learn:review. The Diagram's Open record shows the shape's explanation and, for a queue or workstream, opens its admin page.)

### Phase 5 — AI scenarios and the first exercises

- Backend `/ai/*`, `AiProvider`, scenario schema, the checks in 8.3, the AI caller.
- Exercises: "Fix the broken contact center" and "Where does this call go?", levels 1–3, with ready-made scenarios.
- **Done when:** 10 generated scenarios pass every check in 8.3; a learner can finish one of each exercise kind and see their grade; the app runs a ready-made scenario with the AI switched off. (Built 2026-11-03, see docs/scenarios.md: both exercise kinds with grades, five ready-made scenarios that pass every check in 8.3, operating hours and overflow in the call engine, the backend AI with Claude, the write-check-retry loop and the AI caller. Done 2026-11-04 on the hosted training with Azure OpenAI (gpt-5-mini): 10 of 10 AI-written scenarios passed every check in 13 requests (scripts/ai-generate-live.js); one was then dropped by a person for describing symptoms the training does not have (voicemail), and the prompt now lists the true symptoms of each fault. "Fix" covers levels 1 and 2, because the health checks don't look at hours or overflow.)

Changed 2026-11-03: the old phase 6 ("More of everything") was split into phases 6 to 9, and work the manual describes but no phase had (assignment to representatives, the agent view, the clock, the number pool, going live) got a place.

### Phase 6 — Agents and the clock

- Assignment to a representative (5.2 step 7, 5.3) in `src/calls/assignment.ts`: presence, capacity and skills, with the queue's assignment method. Each rule based on a Learn article, linked in a comment; "Simplified" in the trace where the platform does more.
- The agent view: the learner takes a call as a representative (accept, reject, end, wrap up). The call's rows (`msdyn_ocliveworkitem` with its agent, `msdyn_agentstatus`) are written as the platform does, so the Diagram's Live tab shows them.
- The clock (5.4): real time, faster, or a jump to a day and time; operating hours and calls use it.
- The number pool (5.1): get a fictional number and put it on a voice channel in the admin pages.
- **Done when:** a call goes from ring to a representative who takes it in the agent view, and the Live tab shows it; a call at a time from the clock follows operating hours; a new number from the pool rings a workstream; each assignment rule has its Learn link. (Done 2026-11-03: src/calls/assignment.ts with Least active, Highest capacity and Advanced round robin from Learn's "Assignment methods for queues", presence and capacity profiles; the routing runtime and the clock (routing.ts, clock.ts); the Agent tab; Channels › Phone numbers with Add ACS number and Setup workstream, handing out fictional numbers. Played in Edge by scripts/agent.js and scripts/numbers.js. Simplified, and said so in the code: no skills, no queue priority across queues, simulated calls last 3 to 8 minutes, and the times round robin and least active need are kept in a training table, training_assignment, because Learn doesn't document the real one.)

### Phase 7 — More exercises

- Levels 4 and 5 (9.3), "Build to requirements" and "Customer interview" (9.1), AI-written feedback and hints that cite a Learn passage (8.2, 9.4), and the rest of the admin pages (6.5) the exercises need.
- **Done when:** every kind and level has ready-made scenarios that pass 8.3, including check 5; a learner can finish one of each new kind. (Done 2026-11-03, see docs/scenarios.md: "Build to requirements" at levels 1 to 5 and "Customer interview" at levels 2 and 4, made of goal types that each give their checks and a reference solution in code (src/scenarios/goals.ts); 12 ready-made scenarios pass every check; the AI customer and AI hints in the backend; new admin pages: Set operation hours, Overflow handling, User management › Capacity profiles, New workstream. Played in Edge by scripts/build.js. Added 2026-11-04: skills (Skills hub, skill attachment rules, Exact and Closest Match, scripts/skills.js) and outbound profiles (Productivity › Outbound and inbound profiles). Customer centers are left out: they're the Toolbox's own way of grouping workstreams in its viewers (contact-center-3d/src/centers.ts: "Dataverse has no such grouping"), not a product setting. Also added 2026-11-04: business units and teams, in a simulated Power Platform admin center, with the ready-made scenario "A home for the new parts team", played by scripts/onboarding.js.)

### Phase 8 — Classroom

- Trainer mode and class codes (10), progress saved in the backend, sign-in (decision 15.5), and the training's own guided tour.
- **Done when:** a trainer can give a class a scenario and see each learner's progress per check. (Done 2026-11-03, see docs/classroom.md: class codes (decision 15.5), the trainer's page with progress per learner and check, progress kept by the backend, finished exercises ticked in the list, and the training's own tour on the Toolbox's tour engine. Played in Edge by scripts/classroom.js.)

### Phase 9 — Going live

- Hosting (decision 15.4), name and branding (15.8), Microsoft's terms for quoting Learn (docs/learn-source.md), AI limits per learner as well as per day (8.4), and a security and accessibility check.
- **Done when:** the training runs at its public address, and the checks are written up. (Prepared 2026-11-03, see docs/hosting.md and docs/security.md: the backend as Azure Functions (backend/src/functions.ts, api/), Table Storage for classes and usage, staticwebapp.config.json with a strict Content Security Policy checked by scripts/csp.js, a deploy workflow that only runs by hand, the per-learner AI limit, the security and accessibility checks (scripts/a11y.js, axe-core) with their fixes, and Learn's terms read: the quoted documentation is CC BY 4.0, credited in the Learn strip. Name and branding kept (decision 15.8). Live since 2026-11-04 at https://gray-mushroom-00ea8790f.4.azurestaticapps.net, with Azure OpenAI as the AI. Alexander confirmed the reading of the terms and did the keyboard and screen-reader pass on 2026-11-04.)

Optional, not planned in a phase: exporting a design as the Toolbox's CSV templates (9.5), "My own environment" (9.1), and speech for the AI caller (5.5). (2026-11-04: the export is done, src/export/toolboxExport.ts, the Export button, with each file read back by the Toolbox's own readRows in tests; speech is done as reading the call aloud with the browser's speech synthesis, src/calls/speech.ts, off by default; speech recognition is left out because Edge and Chrome send the microphone's audio to an online service. "My own environment" waits for a decision: the Toolbox has no export of an environment yet.)

Each phase ends with a short demo for Alexander: screenshots and what to try. Don't start the next phase until he has seen it.

---

## 14. Ground rules

- **No real environments.** The training never connects to a real Dataverse environment. In particular, `pt-ccaas-dev` (https://pt-ccaas-dev.crm4.dynamics.com) is never written to or added to any configuration, in either project.
- **The Toolbox stays safe.** Changes to the Toolbox go on a branch in the Toolbox repo, keep its tests green, and keep every tool working in a real environment. Deploy the Toolbox only when Alexander asks.
- **Git:** branch first when on `main`. Commit and push only when Alexander asks. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  Pull request descriptions end with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Secrets:** API keys only in the backend's settings, never in the repo or the browser.
- **Microsoft's name and brand:** the admin pages use Microsoft's names for menus and fields, but not its logos or screen designs, and every page says it's a training simulation (6.2).
- **Phone numbers:** only the fiction ranges in 5.1.
- **Facts about the product:** from Microsoft Learn or from the Toolbox code (which was tested live), never from memory. Where a behaviour is simplified, say so in the UI.

---

## 15. Open decisions

Ask Alexander before the phase that needs the answer, and note it in `docs/decisions.md`.

1. **Audience:** consultants and administrators first, supervisors second? (needed by phase 5)
2. **GitHub:** ~~a new repo `ameijers/PrometheanCCaaSTraining`, public or private?~~ Decided 2026-11-02: private (see `docs/decisions.md`).
3. **AI provider:** Claude (Anthropic API) or Azure OpenAI? (phase 5)
4. **Hosting:** Azure Static Web Apps with Functions, or another host? (phase 4)
5. **Sign-in and progress:** anonymous with a class code, or a sign-in (Entra ID or other)? (phase 6)
6. **License:** ~~MIT like the Toolbox, or another?~~ Decided 2026-11-02: MIT.
7. **Language of the training:** English only, or also Dutch? (phase 4)
8. **Name and branding:** "Promethean CCaaS Training" under Promethean Academy (https://promethean.academy)? (phase 0)

---

## 16. Words used in this manual

- **CCaaS:** Contact Center as a Service; here Dynamics 365 Contact Center.
- **Simulator:** the in-browser copy of the Dataverse data plus the code that answers Web API calls and runs calls.
- **Store:** the simulator's rows, per table.
- **Seed:** the rows a scenario starts with.
- **Scenario:** a made-up company with its contact center (seed), story, planted faults, goals and checks.
- **Check:** a rule, written as data, that code uses to decide whether a goal is met.
- **Call trace:** the list of steps a simulated call went through, with what decided each step.
- **Toolbox:** the Promethean CCaaS Toolbox (section 2).
