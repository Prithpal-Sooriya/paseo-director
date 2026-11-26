# paseo-director

A [Paseo](https://paseo.sh) plugin that gives you **one agent to talk to**, the Director. The Director runs a swarm of visible worker agents for you.

```
you ⇄ Director (talks, decides, reflects; never does the work)
          │  director_* tools
          ▼
     plugin runtime (plain code: ledger, board, leash, PR poller, timers)
          │  creates projects / workspaces / agents
          ▼
     workers: scout · builder · reviewer · your roles   (one writer per checkout)
```

There are two layers:

- **Director**, an LLM agent. It decides what to do and whether to trust the results. It owns the ADE: projects, workspaces, timers, memory and talking to you.
- **Swarm**, the plugin's TypeScript code plus the worker agents. It decides how the work gets done. Supervision costs no tokens: the ledger, the board, routing, the leash and the PR/CI watcher are all plain code. The LLM is only used to judge.

## Features

| | |
|---|---|
| **Missions** | `director_open_mission` creates one Paseo project for the mission, a primary workspace with the same name, and one worktree workspace per PR (branch `director/<mission>/<label>`). |
| **Name sync** | Renaming the project or its primary workspace renames the other and the mission too (reconciled every 30s). |
| **Teardown** | Archiving the primary workspace deletes the project and closes the mission. With `teardownEmptyMissions` on, archiving the last PR workspace does the same. The Director is told, and runs a retro. |
| **Pre-flight gate** | `director_dispatch` needs a goal, the known unknowns, and the stakes. A writing wave with unresolved unknowns or high stakes is refused until the user confirms. Read-only (scout) waves always pass, because their job is to resolve unknowns. Waves are capped at `maxWave`. |
| **Receipts** | Workers end each turn with `director_report` (`done`, `partial` or `blocked`, plus a summary, evidence, a PR and next steps). Single reports reach the Director as `[director:progress]`, and a finished wave sends one summary. Turns that end without a report are nudged to send one. |
| **Leash** | Workers must not run `sleep` (3s or longer), `watch`, poll loops, `gh run watch`, crontab or `paseo schedule`, spawn agents, workspaces or projects, `gh pr merge`, force-push, or touch the main checkout. The plugin denies these in `agent.permission.before` and audits each finished turn. Every violation is a strike, and the Director hears about it. |
| **Checkout isolation** | Each builder gets its own worktree, and the brief names it and its branch. `activeWriter` ensures only one writer per checkout. |
| **PR/CI babysitting** | A `gh pr view` poller runs every `prPollSeconds`. When a check fails, the event goes **immediately** to the builder: lint is fixed straight away, and tests are reproduced locally and rerun once to rule out flakes. New review comments go to the Director, which judges them and steers the builder. The poller also reports when checks go green and when the PR changes state. |
| **Roles and models** | Built-in roles are `scout` (read-only), `builder` (writes) and `reviewer` (read-only). You can set a provider for each role in settings; otherwise the Director chooses. |
| **Memory** | `director_remember` and `director_memory` write and read `memory.md`, which holds lessons, preferences and retros. A belief ledger (`ledger.jsonl`) records each claim with the strength of its evidence. |
| **Timers** | `director_timer` sets one-shot wake-ups, and only the Director can set them. The swarm asks the Director through `director_request`. |
| **UI** | A Director screen showing the mission board with Launch/Open, a sidebar entry, a settings screen, and a command center item ("Director: launch or open"). |

## Install

```bash
git clone https://github.com/Prithpal-Sooriya/paseo-director
cd paseo-director && npm install
paseo plugin install $PWD
```

You also need:

- Paseo 0.17.3 or later
- `mcp.injectIntoAgents: true` in Paseo's config
- `gh` on the daemon's PATH, logged in

Open **Director** from the sidebar or the command center, and press **Launch Director**.

## Settings

Settings → Director, stored in `~/.paseo/plugin-settings/paseo-director/director.json`:

| Key | Default | Meaning |
|---|---|---|
| `directorProvider` | `claude` | The provider (and model) for the Director, e.g. `pi/litellm/claude-sonnet-4-6` |
| `roleProviders` | `{}` | A provider for each role, e.g. `{ "builder": "pi/litellm/claude-sonnet-4-6", "scout": "pi/litellm/claude-haiku-4-5" }` |
| `workerMode` | `""` | The worker mode ID (e.g. `bypassPermissions`). Leave it empty to use the provider's default |
| `prPollSeconds` | `60` | How often the PR/CI poller runs |
| `maxWave` | `4` | The most tasks allowed in one wave |
| `autoRouteCi` | `true` | Forward failing checks straight to the builder |
| `teardownEmptyMissions` | `true` | Delete the mission project when its last PR workspace is archived |

## Tools

**Director only:** `director_open_mission`, `director_dispatch`, `director_steer`, `director_status`, `director_watch_pr`, `director_timer`, `director_remember`, `director_memory`, `director_rename_mission`, `director_close_mission`, `director_board_read`

**Workers:** `director_report`, `director_board_read`, `director_board_post` (shared facts for the mission, keeping the latest value per key), `director_request` (ask the Director for a workspace, a timer or a decision)

## Extending: custom roles

Add a markdown file to `~/.paseo/plugin-data/paseo-director/roles/<name>.md`:

```markdown
---
name: migrator
description: Runs and verifies DB migrations in its own worktree
writes: true
provider: pi/litellm/claude-sonnet-4-6
---
You are a migrator in a Director-run swarm. ...
```

The Director sees the role in its system prompt (on its next launch) and can dispatch it. The leash and the receipt rules are added to every role automatically.

## Data

Everything lives in `$PASEO_HOME/plugin-data/paseo-director/`, so it survives `paseo plugin remove`:

- `state.json`: missions, waves, workers, PR snapshots and timers
- `events.log`
- `ledger.jsonl`
- `memory.md`
- `home/`: the Director's working directory
- `missions/<slug>/`

## Development

```bash
npm run typecheck && npm test        # 36 unit tests
paseo plugin reload paseo-director   # after editing
node scripts/rpc.mjs director.board  # call a plugin RPC from the CLI
```

## Known limits

- CI and review events come from polling, not webhooks.
- The leash matches commands. Models usually refuse leash-breaking briefs on their own; the plugin is the backstop.
- A worker can still `cd` into a checkout that is not the main repo path (e.g. another worktree); only the main checkout is guarded.
- Only tested on macOS with the `pi` and `claude` providers.

## Credits

Inspired by [FirstMate](https://www.npmjs.com/package/@gpambrozio/paseo-firstmate) and by AutoSwarm. No code was copied. MIT licensed.
