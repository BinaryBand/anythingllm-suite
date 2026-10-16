# browser-lean

Tasks on the web, as one AnythingLLM agent skill: research (search the web, look at a page) and a real Chrome with a tab per chat, which the agent opens, reads as text with a ref on each element, and acts on by those refs. It's AnythingLLM's own: the Chrome and the Puppeteer its collector ships with, run inside AnythingLLM's process, so nothing is installed beside it. A task worth running again, and any API with a key, are the library skill's; the browser is for what only a person's clicks can do.

| Action | Does |
| --- | --- |
| `guide` | how to pick the way to do a task, by topic (`static/guide/`) |
| `search` | the web, through `SEARCH_URL` (DuckDuckGo's plain HTML search by default) |
| `look` | reads a page in a page of its own, without moving the tab |
| `open` | an address in this chat's tab |
| `read` | the tab as text, with refs (`find`, `from` for long pages) |
| `act` | click, fill, type, press, select… by ref; or several `steps` |
| `login` | types the saved login; with none, the user enters it on the tab's page; `what` asks them for a code the same way |
| `call` | one request from the tab, with its signed-in session (`auth` "session") |

Each answer about the tab ends with its card, a picture of the tab that opens its page. There the user sees the tab, enters what the agent asks for (sealed on their device; the model never sees it) and deletes a saved login. Every request Chrome makes goes through the fence: the public web only, and the hosts in `FENCE_ALLOW`.

## Where it keeps things

| What | Where |
| --- | --- |
| Logins, passkeys, and each workspace's cookies (so its sign-ins last) | `vault-lean/vault.json` in AnythingLLM's storage, encrypted, shared with the library |
| Chrome's profile while it runs | a temporary folder, removed when it closes |
| Each workspace's tabs' page names | `browser-lean/<workspace>/` |
| The tabs' pictures, state and pages | `public/browser-lean/` beside AnythingLLM's server |
| Your own versions of the guide and the page | `browser-lean/static/`, at the same paths as `static/` |

## Using it

`anythingllm-suite install` puts it in, over the lean `browser-lean` (its old files go; its logins, passkeys and keys are imported into the shared vault on the first call). Switch on Browser under Agent Skills, and set its ANYTHINGLLM_URL to the address you open AnythingLLM at, so the card opens anywhere. It needs AnythingLLM's Docker image (Chrome comes with its collector); elsewhere, set `BROWSER_LEAN_PUPPETEER` to a Puppeteer.

On the tab's page the user can also take the tab over: tap, swipe to scroll, type into a field with their own keyboard (a password sealed on their device), go back or reload, then hand it back. The agent reads but doesn't act meanwhile, and a hold with no step for 10 minutes lapses. After the user signs in that way, the page offers to save the login.

Passkeys: every tab has Chrome's virtual authenticator holding the saved passkeys, so a site's passkey sign-in works by itself. A passkey a site makes while the user holds the tab is offered for saving; one made while the agent has it is taken out again. The lean browser's passkeys are imported.
