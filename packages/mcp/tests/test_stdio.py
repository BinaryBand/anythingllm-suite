import asyncio
import sys

from mcp import Client
from mcp.client.stdio import StdioServerParameters


async def ask() -> tuple[set[str], str]:
    parameters = StdioServerParameters(command=sys.executable, args=["-m", "hello_mcp"])
    async with Client(parameters, read_timeout_seconds=30) as client:
        tools = (await client.list_tools()).tools
        assert all(t.description for t in tools)
        result = await client.call_tool("hello", {"name": "Ada"})
    text = "".join(getattr(part, "text", "") for part in result.content)
    return {t.name for t in tools}, text


def test_an_mcp_client_starts_the_server_over_stdio_and_calls_its_tool() -> None:
    names, greeting = asyncio.run(ask())
    assert names == {"hello"}
    assert greeting == "Hello, Ada!"
