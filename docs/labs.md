# Labs

The training is a path of labs, one subject per lab, in a recommended order. A learner can open any lab that's ready; the list marks the first ready lab that isn't done as **Recommended next**. New learners start at lab 1. The other exercises are under **Practice** in **Labs and practice**.

| Lab | Subject | Do | Challenge |
| --- | --- | --- | --- |
| 1 | How a call finds its way | Follow calls through the trace and the Diagram | First day on the switchboard |
| 2 | Phone numbers and the voice channel | Which workstream answers which number; give the Partner Line a number | A new line for spare parts |
| 3 | Workstreams | See where unrouted calls go; set a better fallback queue | More hands and a better safety net |
| 4 | Queues and representatives | Create a queue with people; take a call in the Agent tab | Monday morning, and nobody answers |
| 5 | Assignment and capacity | Predict who gets a call; round robin; two calls at once | Spread the work |
| 6 | The IVR and context variables | Context variables, an unknown answer, the answer on the representative's screen | What the menu does with a choice |
| 7 | Route-to-queue rules | The "A new menu choice" lesson | The menu, warranty claims, after the reorganisation |
| 8 | Work classification and skills | Priority Score for complaints; Technical skill with Exact Match | Returns need the right people |
| 9 | Operating hours and overflow | Office hours, voicemail out of hours, a callback when busy | Late calls and long waits, Evenings and busy mornings |
| 10 | The workspace | A call from a known customer with Copilot; monitor and join as supervisor | Calling customers back |
| 11 | Putting it together | Delivery questions: queue, rule, hours, voicemail, round robin | The interviews and the level 5 builds |

All eleven labs are ready.

## The three parts

- **Learn:** short pages in our own words, each showing passages from Microsoft Learn (the concepts it names in [content/concepts.json](../content/concepts.json), with their checked quotes), then a quiz. Learn is done when every quiz answer is right. Reading doesn't change the environment.
- **Do:** tasks in the environment, checked by code, like the guided lesson. The Do part starts in a fresh environment, and its `{placeholders}` are filled from it ([src/labs/labs.ts](../src/labs/labs.ts) `labValues`). Lab 7 uses the "A new menu choice" lesson.
- **Challenge:** ready-made exercises that fit the subject, without steps.

A lab is done when Learn and Do are. Progress is kept in the browser like finished exercises, as `lab-<id>-learn` and `lab-<id>-do`.

## Writing a lab

Everything is in [content/labs/labs.json](../content/labs/labs.json):

- `learn`: pages with `title`, `text` (paragraphs), `concepts` (ids from concepts.json; add a concept with a Learn quote first if it's missing) and optionally a `diagram` (`call-path`, `queue-people`, `rules`).
- `quiz`: questions with `options`, the index of the right `answer`, and `why`.
- `do`: a lesson (`title`, `story`, `tasks`, `finished`), or `{ "template": "new-menu-choice" }`. Besides the lesson checks (`row`, `members`, `call`, `callMade`), a task can use:
  - `seen` (`what`: a tab the learner opened, such as `diagram`);
  - `did` (`accept-call`, `close-session`, `ready:<queue name>`, recorded by the Agent tab);
  - `answer` (with an `ask`: pick from `queues`, `workstreams`, `people`, `profiles`, `variables` or `hours`, a list, or type a `number`);
  - `goal` (any goal of the build exercises, [src/scenarios/goals.ts](../src/scenarios/goals.ts): fallback queue, operation hours, overflow, assignment method, capacity, skills, a menu choice with its queue …);
  - `numbers` (a workstream answers at least so many phone numbers);
  - `trace` (a test call's trace contains a text, for example "sets Priority Score to 10");
  - `callMade` can be limited to calls to one `workstream`.
- Placeholders come from the environment ([src/labs/labs.ts](../src/labs/labs.ts) `labValues`): the customer service line (`{line}`, `{dial}`, `{workstream}`, its menu `{choice1}`/`{value1}` …), the technical support line (`{techWs}`, `{techDial}` …), lines without an IVR (`{dutchWs}`, `{partnerWs}`), and facts like `{rep}` (who the queue gives the next call to) or `{profile}` and `{limit}`. A menu's label (Tier 1) isn't always the value the IVR sends (1): checks use the value.
- `challenges`: ids from [content/scenarios/ready-made.json](../content/scenarios/ready-made.json).
- `status`: `ready` once the lab has Learn, a quiz and Do; `planned` shows it as coming soon.

Product facts come from Microsoft Learn. [tests/labs/labs.test.ts](../tests/labs/labs.test.ts) checks the references; [tests/labs/allLabs.test.ts](../tests/labs/allLabs.test.ts) does every lab's Do part task by task in a fresh environment, and works out every expected answer from the environment first, so a question can't have a wrong right answer. [scripts/labs.js](../scripts/labs.js) goes through lab 1 and lab 4 in a browser.

## Classes

A trainer can add ready labs to a class (`lab-<id>`). The class's progress shows a lab as one column: Learn (pages and quiz) and each Do task.
