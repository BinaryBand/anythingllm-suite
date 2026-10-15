# The suite's meta commands. Each target calls lefthook or a script in tools/; nothing is
# implemented here, so `make` and the scripts never disagree.

.DEFAULT_GOAL := help
.PHONY: help hooks lint test boundaries check package install-skill

PART  ?=# bridge, mcp, skills or app; empty: all
SKILL ?=# a skill's folder name under packages/skills
DIR   ?=# the agent-skills folder to install it into

help: ## List the commands
	@awk -F':.*## ' '/^[a-z-]+:.*## /{printf "  make %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

hooks: ## Install the git hooks, once per clone
	@command -v lefthook >/dev/null || { \
		printf '%s\n' "lefthook is not installed. Install it with one of:" \
			"  uv tool install lefthook" \
			"  brew install lefthook" \
			"  npm install --global lefthook" \
			"then run: make hooks" >&2; \
		exit 1; }
	lefthook install

lint: ## Run the commit hooks on every file (ruff, flutter analyze)
	lefthook run pre-commit --all-files

test: ## Run the push hooks on every file (boundaries, then each part's tests)
	lefthook run pre-push --all-files

boundaries: ## Fail if one part imports another
	tools/boundaries

check: ## Test a part (PART=mcp) or, with no PART, all of them
	tools/check $(PART)

package: ## Build a part or a skill into dist/ (PART=bridge|mcp|<skill>)
	tools/package $(PART)

install-skill: ## Install a skill (SKILL=memory DIR=<agent-skills folder>)
	tools/install $(SKILL) $(DIR)
