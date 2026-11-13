# Classes and the tour

Phase 8 (manual 10). How a trainer runs a class with the training, and what the training keeps.

## For a trainer

1. Select **Trainer sign-in** in the header and sign in with your Microsoft account. You land on **Your classes**: every class you created, with its code, status, number of exercises and learners. (**Labs and practice** > **For trainers** gets you there too.)
2. Select **Create a class**. Name it, give it a **last day** if you like, and tick the labs and exercises it does. Select **Create the class**.
3. Hand out the **class code** (six letters and digits), or the class link (`?class=CODE`).
4. **Open** a class in your list to follow it. Learners show up as soon as they join, then their progress as they work. It updates every 10 seconds:
   - each learner shows **Active now** or when they were last seen;
   - a lab's cell has a bar for each part, **Learn** (pages read, then the quiz), **Do** (tasks) and **Challenge** (exercises), and what the learner is on now and for how long; an exercise's cell has one bar for its checks;
   - the cell's colour is a heat map: light to darker blue the further they are, green with **✓ Done** when finished, and an amber edge with **! May be stuck** when they've been on the same thing for over 10 minutes and are still around;
   - hover over a cell for all of it in words.
   - Select a learner's name, or a cell, for **the learner's page**. For each lab and exercise of the class:
     - a **timeline** of what they did (pages read, quiz checks, tasks done, wrong answers, hints, predictions, questions asked), with the time of each;
     - the **quiz**: a block per question (right first time, right after tries, not right yet) and their answer;
     - the **tasks**: done or not, when and how long it took, hints, and their answer or the check's note;
     - for "Where does this call go?" their **predictions** next to where the call goes; for an interview the **questions they asked**;
     - **Open their environment** loads their saved work (a class lab's hands-on part, or a class exercise) in the training, read-only: a banner says whose work it is, nothing you change is saved or sent, and **Back to the class** brings your own session back.
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

**Every visit starts with a welcome** that asks how the learner wants to work, and says where their work is kept:
- **Join a class** (or **Carry on with my class** once they're in one): work on the class's labs and exercises is saved with the class, and they can carry on in any browser with their personal code.
- **Work on my own** (or **Carry on on my own** when there's earlier work): their work is kept in this browser only; **Files › Save to a file** keeps a copy or moves it to another computer.
- **First, show me around the screen** starts the tour.

Someone who opens a class link goes straight to the code box. Browser scripts don't get the welcome; `?welcome=1` shows it anyway, `?welcome=0` leaves it out.

**Join a class** in the header, or the class link. Enter the code and a name. You get a **personal code** (six letters and digits): it's under **Class** in the header, and your trainer sees it next to your name. The class's labs and exercises come first in **Labs and practice**. Progress is sent as you work. Finished exercises get a tick, in or out of a class.

**Another browser or computer:** Join a class, tick **I joined this class before, in another browser**, and enter the class code and your personal code. You carry on as the same learner: your ticks come back, and opening a class exercise, or a class lab's hands-on part, carries on where you left off, from whichever browser you used last. **Start again** undoes it. Lost the personal code? Your trainer can see it.

How it works: progress (what the trainer sees) and your work on the class's exercises and labs' hands-on parts (the environment, your answers and hints, compressed to about 10 KB) are kept by the training's backend, a few seconds after each change. The personal code gives a new browser your random learner id. Work outside the class's labs and exercises stays in the browser it was done in; **Files › Save to a file** downloads it as a file.

## What's kept (decision 15.5)

- In the learner's browser: a random id, the class code, the display name and personal code, which exercises they finished, and the current session.
- In the backend ([backend/src/classes.ts](../backend/src/classes.ts)): each class (name, exercises, the trainer's key, and the user id of the trainer who owns it) and each learner's progress per lab and exercise: the display name, each check passed or not, done, how many hints they used, each lab part's progress, what they're on now, and for the learner's page their quiz answers and tries, their task answers, predictions and interview questions, and a timeline of at most 80 events (all capped and cleaned up by the backend); each learner's personal code, and their work on the class's exercises (the simulated environment, their answers and hints, compressed). Removing a learner or deleting the class deletes these too.
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

**Tour** in the header, or `?tour=1` in the address: nine steps through the screen. Each step dims the page, lights up one part and shows a card next to it with **Back**, **Next** and **Skip the tour**. The learner moves on when they're ready; the arrow keys, Enter and Esc work too.

The welcome at the start of every visit offers it (**First, show me around the screen**); see For a learner.

The steps use the Toolbox's tour engine ([environment-3d-explorer/src/tour.tsx](../vendor/toolbox/tools/environment-3d-explorer/src/tour.tsx): `useTour`); the card, the welcome and the steps are the training's own ([src/shell/Tour.tsx](../src/shell/Tour.tsx)). The Toolbox's `TourBar`, which plays a tour by itself on a timer, isn't used.
