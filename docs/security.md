# Security and accessibility check

Phase 9, done 2026-11-03 before the training is hosted. What was checked, what was changed, and what's left.

## Security

| Area | How it stands |
| --- | --- |
| **Real systems** | The training never connects to Dataverse or any Dynamics 365 environment; the simulator answers a reserved `.example` address. Phone numbers only come from ranges reserved for fiction. |
| **Secrets** | AI keys and the storage connection string are only in the backend's settings (`backend/.env`, git-ignored, or the static web app's app settings). The browser never sees them. |
| **Who may write** | The backend refuses POSTs from other sites: locally only pages from this computer, hosted only `SITE_ORIGIN`. |
| **Classes** | A class code lets a learner join and report progress while the class is open; reading a class's progress and changing it (last day, close, remove a learner, delete) needs the trainer's random 32-character key, compared in constant time. With `TRAINER_PASSCODE` set, creating a class needs that passcode; either way it's limited to 10 a day per browser. |
| **Personal data** | A display name and a random id made in the browser. No accounts, no email (decision 15.5, docs/classroom.md). Nothing about learners is sent to the AI. |
| **AI spend** | A limit per day for the whole training and per learner (`AI_DAILY_LIMIT`, `AI_LEARNER_LIMIT`). A learner could get around the per-learner limit by clearing their browser's storage; the daily limit still holds. |
| **AI output** | The AI never decides anything: code checks every scenario, caller, interview answer and hint before it's used (manual 8.3). Its text is shown as text, never as HTML. A learner's question to the AI customer can try to steer it ("prompt injection"); the worst it gets is an odd answer, because the answer is checked and the requirements it says it revealed must exist. |
| **Input** | Every backend route checks its input (lengths, formats, sizes of request bodies) and answers in plain words. Keys in the store are limited to letters, digits, "-", "_" and ":". |
| **Outside requests** | The backend only fetches `https://learn.microsoft.com/...` addresses, and only those in content/concepts.json (no address comes from a request). |
| **Headers** | A strict Content Security Policy (scripts only from the site itself, no inline scripts, no framing by other sites), `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`, from public/staticwebapp.config.json. `node scripts/csp.js` serves the pages with these headers in Edge, goes through every screen, and checks that nothing is blocked and that an injected inline script is refused: it passes. |
| **Dependencies** | `npm audit --omit=dev`: no known vulnerabilities in what ships. `npm audit` lists 21 low and moderate ones in test tools only (jest and ts-jest, through deepmerge and minimatch), which never ship. |

Changed in this check: the class limit per day, and the Content Security Policy and other headers.

## Accessibility

`node scripts/a11y.js` runs axe-core (the open-source checker) on eleven screens: the lesson and phone, the admin center's workstreams, a queue, overflow handling, phone numbers and capacity profiles, the agent view, Choose an exercise, a "Where does this call go?" and an interview scenario, and the trainer's page. It found and we fixed:

- progress bars with a label but no role (now `role="progressbar"` with their values);
- no main landmark on some screens (the workspace is now the page's `<main>`; the admin center's page area a labelled region);
- content outside landmarks (fixed with the same change);
- an empty column header on Phone numbers (now "Select", for screen readers).

It now finds nothing. Left out on purpose: the Diagram (the Toolbox's own page, in an iframe) and Fluent UI's focus helpers (`<i data-tabster-dummy>`, part of the component library).

Automated checks find only part of the problems. So the training was also checked by hand, on the live site, on 2026-11-04: with the keyboard only and with Narrator, including the admin center's panels and the phone. Alexander found no problems.

## Content

Microsoft Learn's terms and the license of the quoted documentation (CC BY 4.0) are in docs/learn-source.md, "Terms". The Learn strip now credits Microsoft and links the license. Alexander confirms that reading before the training is hosted publicly.
