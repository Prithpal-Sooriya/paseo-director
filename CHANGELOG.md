# Changelog

## 0.1.0 (2026-11-26)

First working release. It has been tested end to end against a sample repo with GitHub Actions CI ([director-sandbox](https://github.com/Prithpal-Sooriya/director-sandbox)).

### Added
- **The Director agent**: a single point of contact, launched from the Director screen, the sidebar or the command center. It runs from `plugin-data/paseo-director/home` with a delegate-only system prompt and memory.
- **Missions**: each mission gets its own Paseo project, a primary workspace with the same name, and one worktree workspace per PR on branch `director/<mission>/<label>`.
- **Name sync**: the project, primary workspace and mission keep the same name; renaming one renames the others.
- **Teardown**: archiving the primary workspace (or, optionally, the last PR workspace) deletes the project, closes the mission and prompts the Director to run a retro.
- **Swarm dispatch**: waves of scout, builder and reviewer tasks, with a pre-flight gate covering goal, unknowns, stakes and wave size. Read-only waves bypass the gate. There is one writer per checkout.
- **Receipts**: workers report with `director_report`. Progress lines arrive per report, there is one summary per wave, and workers get nudged when a turn ends with no report.
- **Leash**: blocks sleeps, polling and watch loops, schedules, spawning, merges, force pushes and leaving the worker's own checkout. It is enforced before each call and audited after each turn, and violations count as strikes.
- **PR/CI babysitting**: the `gh` poller sends a failing check straight to the builder, so lint is fixed at once and failing tests are reproduced and checked for flakes. Review comments go to the Director to judge. Green checks and PR state changes are reported.
- **Model per role**: role providers are set in settings. Custom roles can be added as markdown files in `plugin-data/paseo-director/roles/`.
- **Memory and ledger**: `director_remember`, `director_memory`, plus a belief ledger that records the strength of the evidence behind each claim.
- **Timers** that only the Director can set. The swarm asks for them through `director_request`.
- **Shared mission board**: `director_board_post` and `director_board_read`.
- **UI**: a board screen, a settings screen, a sidebar item and a command center item.
- **Tooling**: 36 unit tests (vitest) and `scripts/rpc.mjs` for calling plugin RPCs from the CLI.

### Fixed during end-to-end testing
- Queued messages now carry a `sourceAgentId`, which the daemon requires. Before this, wave summaries were being dropped.
- Builders committed in the main checkout. The brief now names the worker's own checkout and branch, and the `foreign-checkout` leash rule blocks the main checkout.
- Builders created their own branches. The brief now says to commit on the branch they were given.
- After a plugin reload, the background tick had no Paseo handle. It now runs anyway, delivering messages through `paseo send` until a hook supplies a handle.
- The PR watcher now watches each PR on only one workspace; before this, every event was delivered twice.
- The audit no longer counts the plugin's own `director_*` calls as leash violations.
- `events.log` entries no longer have their kind overwritten by the event detail.
