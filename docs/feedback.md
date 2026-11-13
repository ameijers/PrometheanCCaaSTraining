# Feedback

Anyone using the training can send feedback, in a class or not: **Feedback** at the top.

## Sending it

- **What is it about?**: something doesn't work; something in the content is wrong or unclear; an idea or a wish; a question; something else.
- **Your feedback**: up to 2000 characters.
- **Your name** and **your email**: both optional. The email is only for an answer.
- **Include what I was doing in the training** (on by default). The form shows exactly what's sent:
  - the lab and part (the Learn page, or the Do task), or the exercise or lesson and task;
  - the tab;
  - the class code, when they're in a class;
  - the browser and screen size.
- **Attach my environment** (off by default): what they set up in the training, packed like class work (at most 30,000 characters). Nothing else from their computer.

They get a reference, such as `20261113132602-n6qpcw`.

## Reading it: the admin role

Someone with the role **admin** sees **Feedback inbox** at the top:
- filter by kind and status (new and read, new, read, done);
- **Mark as read**, **Mark as done**, **Open again**;
- a **Note for the team**;
- **Delete**;
- **Open their environment** for feedback with an environment attached. It loads it read-only, like a trainer looking at a learner's work, and **Back to the feedback** returns to the inbox.

To make someone an admin, invite them in the Azure portal: the static web app, **Role management**, **Invite**. Authorization provider **Microsoft Entra ID**, their email, the site's address, role `admin`. This is the same as for trainers (docs/classroom.md); someone can have both roles. On this computer, **Trainer sign-in** gives both roles, so the inbox can be tried locally.

## How it's kept

The backend ([backend/src/feedback.ts](../backend/src/feedback.ts)) keeps feedback in its store: locally in `backend/.data/`, hosted in Azure Table Storage.
- Each item: kind, message, the optional name and email, the context lines, status, note, time.
- The attached environment is kept separately.
- Limits: 20 a day from one browser, 1000 a day in all.
- Only the admin role can read, change or delete feedback. The site lets only admins reach `/api/admin/*` (public/staticwebapp.config.json), and the backend checks the role too.
- Deleting an item deletes its environment.

Routes:
- `POST /feedback`;
- `GET /admin/feedback`;
- `GET /admin/feedback/<id>/environment`;
- `POST /admin/feedback/<id>` (status, note);
- `POST /admin/feedback/<id>/delete`.
