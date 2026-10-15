import pytest

from control_mcp.settings import DEFAULT_URL, Settings


def test_defaults_without_environment_serve_the_chat_role_only() -> None:
    assert Settings.from_env({}) == Settings(DEFAULT_URL, "", ("chat",))


def test_reads_url_key_and_roles_and_trims_a_trailing_slash() -> None:
    env = {
        "ANYTHINGLLM_BRIDGE_URL": "http://host:9/",
        "ANYTHINGLLM_DEVELOPER_KEY": "k",
        "ANYTHINGLLM_MCP_ROLES": " schedule , chat,chat",
    }
    assert Settings.from_env(env) == Settings("http://host:9", "k", ("schedule", "chat"))


@pytest.mark.parametrize("roles", ["", " , ", "admin", "chat,admin"])
def test_a_role_that_does_not_exist_is_refused_naming_those_that_do(roles: str) -> None:
    with pytest.raises(ValueError, match="one or more of chat, schedule"):
        Settings.from_env({"ANYTHINGLLM_MCP_ROLES": roles})
