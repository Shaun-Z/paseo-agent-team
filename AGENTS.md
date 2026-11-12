# AGENTS.md

This file provides guidance to Coding Agents when working with code in this repository.

A Paseo plugin (`paseo-plugin.json`, id `paseo-agent-team`) for user-configured teams: extensible Roles define local prompts, members select Paseo Agent Profile launch settings, and one selected member is the Orchestrator. All members run independent reusable sessions in one shared Workspace. Team definitions live in the project repo, one per workspace, as `.agents/teams/<orchestrator workspace>.json` (the same member-based format can also live in `.agents/team.json`), not in plugin settings (see `.forge/adr/`). Domain terms (Project, Workspace, Role, Orchestrator, Team definition) are defined in `.forge/CONTEXT.md`; use them as written.

## Commands

```bash
npm install                        # .npmrc sets legacy-peer-deps (works around an npm 10.9 resolver crash)
npm run typecheck                  # tsc --noEmit; run before every install/reload
npm test                           # vitest unit tests
npx vitest run tests/validate.test.ts            # one file
npx vitest run -t "returns auto only"            # one test by name
PASEO_RESEARCH_E2E=1 npx vitest run tests/research-live.e2e.test.ts   # opt-in live models; costs tokens, retain sessions for review

paseo plugin install "$(pwd)"      # local install; then `paseo plugin ls` must show "running"
paseo plugin reload paseo-agent-team
paseo plugin logs paseo-agent-team
```

There is no build or lint step; Paseo bundles the TypeScript sources itself on install. Do not restart the daemon to pick up changes; use `paseo plugin reload`.

## Architecture

Paseo plugins have two runtimes, each with one entry that default-exports a `contribute` function:

- `index.server.ts` registers only the current member/Profile team RPCs. `server/research-team.ts` manages member sessions, prompt injection and reset. `server/team-directory.ts` manages supported files, listing, reconnect, restore and deletion.
- `index.client.tsx` registers `TeamPanel` (configuration), `AgentDashboard` (runtime graph and timeline), and `TeamScreen` (project teams and All agents). `client/ui.tsx` retains shared card, button and layout styles from the original UI. All projects use the same workflow; an unconfigured Workspace opens the member/Profile editor.
- `shared/research-team.ts` and `shared/research-rpc.ts` hold the active schemas, member identity, prompt rendering and RPC contracts. Shared code must stay pure: no Node or React Native APIs. UI text lives in `shared/messages.ts` in English, Korean, Japanese and Simplified Chinese.

The user-facing flow is configure Roles and local prompts → select member Profiles and Orchestrator → Apply → work through native conversations. Apply creates or reuses idle member sessions without sending tasks. Members proactively organize and send their own key findings or blockers. Orchestrator scheduling uses native Paseo messaging with `notifyOnFinish: false`, independently of Paseo parent/child lifecycle.

Key details:

- Current team definitions use `version: 2`, `workspace`, extensible `roles`, named `members`, `launchSnapshot` and `orchestratorMemberId`. Version 1 definitions are ignored and remain on disk. Do not add compatibility UI, automatic conversion or legacy planner flows. Original planner helper modules remain unregistered; they are outside the product workflow.
- Match each team to its Workspace by title. Preserve unrelated files when allocating a new definition filename.
- Stable labels `paseo-agent-team.team`, `paseo-agent-team.member` and `paseo-agent-team.config` identify sessions and prompt/config fingerprints. The Orchestrator also carries `workspace-agents=orchestrator`.
- Preserve user-selected provider/model/mode/effort/features. Do not choose automatic modes or replace Profiles. Changed prompt/config fingerprints are pending until explicit per-member reset.
- Read current model/thinking from Paseo session snapshots for display. Keep saved launch parameters distinct from session changes; observing differences must not overwrite either. Default/auto thinking resolution alone is not a manual override. Dashboard refreshes through agent updates and polling.
- Host-local Profile bindings and session IDs live in `.agents/.runtime/paseo-agent-team/<teamId>.json`, excluded from git on Apply.
- Team management follows pagination. The generic All agents view's single-page lists remain a known limitation.
- Daemon errors are English. Client UI strings go through `client/i18n.ts` and `shared/messages.ts`.

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
