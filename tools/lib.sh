# Shared by the scripts in tools/. Sourced, never run.

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# IMAGE, INNER_PORT and TOOLKIT_PORT: the one AnythingLLM every check runs against.
# shellcheck source=/dev/null
. "$ROOT/contract/versions.env"

# skills: the name of each skill under packages/skills that has a skill.config.
skills() { for c in "$ROOT"/packages/skills/*/skill.config; do [ -f "$c" ] && basename "$(dirname "$c")"; done; }

# not_yet <script>: the scripts below are stubs until the parts are moved in.
not_yet() { echo "tools/$1: not written yet (the parts have not been moved in)" >&2; exit 1; }
