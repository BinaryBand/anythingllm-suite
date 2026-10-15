"""control_mcp.settings: where the bridge is, the developer key it wants and which roles to serve,
from the environment:

  ANYTHINGLLM_BRIDGE_URL     the bridge (default http://127.0.0.1:8467)
  ANYTHINGLLM_DEVELOPER_KEY  a developer key AnythingLLM accepts
  ANYTHINGLLM_MCP_ROLES      comma-separated, from `chat` and `schedule` (default `chat`)

`anythingllm-bridge install` writes the first two to ~/.config/anythingllm-mcp/control.env."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_URL = "http://127.0.0.1:8467"
ROLES = ("chat", "schedule")
DEFAULT_ROLES = ("chat",)


@dataclass(frozen=True)
class Settings:
    url: str
    key: str
    roles: tuple[str, ...]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """The settings; a role that does not exist is a ValueError that says which do."""
        wanted = env.get("ANYTHINGLLM_MCP_ROLES", ",".join(DEFAULT_ROLES))
        asked = [r.strip() for r in wanted.split(",")]
        roles = tuple(dict.fromkeys(r for r in asked if r))
        if not roles or not set(roles) <= set(ROLES):
            raise ValueError(
                f"ANYTHINGLLM_MCP_ROLES is one or more of {', '.join(ROLES)}; got {asked!r}"
            )
        return cls(
            url=env.get("ANYTHINGLLM_BRIDGE_URL", DEFAULT_URL).rstrip("/"),
            key=env.get("ANYTHINGLLM_DEVELOPER_KEY", ""),
            roles=roles,
        )
