# Where the explanations come from

The training explains Contact Center with passages from Microsoft Learn (manual section 7). This page records how it reads Learn, checked on 2026-11-03.

## How the backend reads Learn

- **Articles as Markdown.** Any Learn article URL answers with Markdown when asked with the header `Accept: text/markdown` (redirects followed). The front matter holds `title` and `ms.date`, the article's own date. That's all the backend needs: no web page scraping.
- **Search.** `https://learn.microsoft.com/api/search?search=<words>&locale=en-us&$top=<n>` returns titles and URLs. Its ranking isn't precise enough to pick articles automatically, so concepts name their article by hand.
- **Learn MCP server.** Microsoft also offers one at `https://learn.microsoft.com/api/mcp` (search and fetch tools). The backend doesn't use it yet: the Markdown articles are simpler and enough for checking quotes.
- **Only Learn.** The backend fetches `https://learn.microsoft.com/...` and nothing else ([backend/src/learn.ts](../backend/src/learn.ts), `isLearnUrl`).

## What the training does with it

- [content/concepts.json](../content/concepts.json) holds each concept: our short summary, and one passage quoted word for word, with the article's title, link, `ms.date` and the day we checked it. A quote may skip text with "…".
- The backend ([backend/src/server.ts](../backend/src/server.ts), `npm run backend`, port 7071) answers `GET /learn/concept/<id>`: the article's date now, and whether the quote is still in it. Articles are cached for a day in `backend/.cache/` and used when Learn can't be reached.
- The Learn strip shows the saved quote with its link and date, plus one line: checked, article updated, passage changed, or Learn not reached.
- `npm run learn:review` checks every concept against Learn now and lists what a person should look at: a moved date or a missing quote. It exits with 1 when something needs a look, so it can run on a schedule later.

## Terms

We quote short passages with a link to the article and its date, and send learners to the full article. We don't copy whole articles.

What the terms say (read 2026-11-03; this is a summary, not legal advice):

- **Microsoft Learn's Terms of Use** (https://learn.microsoft.com/en-us/legal/termsofuse, ms.date 2025-05-12) limit content to "personal and non-commercial use" unless "Certain documentation may be subject to explicit license terms separate from the terms contained here. To the extent the terms conflict, the explicit license terms control."
- **The documentation the training quotes has such explicit terms.** Every concept quotes an article from `dynamics365/customer-service` or `power-platform/admin`. Their public source repositories, [MicrosoftDocs/dynamics-365-customer-engagement](https://github.com/MicrosoftDocs/dynamics-365-customer-engagement) and [MicrosoftDocs/power-platform](https://github.com/MicrosoftDocs/power-platform), license the documentation under **Creative Commons Attribution 4.0 International** (their LICENSE files; the README: "Microsoft and any contributors grant you a license to the Microsoft documentation and other content in this repository under the Creative Commons Attribution 4.0 International Public License").
- **CC BY 4.0 asks for attribution:** credit, a link to the license, and an indication of changes. The Learn strip shows the article's title and link, "© Microsoft, CC BY 4.0" with the license link, and says when a quote was shortened ("…").
- **No trademark rights:** the same README says "The licenses for this project do not grant you rights to use any Microsoft names, logos, or trademarks." The training uses no Microsoft logos, says on every admin page that it's a training simulation, and uses product names only to say what it teaches (manual 6.2).
- **Confirmed by Alexander on 2026-11-04.** If the training is ever sold, have legal look at it as well. For each new concept, check that its article comes from a repository with the same license (`npm run learn:review` doesn't check licenses).
