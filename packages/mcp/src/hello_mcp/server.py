"""hello_mcp.server: the smallest MCP server here, one tool."""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer


def build_server() -> MCPServer:
    server = MCPServer("hello", instructions="Greets people. Call hello with a name.")

    @server.tool()
    def hello(name: str = "world") -> str:
        """Greets `name`."""
        return f"Hello, {name}!"

    return server
