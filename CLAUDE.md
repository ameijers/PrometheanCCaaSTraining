# Promethean CCaaS Training

A training app that teaches Dynamics 365 Contact Center without a Dynamics 365 environment or real phone numbers: a simulated environment, simulated numbers and calls, the Environment Diagram, simulated admin pages, explanations from Microsoft Learn, and AI-written scenarios.

**Read [docs/BUILD_MANUAL.md](docs/BUILD_MANUAL.md) before starting any work.** It has the plan, the phases and the open decisions.

## Built on the Promethean CCaaS Toolbox

- Folder: `..\Promethean CCaaS Toolbox` (GitHub: ameijers/PrometheanCCaaSToolbox). Included here as a git submodule at `vendor/toolbox`, imported as `@toolbox/*`.
- Reuse its code, never copy and edit it. A change the training needs is made in the Toolbox repo on a branch, with its tests passing (manual section 2.4).
- The Toolbox is a head start for building the training, not its subject: its code runs underneath (graph, health checks, routing evaluator, Environment Diagram), and learners never use its tools. The tools only run against the simulator in tests (manual section 2.5).

## Rules

- Never connect to a real Dataverse environment. The training app itself never connects. Any exceptions for looking at a real environment while making training material are in `CLAUDE.local.md`, which isn't in git.
- Deploy the Toolbox, commit and push only when Alexander asks. Branch first when on `main`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- API keys live only in the backend's settings.
- Product facts come from Microsoft Learn or the Toolbox code, never from memory.
- Admin pages: Microsoft's menu and field names, our own look, a "training simulation" banner, no Microsoft logos.
- Phone numbers: only fiction ranges (555-0100–0199; Ofcom drama ranges).
- Before calling work done: `npx jest`, `npx tsc --noEmit -p .`, `npx webpack`, and look at the page (screenshot).
- Plain language in UI, docs and messages.
