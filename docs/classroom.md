# Classes and the tour

Phase 8 (manual 10). How a trainer runs a class with the training, and what the training keeps.

## For a trainer

1. Select **Trainer sign-in** in the header and sign in with your Microsoft account. You land on **Your classes**: every class you created, with its code, status, number of exercises and learners. (**Choose an exercise** > **For trainers** gets you there too.)
2. Select **Create a class**. Name it, give it a **last day** if you like, and tick the exercises it does. Select **Create the class**.
3. Hand out the **class code** (six letters and digits), or the class link (`?class=CODE`).
4. **Open** a class in your list to follow it. Learners show up as soon as they join, then their progress as they work. It updates every 10 seconds. Hover over a cell to see each check.
5. Manage the class on the same page:
   - **Last day**: set, change or remove it. After that day learners can't join or send progress; you still see what they did.
   - **Close the class** stops joining and progress straight away; **Reopen the class** undoes it.
   - **Remove** next to a learner deletes their progress, and they can't send progress to this class again.
   - **Delete the class** deletes it and everyone's progress in it. The code stops working. This can't be undone.
   - In **Your classes**, **Delete** on a row deletes that class; tick several (or the box in the header for all) and **Delete the selected classes** deletes them together, after one confirmation.

A trainer sees and manages only their own classes. **Sign out** is at the top of the trainer's pages.

### Without signing in: the trainer link

Someone who isn't a trainer can still create a class: **For trainers** > **Create a class with a trainer link** (with the trainer passcode, if one is set). They get the class code and **their own link** (`?trainer=CODE&key=KEY`), the only way back to that class: lose it and the class can't be managed or seen again. A trainer can add such a class to their list: paste the link under **Add a class you made with a trainer link** in Your classes, or open the link while signed in and select **Add to your classes**. A class belongs to one trainer; the link keeps working too.

## Who is a trainer

Azure Static Web Apps signs people in with a Microsoft account (Entra ID) and gives them roles. A trainer is someone with the role **trainer**. To make someone a trainer (Microsoft Learn, "Custom authentication in Azure Static Web Apps", Manage roles):

1. In the Azure portal, open the static web app. Under **Settings**, select **Role Management**, then **Invite**.
2. Authorization provider: **Microsoft Entra ID**. Invitee details: their email address. Domain: the site's address. Role: `trainer`. Set how many hours the invitation stays valid (at most 168, seven days). Select **Generate**.
3. Send them the invite link. They open it and sign in with that account; from then on they're a trainer.

To stop someone being a trainer: Role Management, tick their row, **Delete**. It can take a few minutes everywhere. Their classes stay, but nobody can manage them through the list any more (their trainer links, if they kept them, still work). Invite yourself first.

Anyone with a Microsoft account can sign in, but without the trainer role they only see "You're signed in, but not as a trainer". Learners never sign in.

On this computer (`npm run backend`) there's no Static Web Apps: **Trainer sign-in** asks for a name and signs you in as a trainer with that name, on this computer only.

## Who may create classes

Signed-in trainers may create classes (30 a day each). Without signing in: anyone on the site may create a class with a trainer link (10 a day per browser), unless **`TRAINER_PASSCODE`** is set in the backend's settings (the static web app's app settings, or `backend/.env` locally): then that needs the passcode. Change it to shut out someone who no longer should create classes (classes already made keep working).

## For a learner

**Join a class** in the header, or the class link. Enter the code and a name. You get a **personal code** (six letters and digits): it's under **Class** in the header, and your trainer sees it next to your name. The class's exercises come first in **Choose an exercise**. Progress is sent as you work. Finished exercises get a tick, in or out of a class.

**Another browser or computer:** Join a class, tick **I joined this class before, in another browser**, and enter the class code and your personal code. You carry on as the same learner: your ticks come back, and opening a class exercise carries on where you left off, from whichever browser you used last. **Start again** undoes it. Lost the personal code? Your trainer can see it.

How it works: progress (what the trainer sees) and your work on the class's exercises (the environment, your answers and hints, compressed to about 10 KB) are kept by the training's backend, a few seconds after each change. The personal code gives a new browser your random learner id. Work outside the class's exercises, like the guided lesson, stays in the browser it was done in; **Save my work** downloads it as a file.

## What's kept (decision 15.5)

- In the learner's browser: a random id, the class code, the display name and personal code, which exercises they finished, and the current session.
- In the backend ([backend/src/classes.ts](../backend/src/classes.ts)): each class (name, exercises, the trainer's key, and the user id of the trainer who owns it) and each learner's progress per exercise: the display name, each check passed or not, done, and how many hints they used; each learner's personal code, and their work on the class's exercises (the simulated environment, their answers and hints, compressed). Removing a learner or deleting the class deletes these too.
- For trainers, only the user id Static Web Apps gives them (unique to this site). Their name or email comes with each request and is shown to them, but not kept. Static Web Apps itself keeps who has which role (Role Management).
- No accounts for learners, no email addresses, nothing else about a learner. Locally the backend keeps it in `backend/.data/` (ignored by git); hosted, in Azure Table Storage (phase 9).

## The backend's routes

- `GET /trainer`: whether creating a class needs the passcode.
- `POST /classes` { name, scenarios, openUntil?, passcode? }: creates a class; answers the code and the trainer's key.
- `GET /classes/<code>`: the class's name and exercises (no key), while it's open.
- `POST /classes/<code>/join` { learnerId, name }: a learner joins (the trainer sees them straight away), while the class is open and the learner wasn't removed. Answers their personal code and what they finished.
- `POST /classes/<code>/rejoin` { rejoinCode }: the same learner in another browser; answers their learner id, name and what they finished.
- `POST /classes/<code>/work` { scenarioId, data } and `GET /classes/<code>/work/<scenarioId>`, with the learner's id in the header `X-Learner`: their work on one of the class's exercises (gzip-compressed JSON in Base64, at most 30,000 characters).
- `POST /classes/<code>/progress`: a learner's progress on an exercise, while the class is open and the learner wasn't removed.
- `GET /classes/<code>/progress?key=…`: the class's progress, only with the trainer's key.
- `POST /classes/<code>/settings` { key, openUntil?, closed? }, `POST /classes/<code>/remove` { key, learnerId }, `POST /classes/<code>/delete` { key }: the trainer's changes.
- `GET /me`: who is signed in, and whether they're a trainer.
- For a signed-in trainer, without the key, for their own classes: `GET /manage/classes`, `POST /manage/classes` { name, scenarios, openUntil? }, `POST /manage/claim` { code, key }, `GET /manage/classes/<code>`, and `POST /manage/classes/<code>/(settings|remove|delete)`. Static Web Apps only lets the role trainer reach `/api/manage/*` ([public/staticwebapp.config.json](../public/staticwebapp.config.json)), and the backend checks the role again. It reads who signed in from the `x-ms-client-principal` header Static Web Apps adds.

The AI routes take the learner's random id too (header `X-Learner`), for the per-learner AI limit (`AI_LEARNER_LIMIT`, 15 a day by default).

## The tour

**Tour** in the header, or `?tour=1` in the address: nine steps through the screen, each lighting up its part. It runs on the Toolbox's tour engine ([environment-3d-explorer/src/tour.tsx](../vendor/toolbox/tools/environment-3d-explorer/src/tour.tsx): `useTour` and `TourBar`), with the training's own look and steps ([src/shell/Tour.tsx](../src/shell/Tour.tsx)).
