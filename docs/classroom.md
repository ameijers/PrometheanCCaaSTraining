# Classes and the tour

Phase 8 (manual 10). How a trainer runs a class with the training, and what the training keeps.

## For a trainer

1. Open **Choose an exercise** and select **For trainers: create a class**.
2. Name the class, give it a **last day** if you like, and tick the exercises it does. If the training asks for a **trainer passcode**, enter the one you were given. Select **Create the class**.
3. Hand out the **class code** (six letters and digits), or the class link (`?class=CODE`).
4. Keep **your own link** (`?trainer=CODE&key=KEY`) to yourself: with it you come back to the class's progress. It updates every 10 seconds. Hover over a cell to see each check.
5. Manage the class on the same page:
   - **Last day**: set, change or remove it. After that day learners can't join or send progress; you still see what they did.
   - **Close the class** stops joining and progress straight away; **Reopen the class** undoes it.
   - **Remove** next to a learner deletes their progress, and they can't send progress to this class again.
   - **Delete the class** deletes it and everyone's progress in it. The code stops working. This can't be undone.

There are no trainer accounts: the trainer link is the only key to a class. Lose it and the class can't be managed or seen again, so keep it somewhere safe.

## Who may create classes

Without a setting, anyone on the site may create a class (10 a day per browser). Set **`TRAINER_PASSCODE`** in the backend's settings (the static web app's app settings, or `backend/.env` locally) and creating a class needs that passcode. Give it to your trainers; change it to shut out someone who no longer should create classes (classes already made keep working).

## For a learner

**Join a class** in the header, or the class link. Enter the code and a name. The class's exercises come first in **Choose an exercise**. Progress is sent as you work. Finished exercises get a tick, in or out of a class.

## What's kept (decision 15.5)

- In the learner's browser: a random id, the class code and the display name, and which exercises they finished.
- In the backend ([backend/src/classes.ts](../backend/src/classes.ts)): each class (name, exercises, the trainer's key) and each learner's progress per exercise: the display name, each check passed or not, done, and how many hints they used.
- No accounts, no email addresses, nothing else about a learner. Locally the backend keeps it in `backend/.data/` (ignored by git); hosted, in Azure Table Storage (phase 9).

## The backend's routes

- `GET /trainer`: whether creating a class needs the passcode.
- `POST /classes` { name, scenarios, openUntil?, passcode? }: creates a class; answers the code and the trainer's key.
- `GET /classes/<code>`: the class's name and exercises (no key), while it's open.
- `POST /classes/<code>/progress`: a learner's progress on an exercise, while the class is open and the learner wasn't removed.
- `GET /classes/<code>/progress?key=…`: the class's progress, only with the trainer's key.
- `POST /classes/<code>/settings` { key, openUntil?, closed? }, `POST /classes/<code>/remove` { key, learnerId }, `POST /classes/<code>/delete` { key }: the trainer's changes.

The AI routes take the learner's random id too (header `X-Learner`), for the per-learner AI limit (`AI_LEARNER_LIMIT`, 15 a day by default).

## The tour

**Tour** in the header, or `?tour=1` in the address: nine steps through the screen, each lighting up its part. It runs on the Toolbox's tour engine ([environment-3d-explorer/src/tour.tsx](../vendor/toolbox/tools/environment-3d-explorer/src/tour.tsx): `useTour` and `TourBar`), with the training's own look and steps ([src/shell/Tour.tsx](../src/shell/Tour.tsx)).
