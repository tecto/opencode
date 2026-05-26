# /cruxdev-prioritize — Show the autonomous priority queue

Show what CruxDev thinks should be worked on next, ranked by priority score.

## Arguments

$ARGUMENTS = optional: github repo (default: auto-detect from .cruxdev/growth.toml)

## Protocol

Call `prioritize_work(project_dir, github_repo)` with the current project directory.

Display the ranked list. Highlight the #1 item. Ask if the user wants to start working on it.
