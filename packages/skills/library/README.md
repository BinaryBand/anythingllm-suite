# library-lean

The user's own library of API toolkits, as one AnythingLLM agent skill. For a service, the agent reads its API's docs, asks the user for its key on AnythingLLM's question card (the model never sees it), and saves a toolkit: where the API is, which keys it calls with, what the agent learned of it, and small JavaScript functions that call it. A function runs again on request, and runs other functions as a flow, even across services. Nothing knows any one service.

Functions run in QuickJS, compiled to WebAssembly, inside AnythingLLM's process: a function sees its input and `kit`, never a file, a key or AnythingLLM. `kit.http` reaches only its toolkit's hosts, through the fence (public addresses only), with its toolkit's keys added outside the script. Why QuickJS, and what was measured: [docs/notes/skills/library](../../../docs/notes/skills/library/README.md).

| Action | Does |
| --- | --- |
| `guide` | how the library works, by topic (`static/guide/`), and worked examples (`static/snippets/`) |
| `library` | the toolkits at a glance, or one (`service`) in full |
| `secret` | asks the user for a key (`site`, `label`) and keeps it in the vault |
| `call` | one request to an API, with a key (`auth`), to read its docs, spec or answers |
| `save` | a toolkit, a function (compiled first) or both; `test` runs what was saved; `remove` |
| `run` | a function (`name`, `inputs`), or a run again (`run_id`) |

## Where it keeps things

| What | Where |
| --- | --- |
| Toolkits, functions (and their last 5 versions), what each keeps between runs, runs | `library-lean/` in AnythingLLM's storage |
| Keys | `vault-lean/vault.json`, encrypted, shared with the browser skill |
| Your own versions of the guide, snippets and prelude | `library-lean/static/`, at the same paths as `static/`: they win over the shipped ones |

## Using it

`anythingllm-suite install` puts it in (see the [README](../../../README.md)); then switch on Library under Agent Skills, and ask the agent to connect a service. For an address on your own network (a NAS, a home server), add its host to `FENCE_ALLOW` in AnythingLLM's environment.

Not yet: OAuth sign-ins, giving a key from a chat with no question card (the AnywhereLLM Lite app), runs that outlast the chat, and scheduling.
