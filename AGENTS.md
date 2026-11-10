# AGENTS.md

This file provides guidance to Coding Agents when working with code in this repository.

A Paseo plugin (`paseo-plugin.json`, id `paseo-agent-team`) that turns a Paseo project into an agent team: each role gets its own provider/model, every role runs in the orchestrator's workspace (one workspace per team), and the orchestrator agent delegates to them. Team definitions live in the project repo, one per workspace, as `.agents/teams/<orchestrator workspace>.json` (the older single `.agents/team.json` is still read), not in plugin settings (see `.forge/adr/`). Domain terms (Project, Workspace, Role, Orchestrator, Team definition) are defined in `.forge/CONTEXT.md`; use them as written.

## Commands

```bash
npm install                        # .npmrc sets legacy-peer-deps (works around an npm 10.9 resolver crash)
npm run typecheck                  # tsc --noEmit; run before every install/reload
npm test                           # vitest unit tests
npx vitest run tests/validate.test.ts            # one file
npx vitest run -t "returns auto only"            # one test by name
PASEO_E2E=1 npx vitest run tests/daemon.e2e.test.ts   # live daemon; starts real agents and costs tokens (PASEO_URL overrides ws://127.0.0.1:6767/ws)

paseo plugin install "$(pwd)"      # local install; then `paseo plugin ls` must show "running"
paseo plugin reload paseo-agent-team
paseo plugin logs paseo-agent-team
```

There is no build or lint step; Paseo bundles the TypeScript sources itself on install. Do not restart the daemon to pick up changes; use `paseo plugin reload`.

## Architecture

Paseo plugins have two runtimes, each with one entry that default-exports a `contribute` function:

- `index.server.ts` + `server/` run in a daemon subprocess. `server/team.ts` holds every RPC handler; handlers get `{ paseo }` (the Paseo SDK) and do the filesystem and agent work.
- `index.client.tsx` + `client/` run inside the Paseo app (React Native, all platforms). It registers a workspace panel (`TeamPanel`), an always-visible sidebar item and screen that lists every project's teams and creates new ones (`TeamScreen`), and a Command Center item.
- `shared/` is compiled into both and must stay pure (Zod contracts and plain values, no Node or React Native APIs). It holds the team schema (`team.ts`), RPC contracts (`rpc.ts`), provider/model validation (`validate.ts`), the planner and orchestrator prompts (`proposal.ts`, `prompt.ts`), workspace matching (`apply-plan.ts`), planner cleanup (`cleanup.ts`) and UI strings (`messages.ts`, English, Korean, Japanese and Simplified Chinese). Most logic lives here so it can be unit-tested without a daemon.

The user-facing flow is propose → review → apply. Propose starts a planner agent with `outputSchema: TEAM_JSON_SCHEMA`. The client then polls `teamProposal`, which calls `waitForFinish(1000)` and parses the planner's last message. Apply re-validates, refuses workspaces another team of the project uses, writes the team's own file, reuses or creates the orchestrator's workspace matched by title, and then either tells a running orchestrator on the same provider/model to re-read the team or starts a new one. Finally it archives planner agents and an emptied `Team planner` workspace.

```
propose → planner agent → poll teamProposal → user edits draft → apply
apply: validate → check other teams' workspaces → write the team's file → match/create the orchestrator's workspace → reuse or start orchestrator → archive planners
```

Role agents are not created by the plugin. The orchestrator starts them through Paseo tools or `paseo run`, following the instructions rendered by `orchestratorPrompt`. Behaviour for role agents can only be shaped through that prompt.

Key details that span files:

- A team belongs to the workspace in its `orchestrator.workspace`, matched by title (`shared/team-files.ts`). The panel of a workspace reads only that workspace's team, and the orchestrator prompt names only its own file.
- Agents the plugin starts carry the label key `LABEL = "workspace-agents"` (`shared/cleanup.ts`) with value `planner` or `orchestrator`. Cleanup and orchestrator reuse depend on it, so do not rename it casually.
- Agents get `modeId: "auto"` only when the provider's snapshot `modes` include `auto` (`autoModeOf`). Otherwise the provider's default mode applies.
- `outputSchema` is not enforced by every provider, so `proposal.ts` also embeds an example of the exact shape in the prompt and parses defensively.
- Workspace and agent lists are read as a single page; pagination is a known open follow-up in `.forge/followups.md`.
- Daemon-side error strings are English only; client UI text goes through `client/i18n.ts` and `shared/messages.ts` (see the i18n rule below).

## Plugin constraints that have bitten this repo

- **Server code must not import `@getpaseo/client`, even with `import type`.** The registry/daemon build rejects it (`paseo-plugin-server-runtime-boundary`), while local `tsc` passes. Derive types from the plugin SDK instead, for example `type PaseoApi = PluginHandlerContext["paseo"]`. `@getpaseo/client` is fine in `tests/`.
- Client code cannot import `server/` or `node:*`; server code cannot import `client/`. No code modules in the repo root other than the two entries.
- Client UI must use React Native primitives only and take every text color from `theme.colors`.
- **Every new user-facing text must be added to all languages at once.** Add the key to `en` in `shared/messages.ts` and to each other resource there (`ko`, `ja`, `zh`), keeping `{{placeholders}}` and plural suffixes identical; never hard-code UI strings in `client/`. A new language needs its resource in `shared/messages.ts`, registration in `client/i18n.ts`, coverage in `tests/messages.test.ts`, its Command Center search `keywords` in `index.client.tsx` (the one per-language list kept outside `messages.ts`), and the Language sections of README and OVERVIEW. Resource keys are language codes (`zh` is Simplified Chinese); i18next falls back from tags like `zh-CN` or `ja-JP` to them, and to `en` when a language is missing.
- `requirements.paseo` in `paseo-plugin.json` must be raised when adopting newer plugin APIs.

## Publishing

- Releases follow `.claude/skills/deploy/SKILL.md` ("배포해줘"): bump the version, tag, create a GitHub release, then open a PR on the registry record.
- The registry listing is `gyuha/agent-team` in `getpaseo/plugins` (`plugins/gyuha/agent-team.json`). It pins one reviewed Git commit, so pushing to `main` does not update `paseo plugin add gyuha/agent-team`. Update it with a PR that changes the record's commit. Do not use `gh issue create --label submission`: the label is dropped for this account, and the intake bot skips unlabeled issues. A pin change requested only in a review-PR comment was not applied (#1526).
- The pinned commit must contain `OVERVIEW.md`. Keep it factual, with no install instructions, and update it, and README "Limitations", when behaviour changes.
- To test the latest `main` before review, install directly with `paseo plugin add git:gyuha/paseo-agent-team`. A local-directory install and a Git or registry install share the id `paseo-agent-team`, so `paseo plugin remove paseo-agent-team` first.
