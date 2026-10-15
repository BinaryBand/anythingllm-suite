# Architecture

```mermaid
flowchart LR
    app["app (AnywhereLLM Lite, phone)"] -- "developer key" --> bridge
    mcpc["MCP client (Claude Desktop, an IDE)"] -- stdio --> mcp
    subgraph host["the machine that hosts AnythingLLM"]
        bridge["packages/bridge :8467"]
        mcp["packages/mcp (chat, schedule, memory, sandbox)"]
        subgraph allm["AnythingLLM :3001"]
            skills["packages/skills (apps, browser, memory)"]
        end
    end
    bridge -- "internal API /api" --> allm
    mcp -- "chat, schedule: through the bridge" --> bridge
```

To fill in when the parts are moved in: how a request passes `BRIDGE_ALLOW`, and which part owns each secret (the AnythingLLM password stays with the bridge; the MCP servers and the app hold only developer keys).
