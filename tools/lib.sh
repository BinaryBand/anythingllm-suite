# Shared by the scripts in tools/. Sourced, never run.

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# IMAGE, INNER_PORT and TOOLKIT_PORT: the one AnythingLLM every check runs against.
# shellcheck source=/dev/null
. "$ROOT/contract/versions.env"

# skills: the name of each skill under packages/skills, a folder with a plugin.json.
skills() { for c in "$ROOT"/packages/skills/*/plugin.json; do [ -f "$c" ] && basename "$(dirname "$c")"; done; }

# plugin_field <key>: a field of the loaded skill's plugin.json.
plugin_field() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$SKILL_DIR/plugin.json" "$1"; }

# load_skill <name>: sets SKILL_DIR and HUB_ID for packages/skills/<name>. AnythingLLM finds an
# imported skill by a hubId equal to its folder; build.mjs puts what ships in build/<hubId>.
load_skill() {
  SKILL_DIR="$ROOT/packages/skills/${1:?skill name required (one of: $(skills | tr '\n' ' '))}"
  [ -f "$SKILL_DIR/plugin.json" ] || { echo "no such skill: $1 (one of: $(skills | tr '\n' ' '))" >&2; return 1; }
  HUB_ID=$(plugin_field hubId)
}

# not_yet <script>: the scripts below are stubs until the parts are moved in.
not_yet() { echo "tools/$1: not written yet (the parts have not been moved in)" >&2; exit 1; }
