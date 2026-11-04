# Admin center check, 2026-11-02

The simulated admin pages were compared with the real Copilot Service admin center in academyexperiment (read-only, nothing saved). Only the Contact Center parts; Customer Service parts were left alone. The page definitions in [content/admin-pages/pages.json](../content/admin-pages/pages.json) now follow what the real admin center shows. Screenshots of the real screens were used for comparison only and aren't in the repo.

## What changed in the training

| Screen | Before | Now, as in the admin center |
| --- | --- | --- |
| Site map | Customer support: Workstreams, Queues | Customer support: Overview, User management, AI Agents, Channels, Intent, **Queues**, Routing, Conversation Orchestration, **Workstreams** (the ones not in the training are greyed out) |
| Queues | One card | Intro, and the **Advanced queues** card with a description and **Manage** (Basic queues and Routing dialogs are Customer Service, left out) |
| Advanced queues | "New"; columns Name, Type, Queue priority | **New queue**, **Refresh**, **Search queues**, "Showing N results"; columns **Name, Queue priority, Type, Owner, Created on** |
| Create a queue | Name, Type (radio), Queue priority; Cancel and Create | Intro with Learn more; **Name**\*, **Type**\* (dropdown, "Select a queue type"), **Queue priority**\* with ⓘ, **Description**, **Owner** (read-only); only **Create**, disabled until filled; × to close |
| Queue page | Users list, Assignment method as radio buttons | Notice "Omnichannel configuration changes take up to 15 minutes to reflect", **Refresh**, name with **Edit**, Type and Owner; **Users / User groups** tabs with Search, See more, **Add users** and columns Name, Type, Role, Capacity profile, Capacity, Business unit, Date added; **Assignment method** card showing the current method (Read-only) with **See more**; **Overflow handling** (Edit); **Operation hours** (Optional); **Metrics Threshold** (Optional) |
| Add users | Narrow flyout with checkboxes | Wide panel **Add Users** with intro, Search, a table to tick rows in (Name, Type, Role, Capacity profile, Capacity, Business unit), **Add** and **Cancel** |
| Assignment method | On the queue page | Its own page: **Save & close**, **Refresh**, **Create new**, and the methods as radio cards with a Read-only tag: Highest capacity, Advanced round robin, Least active, No auto assignment |
| Workstreams | Columns Name, Type, Fallback queue | **New workstream**, **Refresh**, "All workstreams"; columns **Name, Category, Type, Channel, Proactive engagements, Owner, Created on** |
| Workstream page | Routing rules card and a separate Fallback queue card | Notice, **Refresh**, name with **Edit**, Channel/Type/Owner; **Voice** card; **Routing rules** with **Work classification (optional)** and **Route to queues**, which holds **Fallback queue** (Edit), **Rule hit policy** and the ruleset table (Ruleset name, Type "Logical - Decision list", Description); **Work distribution**; **AI agent** (Optional); "Show advanced settings" |
| Decision list | Title "Decision list", "Create Rule" | Title is the ruleset's name; **Decision list** with **Create rule** (lower-case r), **Refresh**, Move up, Move down, Edit, Delete; columns **Order, Rule name, Condition, Queue** |
| Create route to queue rule | Dialog with one fixed condition | Wide panel with intro and Learn more; **Rule Name**\*; **Root record: Conversation**; **Conditions** with an **And** group and **Add** (Add row, Add group, Add related entity), each row **Select a field**, **Equals**, **Value**; **Route to queues** with **Add queue** and **Queue**\* ("Select queue"); **Create** and **Cancel** |

## Where Learn and the admin center differ

- Learn says **New** and **Create Rule**; the admin center shows **New queue** and **Create rule**. The training follows the admin center.
- Learn lists the queue types Messaging, Record and Voice; academyexperiment offers Record and Voice (no messaging channel there). The training keeps all three.

## Not checked yet

- The field list in the condition builder (how context variables are listed), and which operators it offers.
- Pages the lesson doesn't use: Channels, Routing, Intent, AI Agents, overflow and operation hours dialogs.
