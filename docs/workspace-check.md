# Copilot Service workspace check, 2026-11-12

The training's Agent tab was compared with the real Copilot Service workspace in academyexperiment (read-only: nothing saved, no presence changed, no conversation accepted or closed). Only the Contact Center parts; the Customer Service parts (cases, the Customer Service Representative Dashboard) were left out. Screenshots stayed outside the repo. Call controls during a live call couldn't be seen without a call; they come from Microsoft Learn, [Use agent dashboard and call controls in the voice channel](https://learn.microsoft.com/en-us/dynamics365/contact-center/use/voice-channel-agent-experience) (ms.date 2026-05-11).

## What the workspace shows

- **Top bar:** Copilot Service workspace; on the right Search, New, Settings, Help, **Launch dialer**, the **presence** button and the account button. The presence menu in academyexperiment: Available, Appear away, Busy, Do not disturb, Offline (names an organization can change; the training uses the base names Available, Busy, Busy - DND, Away, Offline).
- **Session tabs:** **Home**, **Inbox**, and one tab per open conversation, named after the customer, with ✕ to close it.
- **Home:** dashboards as tabs. The Contact Center one is the **Omnichannel Ongoing Conversations Dashboard**: **Filter by queues** (search, "N records", a checkbox per queue) and **Conversations** with **Monitor** and **Copy URL**; columns Customer, Subject, Queue, Channel, Status Reason, Customer Sentiment.
- **Inbox:** **My work items**, with search, refresh and filter; items grouped by day, each with the customer, "Queue: …", a timer, sentiment and the time; "N items"; "Select an item to work on."
- **A conversation session:** the **Communication Panel** on the left (customer, sentiment, Summarize, Take notes, Mark spam, Link to conversation, System Messages) and the conversation form in the middle (Search customer, Disposition Code, Conversation details with Pre-chat survey, Device and Phone call details: engagement channel, waiting time, queue, start time).
- **Launch dialer:** a **Calls** panel with Country or region, Number, Call from (an outbound profile), **Call**, and Recents and Pinned.
- **Omnichannel real-time analytics** wasn't provisioned in academyexperiment, so it wasn't looked at.

## From Learn

- Call controls: **Mute**, **Hold**, **Consult**, **Transfer**, **Rejoin**, **End**, Dialpad, Mark spam, Device settings, Take notes, recording and transcript controls.
- "To end the call after you select **End**, you must close the session."

## The training's Agent tab now

A training simulation banner; **Sign in as** (training only); the top bar with presence and the account menu (Sign in, Sign out); session tabs Home, Inbox and one per call; the incoming call notification with **Accept** and **Reject**; the Communication Panel with Mute, Hold, Consult, Transfer and End; the **Active Conversation** form with Phone call details and the IVR answers; wrap-up and **Close session**. Home holds the Omnichannel Ongoing Conversations Dashboard, with the training's extra column **Representative**.

Simplified: Consult, Transfer, Monitor and Copy URL aren't simulated; no notification timeout, transcript or sentiment; the caller isn't matched to a customer ("Unknown caller"); a session can only be closed after **End**; presence doesn't change by itself when capacity fills.
