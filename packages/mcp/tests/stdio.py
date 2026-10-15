"""What the stdio tests and tools/e2e's tests share: how control_mcp is started as an MCP client
starts it, and how a result reads."""

import os
import sys

from mcp.client.stdio import StdioServerParameters
from mcp.types import CallToolResult


def server_params(url: str, key: str, roles: str) -> StdioServerParameters:
    """`python -m control_mcp` with its settings in the environment."""
    env = {
        **os.environ,
        "ANYTHINGLLM_BRIDGE_URL": url,
        "ANYTHINGLLM_DEVELOPER_KEY": key,
        "ANYTHINGLLM_MCP_ROLES": roles,
    }
    return StdioServerParameters(command=sys.executable, args=["-m", "control_mcp"], env=env)


def text_of(result: CallToolResult) -> str:
    return "".join(getattr(part, "text", "") for part in result.content)
