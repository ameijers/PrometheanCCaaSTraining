# Admin center check, 2026-11-02

The simulated admin pages were compared with the real Copilot Service admin center in a Microsoft demo environment (read-only, nothing saved). Only the Contact Center parts; Customer Service parts were left alone. The page definitions in [content/admin-pages/pages.json](../content/admin-pages/pages.json) now follow what the real admin center shows. Screenshots of the real screens were used for comparison only and aren't in the repo.

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
| Create route to queue rule (2026-11-11) | One row, Equals only, one queue | Rows and **Add group** (And or Or, two levels deep); fields grouped as **Context item value (Conversation)** (the context variables) and **Conversation** (Priority Score); operators by kind of field; **Add queue** with **Work allocation percentage** for up to five queues totalling 100, and **Remove allocations** under ⋮; editing a rule ends with **Save and close** |
| Rule hit policy (2026-11-11) | Shown, Edit disabled | **Edit**: Hit-all or Hit-first |
| Work classification (2026-11-11) | Skill attachment rules only | The ruleset list (**Create new**; Order, Ruleset name, Type, Description; Move up, Move down, Edit, Delete once a row is ticked), **Create work classification ruleset** (Logical rules; New ruleset; Name, Description), each ruleset's **Decision list**, and **Create work classification rule** with Conditions and **Output** (Priority Score, or a context variable under Context item value; up to five). The training's skill attachment rules are listed below the rulesets |

Left out of the editor, because the training can't evaluate them: the operators Does not contain, Begins with, Does not begin with, Ends with, Does not end with, In, Not In, Does not contain data and the date operators; related entities other than Context item value; the other Output attributes. Their XML isn't in the Toolbox's real data.

## Where Learn and the admin center differ

- Learn says **New** and **Create Rule**; the admin center shows **New queue** and **Create rule**. The training follows the admin center.
- Learn lists the queue types Messaging, Record and Voice; the demo environment offers Record and Voice (no messaging channel there). The training keeps all three.

## Condition builder, checked 2026-11-11

Looked at in the demo environment, read-only: a voice workstream, its route-to-queue ruleset and **Create route to queue rule**, filled in without saving and closed. Afterwards the decision list still had its two rules.

- **Workstream page:** **Rule hit policy** shows **Hit-all** with **Edit**. Under Route to queues: "If there are no matching queues available based on your routing rules, we will send work to your fallback queue, bypassing any overflow settings for that queue."
- **Decision list notice:** "Before sending a work item to a queue, we'll match rules and overflow actions in priority order. If we don't find any queue that have not overflowed, work items will be sent to the earliest operating queue or follow the rule's overflow action."
- **Add** offers **Add row**, **Add group** and **Add related entity**. A group's selector offers **And** and **Or**; the top group's selector is greyed out at And.
- **Fields of the root record (Conversation):** Active Intent, Active Intent Family, Active Intent Group, Created On, Customer, Customer Language, Escalation Count, Issue, Priority Score, Queue, Sentiment Category, Skills, Social Profile, Transfer Count.
- **Related entities:** Many to One: Customer (Account), Customer (Contact), Issue (Case). One to Many: Context item value (Conversation), Phone Call Engagement Context (Conversation). Many to Many: none.
- **IVR answers (context variables)** are under the related entity **Context item value (Conversation)**, whose own operator is **Contains data** or **Does not contain data**, with the variable's rows in a group inside it. A real rule: Context item value (Conversation) Contains data, and inside it MenuItemSelected Equals Service. The decision list shows this as "MenuItemSelected equals Service".
- **Operators, by kind of field:**
  - text (a context variable such as MenuItemSelected): Equals, Does not equal, Contains, Does not contain, Begins with, Does not begin with, Ends with, Does not end with, In, Not In, Contains data, Does not contain data;
  - number (Escalation Count): Equals, Does not equal, Is greater than, Is greater than or equal to, Is less than, Is less than or equal to, Contains data, Does not contain data;
  - date (Created On): the number ones, and On, Not on, On or after, On or before, After, Before;
  - lookup and choice (Issue, Sentiment Category): Equals, Does not equal, Contains data, Does not contain data.
- **Route to queues:** **Add queue** and a ⋮ menu; **Queue**\* ("Select queue"), each queue listed with its number of users, such as "Billing (1 user)". Buttons: **Create** and **Cancel** (when editing: **Save and close** and **Cancel**).

## Work classification, checked 2026-11-11

- On the workstream page, **Work classification (optional)**: "Add detailed information to incoming work items with classification rules. This allows for more precise routing and assignment." with **Create ruleset**.
- **Create ruleset** opens its own page: breadcrumb Workstreams › workstream name, title **Work classification**, **Create new**, **Refresh**, **Search**; columns **Order, Ruleset name, Type, Description**.
- **Create new** opens the dialog **Create work classification ruleset**:
  - **Rule type**: **Logical rules** (chosen by default; "Create conditions to define your rules based on multiple entity attributes.") or **Machine learning model**;
  - **Start new or use a template**: New ruleset, Template ruleset, Copy from template;
  - **Name**\* and **Description**;
  - **Learn more**, **Create** (disabled until there's a name) and **Cancel**.
- To see the rule panel, an empty ruleset "Training check - delete me" was created (with Alexander's permission), looked at without saving a rule, and deleted. Afterwards the workstream had no work classification ruleset, as before.
- **Ruleset page:** breadcrumb Workstreams › workstream › Work classification; the ruleset's name with **Edit**, **Rule type** (Logical rules) and **Owner**; **Decision list** with **Create rule**; when empty, "Create a work classification rule" with a **Create rule** button.
- **Ruleset list commands** (after ticking a row): **Move up**, **Move down**, **Edit**, **Delete**, **Copy ruleset**, **Paste ruleset below**. Delete doesn't ask to confirm; it shows "Deleting a ruleset".
- **Create work classification rule** (wide panel): "Add conditions and output attributes to define this rule." with Learn more; **Rule Name**\*; **Root record: Conversation** ("Root record is the starting record for the conditions and the output below. Starting from the root record you can navigate to its related records and attributes."); **Conditions**, the same builder as route-to-queue (And group, **Add**); **Output**; **Create** and **Cancel**.
- **Output:** **Add attribute**; each row has a delete icon, **Select attribute or related entity**, "set to" and a value box.
  - Attributes: Capacity profile, Skills, Customer, Escalation Count, Issue, Language, Priority Score, Region.
  - Related entities: Account (Customer), Contact (Customer), Issue (Case), Context item value (Conversation).
  - Choosing **Context item value (Conversation)** adds a second dropdown with the context variables (here MenuItemSelected), then "set to" and a value box.
  - Priority Score's value box is plain text entry.
  - At five rows **Add attribute** turns grey (Learn: up to five output attributes).
  - Rows left empty, or the same attribute twice, show "We found some duplicate attributes. Change or remove any attributes that appear more than once."

## Not checked yet
- Pages the lesson doesn't use: Channels, Routing, Intent, AI Agents, overflow and operation hours dialogs.
