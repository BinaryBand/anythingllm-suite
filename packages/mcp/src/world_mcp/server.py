"""world_mcp.server: the smallest MCP server that calls the bridge, one tool. The bridge passes the
route if `BRIDGE_ALLOW` lists it; one it doesn't is the bridge's 403, said as the bridge says it."""

from __future__ import annotations

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

INSTRUCTIONS = """\
Lists the user's AnythingLLM workspaces. world_workspaces gives each one's slug (what other
tools take) and the name the user sees.
"""


def build_server(bridge: httpx.AsyncClient) -> MCPServer:
    """The server, calling AnythingLLM through `bridge`: a client whose base URL is the bridge's
    and whose headers carry the developer key."""
    server = MCPServer("world", instructions=INSTRUCTIONS)

    @server.tool()
    async def world_workspaces() -> dict[str, list[dict[str, str]]]:
        """The workspaces: each one's slug (`workspace`) and name."""
        try:
            response = await bridge.get("/workspaces")
        except httpx.HTTPError as error:
            raise ToolError(f"the bridge is unreachable: {error!r}") from error
        if response.is_error:
            raise ToolError(f"the bridge answered {response.status_code}: {response.text[:300]}")
        return {
            "workspaces": [
                {"workspace": str(w.get("slug")), "name": str(w.get("name"))}
                for w in response.json().get("workspaces", [])
            ]
        }

    return server
