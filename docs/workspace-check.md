# Copilot Service workspace check, 2026-11-12

The training's Agent tab was compared with the real Copilot Service workspace in a Microsoft demo environment (read-only: nothing saved, no presence changed, no conversation accepted or closed). Only the Contact Center parts; the Customer Service parts (cases, the Customer Service Representative Dashboard) were left out. Screenshots stayed outside the repo. Call controls during a live call couldn't be seen without a call; they come from Microsoft Learn, [Use agent dashboard and call controls in the voice channel](https://learn.microsoft.com/en-us/dynamics365/contact-center/use/voice-channel-agent-experience) (ms.date 2026-05-11).

## What the workspace shows

- **Top bar:** Copilot Service workspace; on the right Search, New, Settings, Help, **Launch dialer**, the **presence** button and the account button. The presence menu in the demo environment: Available, Appear away, Busy, Do not disturb, Offline (names an organization can change; the training uses the base names Available, Busy, Busy - DND, Away, Offline).
- **Session tabs:** **Home**, **Inbox**, and one tab per open conversation, named after the customer, with ✕ to close it.
- **Home:** dashboards as tabs. The Contact Center one is the **Omnichannel Ongoing Conversations Dashboard**: **Filter by queues** (search, "N records", a checkbox per queue) and **Conversations** with **Monitor** and **Copy URL**; columns Customer, Subject, Queue, Channel, Status Reason, Customer Sentiment.
- **Inbox:** **My work items**, with search, refresh and filter; items grouped by day, each with the customer, "Queue: …", a timer, sentiment and the time; "N items"; "Select an item to work on."
- **A conversation session:** the **Communication Panel** on the left (customer, sentiment, Summarize, Take notes, Mark spam, Link to conversation, System Messages) and the conversation form in the middle (Search customer, Disposition Code, Conversation details with Pre-chat survey, Device and Phone call details: engagement channel, waiting time, queue, start time).
- **Launch dialer:** a **Calls** panel with Country or region, Number, Call from (an outbound profile), **Call**, and Recents and Pinned.
- **Omnichannel real-time analytics** wasn't provisioned in the demo environment, so it wasn't looked at.

## From Learn

- Call controls: **Mute**, **Hold**, **Consult**, **Transfer**, **Rejoin**, **End**, Dialpad, Mark spam, Device settings, Take notes, recording and transcript controls.
- "To end the call after you select **End**, you must close the session."

## More from Learn (2026-11-12)

- **Customer identification** (Identify customers automatically): a voice call is matched when its number "matches the number for a contact in the mobile phone or account phone field"; "If a search returns more than one account, contact, or case, nothing is linked."
- **Supervisor** (Monitor, assign, transfer, and end conversations as a supervisor; Monitor calls in the voice channel): **Monitor** voice calls in the **Active** state only, never "conversations that are assigned to you"; **Join call** (barge) tells the representative; **Assign** an **Open** conversation that isn't assigned, to a representative or a queue, overriding presence and capacity; **Transfer** **Active** or **Waiting** conversations; **Force close** sets the status to **Closed**. In the product, Assign, Transfer and Force close are on the **Ongoing conversation** report of real-time analytics.
- **Omnichannel real-time analytics** (Overview of the real-time Omnichannel analytics dashboard; Calculate conversation metrics): reports **Summary**, **Voice**, **Agents**, **Ongoing conversation** and more; **Pause updates** / **Resume updates**. Metrics used: Total conversations offered, Active conversations awaiting service representative acceptance, Active conversations with service representative acceptance, Wrap-up conversations, Longest wait time, Average speed to answer, Service level (20 seconds), Average conversation handle time, and the **Agent availability status** chart. The Agents report has the tabs **Idle agents**, **Interacting agents** and **Offline agents**.
- **Copilot** (Use Copilot to summarize conversations): **Summarize conversation**; the summary "is generated automatically when you request a consultation ..., transfer the conversation, or end the conversation"; paragraph or structured format; copy, feedback, close. Learn documents suggested responses only for chat ("Draft a chat response", deprecated), so the training leaves them out for voice.
- **Transcript**: transcribed "in real time"; **Hide Transcript** / **Show Transcript** "persists across all calls and sessions"; live sentiment from the transcript; sentiment values "positive, neutral, or negative".

## The training's Agent tab now

- **Phone tab:** **Call from** picks the caller's number: a contact's mobile, an account's phone, a number two contacts share, an unknown number, or withheld. The call trace gets a **Customer** step.
- **Workspace:** the training simulation banner; **Sign in as** (training only); the top bar with presence and the account menu (Sign in, Sign out); session tabs Home, Inbox and one per call, named after the customer.
- **Incoming call** notification with the customer, queue, IVR answers, **Accept** and **Reject**.
- **Call session:**
  - **Communication Panel**: Mute, Hold, Consult (not simulated), **Transfer** (to a representative or a queue), **End**, and the live **Transcript** with Hide Transcript / Show Transcript;
  - **Active Conversation**: the customer (contact or account, company, phone, email) and a **Timeline** of their earlier conversations, or **Search customer** with the reason nobody was linked; Phone call details; the IVR answers;
  - **Copilot**: **Summarize conversation**, Copy and Close; a summary is also made on Transfer and End;
  - wrap-up, then **Close session**.
- **Inbox:** **My work items**, and a training view of the calls waiting in the representative's queues.
- **Home:** the **Omnichannel Ongoing Conversations Dashboard** (Filter by queues, Conversations, **Monitor**) and **Omnichannel real-time analytics** with the **Summary**, **Agents** and **Ongoing conversation** reports, a Queue filter and Pause updates. The Ongoing conversation report has Monitor, **Assign**, **Transfer** and **Force close**. Monitor shows the live transcript and **Join call**.

Simplified, and said so on the screen:
- Nobody speaks: the transcript is a short script built from the IVR answer and the customer's name; sentiment is Negative after a wait of more than two minutes, else Neutral, and Positive once the customer thanks the representative.
- The Copilot summary is written by the training from the call's data, not by AI.
- The reports cover the whole session (no Time filter); abandoned calls, the Voice report and the other reports aren't simulated; handle time runs from accept to close.
- Consult, Copy URL and the supervisor's private messages aren't simulated; there's no notification timeout; a session can only be closed after **End**; presence doesn't change by itself when capacity fills.
- The learner acts as the supervisor; in the product that needs the Omnichannel Supervisor role and the Supervisor Monitor, Assign, Transfer and Force Close settings.
- Customers are a few made-up contacts and accounts with fiction-range numbers (07700 900xxx, 0113 496 0xxx); cases aren't part of the training.
