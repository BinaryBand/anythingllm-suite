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
   card; no call repeated with the same arguments more than twice. A rate limit or a turn that timed
   out counts as **infra**, not a failure.
6. **Results** go to `tools/eval/results/<run>/` (ignored): `records.jsonl` (every turn, call, reply
   and check) and `report.md`. The run's lab accounts are removed and the instance stopped, unless
   `--keep`.

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
