# Scenarios and the AI

How the training's exercises are made and graded (manual sections 8 and 9), as built in phase 5.

## Four exercises

- **Fix the broken contact center** (levels 1 and 2). The scenario plants faults in a healthy environment. The learner finds them (the Diagram's health checks mark problems) and fixes them in the admin center. Each fault ticks off when the Toolbox's `findIssues` no longer finds it; a change that breaks something else shows as a new problem.
- **Where does this call go?** (levels 1 to 3). The learner predicts where each call ends, from three or four answers. The call engine places the call and grades the answer, then shows the call step by step.

- **Build to requirements** (levels 1 to 5). The company asks for something; the learner builds it in the admin center. Each requirement ticks off when its checks pass.
- **Customer interview** (levels 2 and 4). The same, but the learner first finds the requirements by asking the customer questions: picked from a list, or, with the AI on, their own.

Level 3 is about operating hours and overflow, which the health checks don't look at, so "Fix" stops at level 2 for now.

## Goals: what "Build to requirements" asks for

[src/scenarios/goals.ts](../src/scenarios/goals.ts) has the goal types. Each gives, in code, the requirement in plain words, the checks that decide it (names the learner types are forgiving), three hints, and a reference solution made only of the admin center's actions.

| Goal | Level | What it asks |
| --- | --- | --- |
| `members` | 1 | a queue has at least N members |
| `fallback` | 1 | a workstream's fallback queue |
| `choice-queue` | 2 | a new IVR choice reaches a new voice queue with N members |
| `operation-hours` | 3 | a queue keeps an operating hours record |
| `after-hours` | 3 | calls out of hours get voicemail, a callback or end |
| `long-wait` | 3 | a long predicted wait gets a callback or voicemail |
| `assignment-method` | 4 | a queue's assignment method |
| `capacity` | 4 | a capacity profile's work item limit |
| `new-line` | 5 | a new voice workstream with a phone number, into a queue |
| `business-unit` | 5 | a new business unit under a given parent |
| `team` | 5 | an owner team in a business unit, with at least N members |
| `skills` | 4 | Exact Match on a workstream, a skill attachment rule for an IVR choice, and at least N queue members with the skill |
| `outbound-profile` | 5 | an outbound profile with a number that can make calls, whose calls belong to a queue |

Skills are simulated in src/calls/skills.ts: User management › Skills hub, the workstream's Work classification (skill attachment rules) and Work distribution › Default skill matching algorithm. Exact Match leaves a call unassigned until someone with the skill can take it; Closest Match is simplified (it puts those with the needed skills first). The rules are kept in a training table, training_skillrule, because Learn doesn't document how the platform stores them. Outbound profiles are under Productivity › Outbound and inbound profiles, stored as an outbound workstream with one voice channel, as the Toolbox's Profile Builder does. Played by scripts/skills.js.

Business units and teams are set up in a simulated Power Platform admin center (Settings › Users + permissions › Business units and Teams), reached with the switch at the top of the admin center's site map. Its labels come from Learn and haven't been checked in the real admin center yet. Learn doesn't name the button that creates a team, so the training uses Save. Played by scripts/onboarding.js.

Check 5 of manual 8.3 runs every goal: its checks fail at the start, the reference solution is applied, and then they pass without new problems.

## Where a scenario starts

- [src/simulator/seeds/healthy.ts](../src/simulator/seeds/healthy.ts): the training environment with the Toolbox demo's nine planted problems fixed. A test proves the health checks find nothing in it.
- [src/simulator/seeds/hours.ts](../src/simulator/seeds/hours.ts): real operating hours (calendars in the shape the Visual Routing Tester reads) and real overflow rules (written by Voicemail Builder's `ruleXml`). The demo had neither, so its overflow rules fired on every call.
- [src/scenarios/world.ts](../src/scenarios/world.ts) plants a scenario's faults. Three kinds, each found by a Toolbox health check and fixable in the admin center:

| Fault | What's planted | Health check | Fixed in the admin center by |
| --- | --- | --- | --- |
| `no-members` | every member taken out of a queue calls are routed to | No members | Queues › the queue › Add users |
| `fallback-queue-off` | the workstream's fallback queue points to a switched-off queue | Default queue not found | Workstreams › the workstream › Fallback queue › Edit |
| `rule-queue-off` | a route-to-queue rule points to a switched-off queue | Routes to a queue that's gone | the workstream's rules › Edit the rule |

## Every scenario is checked before a learner sees it

[src/scenarios/validate.ts](../src/scenarios/validate.ts) runs the checks of manual 8.3 on any scenario, written by a person or by the AI:

1. The shape is right for its kind and level (number of faults or calls, no phone numbers in the text, times only at level 3).
2. Its environment loads, and the Toolbox builds the graph and the routing model without warnings.
3. The health checks find exactly the planted faults. A rule moved to a switched-off queue also leaves its old queue with nothing routing to it; that warning is listed as intended.
4. Every call ends where the scenario says when the call engine places it. Calls to a rule that picks a queue at random are refused.
5. Every goal fails at the start and passes after its reference solution, without new problems. An interview has a question for every goal.

Ready-made scenarios are in [content/scenarios/ready-made.json](../content/scenarios/ready-made.json), one for every kind and level, and pass the same checks ([tests/scenarios/readyMade.test.ts](../tests/scenarios/readyMade.test.ts)). They run with the AI switched off.

## The AI

- Only the backend talks to the AI ([backend/src/ai/](../backend/src/ai/)), through one interface, `AiProvider`. Two providers are built. `AI_PROVIDER` in `backend/.env` picks one; without it, the one with a key is used ([choose.ts](../backend/src/ai/choose.ts)):
  - **Claude** ([claude.ts](../backend/src/ai/claude.ts)), the default (decision 15.3). `AI_MODEL` picks the model: `claude-opus-5-5` (default), `claude-sonnet-5-5`, or `claude-haiku-5-5` (cheapest). Each model is sent only the options it takes: the refusal fallback goes only to the models that offer it.
  - **Azure OpenAI** ([azureOpenAi.ts](../backend/src/ai/azureOpenAi.ts)), through its v1 REST API with structured outputs, as documented on Microsoft Learn ("How to use structured outputs with Azure OpenAI in Microsoft Foundry Models"). Set the endpoint, the key, and the deployment of a model that supports structured outputs.
  - Either way the answer is JSON of the scenario's schema, and the code checks decide. A cheaper model may fail the checks more often; `npm run ai:generate` shows how many pass on the first try.
- Keys go in `backend/.env` (copy [backend/.env.example](../backend/.env.example)); git ignores that file. Without a key the AI is off and the training says why.
- The AI gets the environment in plain words ([world.ts](../src/scenarios/world.ts) `environmentText`): the lines, their IVR choice values, rules and fallback queues, and the queues with their members, hours and overflow. Nothing about learners is sent.
- **One try per request.** Hosted, an API request may take at most 45 seconds (Learn, "Overview of API support in Azure Static Web Apps"), so each try is its own request: the backend answers the scenario, or the problems and the draft, and the browser sends earlier tries back with the next one.
- **The AI writes, the code checks.** A scenario that fails a check goes back to the AI with the failures, up to three times, then it's dropped. One that passes is saved in `content/scenarios/generated/` and offered in the exercise list. Look at those files before committing them.
- **The AI caller** (Phone › Let an AI caller call): the AI makes up a caller for the dialled line, with a reason to call and a menu choice. Code checks the choice is one the line knows before placing the call.
- **The AI customer** in an interview answers the learner's own questions from what the scenario says the customer knows, and reports which requirements its answer revealed; code checks they exist.
- **AI hints** on a requirement are based on the concept's Learn passage, which the training shows with the hint.
- **Limits** (manual 8.4): `AI_DAILY_LIMIT` requests a day (default 40), counted in `backend/.cache/ai-usage.json`.

## Commands

```
npm run backend          # the backend on port 7071: Learn, and the AI when a key is set
npm run ai:generate -- 10   # the AI writes 10 scenarios across every kind and level; each is checked
node scripts/ai-generate-live.js <site> 10   # the same against the hosted training: kept there for learners, copies in content/scenarios/generated
node scripts/scenarios.js   # plays one scenario of each kind in Edge (build served), with screenshots
```

## Not done yet

- **Ten AI-written scenarios that pass every check** (phase 5's "done when") need an API key: run `npm run ai:generate -- 10` once the key is in `backend/.env`. The write-check-retry loop itself is tested with a stand-in for the AI ([tests/ai/write.test.ts](../tests/ai/write.test.ts)).
- The AI writes stories, faults and calls on the training's own Contoso environment. AI-written environments (seed rows) and new lesson patterns come later.
- From level 5: business units and teams, customer centers and outbound profiles aren't goals yet; skills aren't simulated.
