# tools/eval

Agent cases for the suite's skills, run the way a person uses AnythingLLM's web interface, graded
from what happened rather than from what the agent says. The first case set is the browser skill's,
against the test lab's fake sign-in sites (`tools/lab`).

```sh
make eval                                   # every case, 2 at a time
make eval CASES='browser/totp-*,browser/basic-*' REPEAT=3
node --disable-warning=ExperimentalWarning tools/eval/run.mts --cases 'browser/*' --parallel 2 --repeat 1 [--keep]
node --test tools/eval/eval.test.mts        # the harness's own tests (no container, no model)
```

Needs podman or docker, Node 22.18 or later, the lab running with its public names on the tunnel
(`LAB_PUBLIC_URL`, read from `tools/lab/.env`), and the live instance's `.env` to read the model from
(`/srv/anythingllm/storage/.env`).

## From a worktree, while the suite changes

A run builds and installs the suite from its own checkout (`instance.mts` `ROOT`), so changing `main`
during a run changes what the next case gets. Run it from a worktree instead:

```sh
git worktree add --detach ../anythingllm-suite-eval HEAD
cp -a packages/node_modules ../anythingllm-suite-eval/packages/   # a copy: a symlink fails the build's "bundles files outside" check
cd ../anythingllm-suite-eval
LAB_DIR=$OLDPWD/tools/lab node --disable-warning=ExperimentalWarning tools/eval/run.mts --cases 'browser/*' --parallel 2 --repeat 1
git checkout --detach <commit>   # later: move it to what's on main now
```

`LAB_DIR` points at the main checkout's lab, whose `.env`, `data/` and `node_modules` aren't in git.
Don't restart `test-lab.service` while a run is going. Results stay in the worktree's
`tools/eval/results/` (ignored); copy them over before removing the worktree.

## What a run does

1. **A throwaway AnythingLLM** (`instance.mts`): the pinned image on a free port, its storage in a
   temporary folder, the suite installed with `install`, a developer key and a session token. The
   model settings are copied from the live instance's `.env` into the run's folder, and removed when
   the run ends. The vault's key is a file both sides share, so the harness can clear saved logins.
2. **Each case in a workspace of its own,** with a lab account of its own (`eval-<run>-<case>@lab.test`,
   on its site, with its own phone number and authenticator secret). The browser keeps cookies and
   tabs per workspace; saved logins and passkeys are the instance's, so a case starts with none for
   its sites unless it runs `after` another.
3. **The chat goes the web interface's way** (`session.mts`): the first message through the
   interface's stream-chat, then the agent session's websocket for every later turn. The developer
   API's chat isn't used: its agent runs don't tell skills their thread.
4. **A stand-in user** (`actor.cjs`, run in the container's Chrome) does on the tab's page what a
   person would: enters the login or the code it asks for, saves, takes the tab over, taps, types,
   hands it back. What to enter comes from the lab (`lab.mts`): the account, the latest code sent to
   its email or phone, its authenticator's code, a captcha's digits, a phone approval.
5. **Grading** (`grade.mts`) uses the lab's own records (who signed in, which account exists), what
   the tab's page asked for, and the agent's tool calls, never the agent's claims. Every case is also
   held to: no password or code in a tool call or a reply; every reply has words besides the tab's
   card; no call repeated with the same arguments more than twice; when the tab's page asks the user for
   something, a reply linked it (a model that leaves the card out leaves the user nothing to tap: the
   stand-in user then finds the page from the skill's own record, and the case fails that check). A rate limit or a turn that timed
   out counts as **infra**, not a failure.
6. **Results** go to `tools/eval/results/<run>/` (ignored): `records.jsonl` (every turn, call, reply
   and check) and `report.md`. The run's lab accounts are removed and the instance stopped, unless
   `--keep`.
7. **A run that can't go on stops, and still reports.** Opening a case's workspace is tried three
   times before the instance counts as gone. When the model's plan has run out (a "Limit Exhausted"
   answer) or the instance stopped answering, no later case could do better: the run stops (printing
   the container's last lines when the instance is the cause), writes the report with the cases it
   didn't run listed, and exits 1. A case whose setup fails is infra, not a crash; a failed build or install
   shows its error.

## A case

A JSON file under `cases/`, named by its path there. The fields are described at the top of
`run.mts` and in `grade.mts`'s `Expect`. For example, `cases/browser/totp-login.json`:

```json
{
  "about": "A password, then an authenticator code, both on the tab's page",
  "site": "totp",
  "steps": [
    { "say": "@agent sign in to $url as $email" },
    { "answer": {} },
    { "say": "Done" },
    { "answer": {} },
    { "say": "Done. Who am I signed in as?" }
  ],
  "expect": {
    "signedIn": true,
    "asked": [{ "kind": "login" }, { "kind": "code", "label": "/authenticator/" }],
    "answer": { "contains": ["$email"] }
  }
}
```

A `user` step's `tap` is at fractions of the tab's picture, measured from a picture of the page
(the actor's `shot` step and `--keep` give one). Don't find a target through the skill's Chrome: even
one DevTools message to the tab's page leaves its passkey authenticator unanswered.

`{ "answer": {} }` answers whatever the tab's page asks at that point, from the case's account; when
the page asks nothing, it's recorded and the case goes on (the agent may have chosen another way).

## The browser cases

One or more per lab site, from the lab runs of 2026-10-16 and the lab's research (`tools/lab/GAPS.md`).
`consent`, `gate`, `push`, `stepup`, `idp` and `federated` need their public names on the tunnel.

## Not yet

- Models and variants (the matrix in `docs/.scratch/eval-protocol.md`): a run uses the live
  instance's model.
- A judge model for free-text answers; a baseline and regressions between runs.
- Cases for the other skills (the library's first).
