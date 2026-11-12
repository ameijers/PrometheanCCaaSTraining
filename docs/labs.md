# Labs

The training is a path of labs, one subject per lab, in a recommended order. A learner can open any lab that's ready; the list marks the first ready lab that isn't done as **Recommended next**. New learners start at lab 1. The other exercises are under **Practice** in **Labs and practice**.

| Lab | Subject | Status |
| --- | --- | --- |
| 1 | How a call finds its way | ready |
| 2 | Phone numbers and the voice channel | planned |
| 3 | Workstreams | planned |
| 4 | Queues and representatives | ready |
| 5 | Assignment and capacity | planned |
| 6 | The IVR and context variables | planned |
| 7 | Route-to-queue rules | ready |
| 8 | Work classification and skills | planned |
| 9 | Operating hours and overflow | planned |
| 10 | The workspace | planned |
| 11 | Putting it together | planned |

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
  - `answer` (with an `ask`: pick from `queues` or `workstreams`, a list, or type a `number`).
- `challenges`: ids from [content/scenarios/ready-made.json](../content/scenarios/ready-made.json).
- `status`: `ready` once the lab has Learn, a quiz and Do; `planned` shows it as coming soon.

Product facts come from Microsoft Learn. [tests/labs/labs.test.ts](../tests/labs/labs.test.ts) checks the references and plays each ready lab's Do part through; [scripts/labs.js](../scripts/labs.js) goes through lab 1 and lab 4 in a browser.

## Classes

A trainer can add ready labs to a class (`lab-<id>`). The class's progress shows a lab as one column: Learn (pages and quiz) and each Do task.
