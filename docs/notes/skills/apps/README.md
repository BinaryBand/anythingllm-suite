# The apps skill: notes

What changed from the lean edition and why is in the decisions log (`docs/notes/README.md`, "The apps skill moved in"); this is how it was checked.

## Check

`tests/*.test.mts` run against the source (the store, patch, schema, card, parts and page, with the parts read from `static/` as `build.mjs` inlines them) and the built bundle (the handler), on Node 22. `tests/e2e/inside.js` runs in a started 1.16 image, against the real server, collector and browser-extension upload:

```sh
cd packages && node build.mjs skills apps
podman run -d --name apps-e2e --userns=keep-id:uid=1000,gid=1000 -e STORAGE_DIR=/app/server/storage \
  -v <storage>:/app/server/storage:Z -v $PWD/skills/apps/tests/e2e:/e2e:ro,Z docker.io/mintplexlabs/anythingllm:1.16
# with the bundle copied into <storage>/plugins/agent-skills/apps-lean, once /api/ping answers
podman exec -w /app/server -e HUB_ID=apps-lean -e STORAGE_DIR=/app/server/storage apps-e2e node /e2e/inside.js
```

On 2026-10-16 it printed ok on the image's Node 18.20.8, on fresh storage: a starter's page published as it was made and served by AnythingLLM, with its state file (line, data, seen, version, nothing else) and the app's secret in it but no address; a tap posted twice to the real upload, written by the real collector, applied once by the skill's folder watch with no call and in the state file, and told to the next `list`; an untick carrying another secret refused; a page edit refused by the page check running in its worker thread; a delete refused, then made, leaving `{gone: true}` for a page still open.

Later the same day, with highlights: Change this in the collector's real Chrome, on a tracker starter's page: a tap on the counter's + while picking picked it and didn't step the count, the description sent from the tray (a Shadow DOM) reached the app as an ask apart from its data, `read` gave the button's opening tag as edit's find, and once sent the + stepped again. It printed ok.

Not tried: a real agent driving it, AnythingLLM Desktop, Docker Desktop's bind mounts (where the 30 s poll stands in for the folder watch), and the upgrade on the live instance's 47 apps.
