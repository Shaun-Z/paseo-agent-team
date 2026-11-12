# Paseo Agent Team

A [Paseo](https://paseo.sh) plugin for teams with user-configured members, Agent Profiles and local Role prompts. All members work in one Workspace and keep independent conversations. The Orchestrator talks with the user, guides the work and wakes the configured members it needs through Paseo's native communication.

A Role defines responsibilities and prompt files. A member assigns that Role to a specific Profile's provider, model and launch settings. Multiple members can share a Role or Profile, and users can add new Roles at any time.

## Requirements

- Paseo 0.13.0 or later, with plugins enabled.
- User-configured Agent Profiles in Paseo Host settings.
- Paseo tools available to each selected provider for native agent communication.
- A Workspace using the Project checkout; all members share its files.

## Install

```bash
npm install
paseo plugin install "$(pwd)"
paseo plugin ls
```

Paseo bundles the TypeScript sources. Use `paseo plugin reload paseo-agent-team` after changes; do not restart the daemon.

## Configure a team

1. Create the common and Role prompt files in your Project. Copy the examples from `templates/research/prompts/` and edit them for your work. Hidden directories are also supported.
2. Open the Workspace's **Agent team** panel, or choose **Agent teams → New team** from the sidebar.
3. Set the team goal, common prompt files and extensible Roles. Add members, select an Agent Profile for each, and choose one member as Orchestrator. A Profile without a fixed model requires an explicit model selection.
4. Press **Apply**. The plugin saves the team and creates or reuses independent idle member sessions. Apply does not send work to the models.
5. Open the Orchestrator's conversation and give it a task. It can wake any configured member by sending a native Paseo message. Members can discuss directly with one another and proactively send curated findings or blockers to the Orchestrator.

Prompt paths are relative to the Project root. Common prompts, the member's Role prompts and the generated coordination instructions are injected as supplemental instructions when its session is created. The harness keeps its own base instructions.

All projects use this workflow. Earlier `version: 1` definitions are ignored and remain on disk; there is no legacy editor, automatic conversion or planner flow. New team files avoid existing filenames.

## Team configuration and activity

**Agent team** shows configuration summaries. **Members** lists saved Profile launch parameters, with the Orchestrator highlighted. **Roles & prompts** lists common and Role prompt files and the team definition path. Each member and Role has a direct editing entry. The editor has **General**, **Roles** and **Members** sections, expands one Role or member at a time, and initially collapses launch parameter details. Apply and Cancel remain at the top.

**Agent dashboard** shows activity in the current Workspace's team. **Overview** contains member status, a directed relationship graph and up to five recent messages. Wide panels place the graph and messages side by side. Click a member to open its native conversation and intervene. **Open dashboard** and **Team settings** switch between the two panels. A Workspace without a team shows a configuration entry.

Opposite message directions use separate paths and count badges. Filled arrowheads stop outside the cards, and each count badge includes a direction arrow. Badges are placed clear of cards and one another, above the lines, and remain clickable to open that direction in Timeline. A configured relationship is drawn once when the pair has no observed messages.

The Dashboard's **Timeline** merges current and archived sessions of configured members. It defaults to member messages, newest first. **All activity** adds user instructions, local replies, tools and events. Search stays visible; participant, activity and date/time controls expand through **Filters**. Select a graph arrow's message count to view that exchange. Expand a record for full text, tool details and native conversation links. Matching records are displayed 20 at a time. History is observed for the user; it is not forwarded to the Orchestrator.

The sidebar's **Agent teams** screen keeps the project card layout and lists all configured teams. **All agents** displays native sessions across projects, including activity filters and compact tree cards. Its counts describe agent trees. Configured members without sessions are shown in their team's Dashboard.

Member summaries and the member editor show **Current session** settings alongside the saved launch parameters. Model, explicit mode or thinking-selection changes are marked **Differs from saved settings**, separately from pending prompt/config updates. Dashboard cards use the current session's model and effective thinking level, refreshed through agent updates and polling. Unreported values remain unknown. Provider defaults and automatic thinking resolution do not by themselves indicate a manual change. Displaying differences does not change settings: Apply reuses the session and reset uses saved launch parameters.

The relationship graph automatically scales down as a whole to fit its available column, including cards, lines, arrows and count badges. It preserves aspect ratio, reserves only the scaled height and recalculates on panel resize or graph changes. Recent messages keep their own column; the graph no longer extends behind them. Graphs that already fit remain at their original size.

## Change a team

Reapplying reuses member sessions by team and member identity. Changed prompts or launch settings are marked pending. **Reset member session** explicitly archives that member's session and creates a fresh one using the saved configuration; other members keep their sessions. Removing a member and applying archives its session.

Editing a Paseo Profile does not silently change a member. Reselect the Profile, Apply, then reset that member if its saved configuration changed. The plugin preserves selected modes, effort and feature values without choosing substitute models or permissions.

Teams match Workspaces by the team definition's `workspace` title. After renaming a Workspace, use **Reconnect** from the sidebar's team row. A Project can contain several teams, each in its own Workspace. **Start in a new workspace** restores a saved team when its Workspace is missing.

**Delete team** archives the team's labelled member sessions and removes its team file and local member directory. Archive failures keep the team definition for retry. Files in the research project are not deleted.

## Team definition

One team file belongs to one Workspace. Definitions live in `.agents/teams/<workspace>.json`; the same format may be stored in `.agents/team.json`. For example:

```json
{
  "version": 2,
  "id": "research-team",
  "goal": "Investigate and validate a method",
  "workspace": "Research",
  "commonPromptFiles": ["prompts/research-team-common.md"],
  "orchestratorMemberId": "anchor-main",
  "roles": [
    { "id": "anchor", "name": "Anchor", "promptFiles": ["prompts/anchor.md"] },
    { "id": "programmer", "name": "Programmer", "promptFiles": ["prompts/programmer.md"] }
  ],
  "members": [
    { "id": "anchor-main", "roleId": "anchor", "launchSnapshot": { "provider": "YOUR_PROVIDER", "model": "YOUR_MODEL" } },
    { "id": "programmer-main", "roleId": "programmer", "launchSnapshot": { "provider": "YOUR_PROVIDER", "model": "YOUR_MODEL" } }
  ]
}
```

The example's provider and model placeholders must be filled from user-selected Profiles. Launch snapshots also preserve `modeId`, `thinkingOptionId` and `featureValues` when set. Team definitions are intended for git. Host-local Profile bindings and agent IDs live in `.agents/.runtime/paseo-agent-team/`, which Apply excludes through the Project's `.gitignore`.

## Language

The UI follows Paseo's app language. English, Korean, Japanese and Simplified Chinese are included. Daemon-side errors are English.

## Limitations

- Reporting rules are prompt instructions. Members organize and send their own reports; the plugin does not summarize or relay ordinary conversation. Agent behavior and user steering depend on the provider.
- Tool injection must be supported by each harness. For agy, use the separate `antigravity-cli` adapter with **Share Paseo tools with Antigravity** enabled. The built-in Antigravity adapter cannot inject those tools. Pi depends on its installed integration.
- Native communication has been verified with an Antigravity CLI coordinator and two Codex members using saved Profiles. Other combinations, active user interruption and daemon restart recovery still need live validation.
- Automatic approval review can reject peer-requested tool calls without a recognized user-authorized task scope. The plugin preserves the selected Profile and does not grant that authorization automatically.
- All members share one checkout. Coordinate overlapping edits. Role prompts do not enforce filesystem isolation.
- Timeline ordering uses Paseo timestamps; restored history may have reconstructed times. Equal timestamps do not establish order across sessions. Current-session graph counts exclude callbacks and archived sessions. Removed members' history remains in Paseo archives.
- The panel backfills configured members' histories on opening. Very long histories may take time to load. Navigation opens a conversation, since the plugin API does not expose jumping to an individual message.
- Current-session parameters reflect Paseo's reported snapshot. A harness may report a change after it takes effect; unreported values remain unknown. Session changes are not automatically saved as future launch defaults.
- The generic **All agents** view reads one page of workspace and agent lists. Team management follows pagination. Historical sub-agent discovery in All agents reads the latest 200 items of each unarchived agent, and historical status may lag activity.
- Native conversation links require client navigation support. Paseo controls sidebar ordering.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin reload paseo-agent-team
paseo plugin logs paseo-agent-team
```

`client/` runs in the Paseo app, `server/` runs in the daemon plugin process, and `shared/` contains pure contracts, identity and prompt logic. `server/team-directory.ts` manages supported team definitions and `server/research-team.ts` manages member sessions. The original planner helpers remain unregistered and are outside the current product workflow.

The opt-in test `PASEO_RESEARCH_E2E=1 npx vitest run tests/research-live.e2e.test.ts` starts real models using Profiles named `Anchor`, `Programmer` and `Mathematician`. `PASEO_RESEARCH_PROFILES` can map those Roles to Profile IDs or names. It tests communication and a single-member reset in a temporary Project, retains sessions for user review and writes `smoke-report.json`. `PASEO_RESEARCH_ARCHIVE=1` explicitly archives the fixture afterwards. A bounded arithmetic probe denied by automatic review may be retried with `PASEO_RESEARCH_PEER_APPROVAL=1` only after the user explicitly authorizes that probe. See [the design and verification notes](docs/research-team-design.md).
