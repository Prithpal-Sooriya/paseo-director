# Director

Director gives you one agent to talk to, and that agent manages the rest. You tell it what you want. It opens a Paseo project for the mission, splits the work into small briefs and runs visible worker agents (scouts, builders, reviewers) in their own worktrees. It reports back to you while they work.

Director only delegates; it never does the work itself. Plain code handles the supervision, so you don't spend tokens on it:

- **Missions:** one Paseo project per mission, holding one workspace per PR. The project and its primary workspace share one readable name. Renaming either renames both, and archiving the primary workspace tears the mission down.
- **Leash:** workers must not sleep, poll, or create schedules, agents, workspaces or projects, and must stay in their own checkout. The plugin denies these calls and records strikes.
- **Receipts:** workers finish with a typed `director_report` (done, partial or blocked, plus evidence). You get partial progress as it happens and one summary per wave.
- **PR and CI babysitting:** a `gh` poller watches each PR. A failing lint or test job goes straight to the builder, without waiting for the rest of CI. New review comments go to Director, which judges whether they need work.
- **Roles and models:** you can set a provider and model per role; otherwise Director picks. Add your own roles as markdown files.
- **Memory:** Director keeps lessons and retros in a memory file, and is the only agent that owns timers.

## Setup

- Turn on Paseo's agent tools (`mcp.injectIntoAgents`).
- Install and authenticate `gh` for PR and CI watching.
- In Settings → Director, choose the Director's provider and, optionally, a provider per role, such as `pi/litellm/claude-sonnet-4-6`.

Requires Paseo 0.17.3 or later. Tested on macOS.

## Limits

- PR and CI events come from polling at the `prPollSeconds` interval, not webhooks.
- The leash checks tool calls before and after they run. A determined model can still find ways around it.
