# browser-lean: notes

The lean browser (`anythingllm-lean/skills/browser`, 4,800 lines of JavaScript) rebuilt on `packages/shared`, from the session of 2026-10-16. Its core first, by the user's choice: research, the tab, logins and codes on the tab's page; the takeover (tapping and typing on the tab's picture) and passkeys later.

## What moved where

- Already shared, from the library's phases: the fence, the request client, the answer's checks and masking, the vault, the pages' key and events.
- Ported, nearly as they were: Chrome per workspace (`browser.ts`), the act verbs (`act.ts`), the page as text (`snapshot.ts`, `view.ts`), search and look (`research.ts`), a tab per thread (`scope.ts`).
- New: logins in the instance's vault (`logins.ts`), and a tab page that only shows the tab and takes what the agent asks for (`page.ts`, `static/pages/tab.html`).
- Dropped: saved actions (the library's functions do that now), OAuth (the library's), the key-asking (the library's page), the question card (it shows its answers in the chat; the library left it in phase 3 for the same reason).

## Decisions

- **Puppeteer is required at run time, from AnythingLLM's collector** (`/app/collector/node_modules/puppeteer`, or `BROWSER_LEAN_PUPPETEER`), by a path built then, so esbuild bundles none of it and the skill vendors nothing.
- **Only the password or the code is hidden** from what the agent reads, not the username: a username hidden everywhere also hid it inside other words. The lean browser hid both.
- **A login the user asks to save is saved at the tab's next read where the page no longer asks for a password** (and is still on its site), not when the address changes: a sign-in form that posts back to its own address left nothing saved (found by the e2e, against a real Chrome), and a check right after submitting missed a login the agent submits later.
- **The page's state lists every saved login** (site and username), as the library's page lists every key by name: the vault is the instance's, not a workspace's.
- **The lean vaults are imported once** (`browser-lean/.imported`), opened with the lean key: logins, passkeys and API keys (the library reads them by name), not OAuth sign-ins; none already there twice.

## Check

`tests/handler.test.mts` and `tests/page.test.mts` run against the built bundle with a stand-in Puppeteer (`tests/fixtures/puppeteer`). `tests/e2e/inside.js` runs in the 1.16 image with the collector's real Chrome, against a site it serves:

```sh
cd packages && node build.mjs skills browser
podman run -d --name br-e2e --userns=keep-id:uid=1000,gid=1000 -e STORAGE_DIR=/app/server/storage \
  -v <storage>:/app/server/storage:Z -v $PWD/skills/browser/tests/e2e:/e2e:ro,Z docker.io/mintplexlabs/anythingllm:1.16
# with the bundle copied into <storage>/plugins/agent-skills/browser-lean
podman exec -w /app/server -e HUB_ID=browser-lean -e FENCE_ALLOW=127.0.0.1,localhost br-e2e node /e2e/inside.js
```

On 2026-10-16 it printed ok: open, read and act; act refusing a password field; a login asked for on the tab's page, sealed, typed into the real Chrome, signed in and saved; search and look; the fence refusing a private address.
