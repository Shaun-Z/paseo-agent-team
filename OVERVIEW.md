## Concept

Paseo Agent Team organizes user-configured agents in one shared Workspace. A Role defines responsibilities and local prompt files. A member has a stable identity, a Role and launch parameters selected from a Paseo Agent Profile. Several members can perform the same Role on different providers or models.

The user selects one member as Orchestrator. It discusses direction with the user and wakes configured members through native Paseo messages. Members collaborate directly and proactively send organized key findings or blockers to the Orchestrator. Common prompts, Role prompts and coordination instructions supplement each member's harness instructions.

## Configure and work

Users create local prompt files, configure Roles and members, choose each member's Profile and select the Orchestrator. Apply writes the team definition and prepares independent idle sessions in the team's Workspace. It does not issue model tasks. The plugin preserves each Profile's provider, model, mode, effort and feature values.

Users start work in the Orchestrator's native conversation and can enter any member's conversation to give instructions. Members share Project files while maintaining separate conversations. The plugin does not summarize or forward ordinary conversation to the Orchestrator.

There is one team workflow. Earlier version 1 definitions are ignored and remain on disk. Old planner, editor and configuration conversion flows are not exposed.

## Configuration and activity

The **Agent team** panel shows configuration. **Members** lists saved launch parameters, highlighting the Orchestrator. **Roles & prompts** lists common and Role prompt files and the team definition path. Direct edit actions open the selected member or Role. The editor separates General, Roles and Members, expands one item at a time and initially collapses launch parameter details. Apply and Cancel remain visible at the top.

The **Agent dashboard** panel shows activity for that Workspace's team. Overview contains member status, a directed relationship graph and up to five recent messages. Wide panels place the graph and messages side by side. Members with the same Role remain separate nodes. Nodes open native conversations; message counts open the corresponding exchange. Configured members without a session remain visible. Workspaces without a configured team show a configuration entry.

Timeline combines current and archived sessions of configured members. It defaults to member messages, newest first; All activity adds user instructions, local replies, tools and events. Search stays visible while participant, activity and time filters expand on demand. Expanded records expose full text, tool details and native conversation links. Matching records are displayed 20 at a time. Timeline is a read-only user view and does not send history into the Orchestrator's conversation.

The two panels link to each other in the same Workspace. The sidebar's **Agent teams** screen retains compact project cards and team actions. **All agents** shows native session trees across projects with activity filters, density controls and closed-session controls.

## Team definitions and changes

A Project can have multiple teams, each owning one Workspace. A team definition lives in `.agents/teams/<workspace>.json`; the same format may be stored in `.agents/team.json`. Definitions use version 2, separate Roles from members and store Profile launch snapshots. Files are intended to be shared through git. Host-local Profile bindings and live session IDs are kept in `.agents/.runtime/paseo-agent-team/`, excluded through the Project's `.gitignore` on Apply.

Reapplying reuses sessions by team and member identity. Prompt or launch-setting changes are marked pending. Explicit per-member reset archives that member's conversation and creates a fresh one, preserving other sessions. Removing a member and applying archives its session. Profile edits affect a member after the user reselects that Profile, applies and resets the changed member.

Teams match Workspaces by the definition's `workspace` title. Reconnect attaches a saved team to an available Workspace after a rename. Restoring a team can recreate its missing Workspace. Deleting a team archives its labelled member sessions and removes the definition and local member directory. Archive failures preserve the definition for retry. Existing unrelated files and sessions are outside these operations.

## Requirements

- Paseo 0.13.0 or later with plugins enabled.
- User-configured Agent Profiles and ready providers.
- Native Paseo tools available in each selected harness.
- One shared Workspace in the Project checkout.

## Language

English, Korean, Japanese and Simplified Chinese UI text are included. Daemon-side errors are English.

## Data and privacy

The plugin reads Project, Workspace, provider, Profile and agent metadata; local prompt files; and member conversation histories. It writes team definitions and a local member directory. Member prompts and task content are processed by the selected model providers under their normal behavior. Model turns consume provider usage. The plugin runs no separate external service.

## Limitations

- Reporting and collaboration rules are prompt instructions. Provider behavior determines tool availability, interruptions and user steering.
- The built-in Antigravity adapter cannot inject Paseo tools. The separate `antigravity-cli` adapter supports opt-in tool sharing through ACP. Pi depends on its installed integration.
- Native communication has been verified with an Antigravity CLI coordinator and two Codex members using saved Profiles. Other provider combinations, active interruption and restart recovery need live validation.
- Approval reviewers may require a user-authorized task scope in a member's conversation. The plugin does not grant that authorization or substitute permission settings.
- Shared files require coordination for overlapping edits. Role prompts do not enforce filesystem isolation.
- Timeline ordering depends on Paseo timestamps, which some providers reconstruct. Equal times do not establish cross-session ordering. Graph counts cover current sessions and exclude callbacks. Removed members' history remains accessible in Paseo archives.
- Long histories are backfilled on opening and displayed 20 matching records at a time. Navigation opens conversations rather than individual messages.
- The generic All agents view reads one page of Workspace and agent lists. Team management follows pagination. Historical sub-agent discovery reads the latest 200 timeline items per unarchived agent and may show stale status until new activity arrives.
- Native conversation links require client navigation. Paseo controls sidebar ordering.
