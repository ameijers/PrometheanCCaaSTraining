# Decisions

Answers to the open decisions in [BUILD_MANUAL.md](BUILD_MANUAL.md) section 15, with dates.

| # | Decision | Answer | Date |
| --- | --- | --- | --- |
| 15.2 | GitHub repo | Private repo `ameijers/PrometheanCCaaSTraining` (created by Alexander 2026-11-04) | 2026-11-02 |
| 15.6 | License | MIT, like the Toolbox | 2026-11-02 |
| 15.1 | Audience | Consultants and administrators who set up Contact Center first; supervisors and team leads second | 2026-11-03 |
| 15.3 | AI provider | Claude (Anthropic API), behind one provider interface so it can be switched later. Same day, because cost matters: Azure OpenAI added as a second provider, and the Claude model made a setting (docs/scenarios.md) | 2026-11-03 |
| 15.4 | Hosting | Local only for now: the backend runs on the developer's machine; hosting is picked later | 2026-11-03 |
| 15.7 | Language | English only | 2026-11-03 |
| 15.5 | Sign-in and progress | Class codes: a trainer creates a class and gets a code; learners join with the code and a display name. No accounts, no personal data beyond the name. Entra ID can come later | 2026-11-03 |
| 15.4 | Hosting (update) | Azure Static Web Apps, with the backend as Azure Functions. Prepared in phase 9; deployed only when Alexander says so | 2026-11-03 |
| 15.8 | Name and branding | Keep "Promethean CCaaS Training", by Promethean Academy, with its current look | 2026-11-03 |
| 15.5 | Sign-in and progress (update) | Still no accounts. Added: an optional trainer passcode (TRAINER_PASSCODE) for creating classes, and class management with the trainer link: a last day, close and reopen, remove a learner, delete. Entra ID sign-in for trainers stays possible later | 2026-11-04 |
| 15.5 | Sign-in and progress (update) | Trainers sign in with a Microsoft account (Static Web Apps' built-in sign-in) and need the role "trainer", given by invitation in the Azure portal. Each trainer sees and manages only their own classes; classes made with a trainer link can be added to their list. Learners still don't sign in. The trainer link and passcode keep working (Alexander) | 2026-11-05 |
| — | More technical training | Routing logic in depth (Alexander). First part: the full rule editor in the admin center (And/Or groups, operators by field type, a percentage split, the rule hit policy, work classification rulesets with outputs), with the Toolbox routing as Microsoft Learn describes it. The editor offers only operators whose XML the Toolbox knows; an Or group is written like the real outer group, not yet compared with a real rule (docs/admin-center-check.md). Next: harder level 4–5 exercises on these | 2026-11-11 |
| — | Role of the Toolbox | A head start for building the training, not its subject. Its code runs underneath and the Environment Diagram is shown; learners don't use its tools. The tools run against the simulator in tests only. (Manual 2.5.) | 2026-11-02 |

No open decisions left.
