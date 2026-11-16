## Concept

Paseo Agent Team organizes user-configured agents in one shared Workspace. A Role defines responsibilities and local prompt files. A member has a stable identity, a Role and launch parameters configured manually or copied from a Paseo Agent Profile. Several members can perform the same Role on different providers or models.

The user selects one member as Orchestrator. It discusses direction with the user and wakes configured members through native Paseo messages. Members collaborate directly and proactively send organized key findings or blockers to the Orchestrator. Common prompts, Role prompts and coordination instructions supplement each member's harness instructions.

## Configure and work

Teams can be configured in the UI or loaded from JSON/YAML files. Create configuration opens a draft with no built-in Roles or members. Users explicitly configure Roles, local prompt paths and members, set launch parameters manually or from optional Profiles, and choose the Orchestrator. UI creation saves YAML on Apply. Opening the draft creates no file or sessions. The plugin does not scan prompt directories. Apply writes the team definition and prepares independent idle sessions in the team's Workspace. It does not issue model tasks. The plugin preserves each member's provider, model, mode, effort and feature values.

Users start work in the Orchestrator's native conversation and can enter any member's conversation to give instructions. Members share Project files while maintaining separate conversations. The plugin does not summarize or forward ordinary conversation to the Orchestrator.

There is one team workflow. Earlier version 1 definitions are ignored and remain on disk. Old planner, editor and configuration conversion flows are not exposed.

## Configuration and activity

The **Agent team** panel uses one configuration editor with General, Roles and Members sections. It opens configured teams directly; without a definition the Workspace panel offers Create configuration and Load/Export without a separate file-loading instructions box. There is no separate summary page or Edit team entry. One Role or member expands at a time. Member settings include Profile selection, saved/current parameters, native conversation links and explicit per-member reset. Apply stays in the editor; Cancel discards draft changes and restores saved configuration without changing sessions. Open dashboard opens team activity.

Configuration actions use a compact icon toolbar with hover/focus hints and accessible names. Apply and Create configuration remain labelled primary actions. Load/Export uses a Paseo modal, presented as a sheet on compact clients. Section navigation shows Role/member counts; directory and Profile selection use compact rows. Additional explanations expand through Details.

The Load/Export dialog keeps a bounded size relative to the client window while folder contents and loading states scroll inside its directory viewport. Prompt dropdowns also keep a fixed list height, so navigating folders does not resize the picker.

The **Agent dashboard** panel shows activity for that Workspace's team. Overview contains member status, a directed relationship graph and up to five recent messages. Wide panels place the graph and messages side by side. Members with the same Role remain separate nodes. Nodes open native conversations; message counts open the corresponding exchange. Configured members without a session remain visible. Workspaces without a configured team show a configuration entry.

Opposite message directions have separate paths and count badges. Filled arrowheads remain outside cards. Count badges include direction arrows, avoid cards and each other, and render above lines. Selecting a badge opens that direction in Timeline. Pairs without observed communication use a single structural link.

Timeline combines current and archived sessions of configured members. It defaults to member messages, newest first; All activity adds user instructions, local replies, tools and events. Search stays visible while participant, activity and time filters expand on demand. Expanded records expose full text, tool details and native conversation links. Matching records are displayed 20 at a time. Timeline is a read-only user view and does not send history into the Orchestrator's conversation.

The two panels link to each other in the same Workspace. The sidebar's **Agent teams** screen retains compact project cards and team actions. **All agents** shows native session trees across projects with activity filters, density controls and closed-session controls.

Provider, model, mode and thinking remain editable before and after choosing a Profile. Host catalog choices and feature toggle/select controls supplement manual entry. Selecting a Profile copies its settings; later member edits do not modify the Profile. Switching to Manual configuration retains settings and removes the source binding. Discovery never applies defaults to the draft.

The member editor compares saved launch parameters with Current session settings. Model, explicit mode and thinking-selection changes receive a separate difference indicator. Dashboard cards display the current model and effective thinking level, refreshed through agent updates and polling. Unreported values remain unknown; default/automatic effort resolution alone is not marked as a manual change. Displaying differences does not overwrite settings: Apply retains the session and reset uses saved launch parameters.

The relationship graph scales down uniformly to its measured available width. Cards, paths, arrowheads and count badges keep their relative positions and interaction targets. Its container reserves the scaled height, recalculates on resize or graph changes, and stays separate from Recent messages. Graphs that fit are not enlarged.

## Team definitions and changes

Import from Git is available when creating or updating a team. The current agent host fetches an HTTPS/SSH repository at a branch, tag or commit, without checkout or repository execution. Users select a version 2 JSON/YAML team definition and compare its explicit Role, member and prompt references with saved local files. Common settings, individual member launch fields and prompt text are selectable independently. New team items start selected for review; existing team updates start unselected. Local-only Roles and members are removed only when selected, while local-only prompt files remain on disk.

Import saves selected prompts and a validated merged definition, retaining existing Team ID, Workspace title, file path and format. It reloads the editor draft without changing sessions. Changed launch snapshots lose only their source Profile binding. Dependent references and missing prompts are checked before writing. A comparison stays pinned to its fetched commit and rejects local edits made after preview. Sources expire after 20 minutes or reload, with at most ten retained. Host Git and repository authentication are required. Only referenced text files are imported: no README, research state, experiment files or automatic prompt discovery. Imports reject symlinks, reserved/traversing prompt paths and case collisions, with limits of 512 KiB per file, 100 prompts and 4 MiB total.

A Project can have multiple teams, each owning one Workspace. New team definitions use `.agents/teams/<workspace>.yaml`. JSON, YAML and YML files are accepted in `.agents/teams/`, with single-team alternatives `.agents/team.json`, `.agents/team.yaml` and `.agents/team.yml`. Existing paths and formats are retained; multiple definitions for one Workspace are reported as conflicts. Users can configure the whole team by editing these files. Reload from file replaces unsaved form edits, then Apply prepares sessions. File edits alone do not create or restart sessions. YAML supports comments and multiline text; comments are retained where possible, although alias-dependent edits may reformat the document. Definitions use version 2, separate Roles from members and store Profile launch snapshots. Files are intended to be shared through git. Host-local Profile bindings and live session IDs are kept in `.agents/.runtime/paseo-agent-team/`, excluded through the Project's `.gitignore` on Apply.

Reapplying reuses sessions by team and member identity. Prompt or launch-setting changes are marked pending. Explicit per-member reset archives that member's conversation and creates a fresh one, preserving other sessions. Removing a member and applying archives its session. Profile edits affect a member after the user reselects that Profile, applies and resets the changed member.

Teams match Workspaces by the definition's `workspace` title. Reconnect attaches a saved team to an available Workspace after a rename. Restoring a team can recreate its missing Workspace. Deleting a team archives its labelled member sessions and removes the definition and local member directory. Archive failures preserve the definition for retry. Existing unrelated files and sessions are outside these operations.

The Workspace panel includes Load and Export with a directory browser on the **current agent host**. For remote Workspaces this lists remote files, including readable locations outside the Project. It starts at the Project root and offers Project, Home and parent shortcuts, directory path entry, current-folder filtering and refresh. It lists directories and JSON/YAML/YML files, with at most 300 entries. It does not open the client device's system file chooser.

Load selects a host file, validates it and replaces the saved configuration and editor draft while retaining the target Workspace title and existing Team ID. Imported prompt paths use the target Project root. Unchanged member launch snapshots retain Profile bindings; changed snapshots do not choose a matching Profile. Browsing or selecting files does not write configuration, and Load does not change sessions. Apply and explicit reset retain their usual roles.

Export selects a host directory and filename and writes the saved definition, excluding unsaved editor changes and the runtime directory. The destination extension selects JSON or YAML. Same-format copies preserve text and comments. Parent directories are created as needed; overwriting an existing destination requires an explicit option. Active definition/runtime locations in the current Project are excluded. The same directory browser works across desktop, Web and mobile clients.

Common and Role prompt fields offer a dropdown to browse Project directories on the Paseo host, filter the current folder and select multiple files. Hidden folders are included; manual path entry remains available. Browsing only lists the requested directory and does not infer Roles or recursively scan prompt folders. Selections change the draft until Apply.

## Requirements

- Paseo 0.13.0 or later with plugins enabled.
- Ready providers with available models. Agent Profiles are optional templates.
- Native Paseo tools available in each selected harness.
- One shared Workspace in the Project checkout.

## Language

English, Korean, Japanese and Simplified Chinese UI text are included. Daemon-side errors are English.

## Data and privacy

The plugin reads Project, Workspace, provider, Profile and agent metadata; local prompt files; and member conversation histories. It writes team definitions and a local member directory. Member prompts and task content are processed by the selected model providers under their normal behavior. Model turns consume provider usage. The plugin runs no separate external service.

## Limitations

- Load/Export browses the agent host, subject to filesystem permissions and a 300-entry directory limit. It does not upload/download client-device files or open system file dialogs. Prompt file dropdowns remain Project-only, omit symlinks and list at most 300 entries per folder.
- External JSON/YAML edits require reloading the editor before Apply. Reload discards unsaved editor changes. Changed prompts or launch parameters require an explicit member reset. YAML alias-dependent rewrites may reformat comments.
- Roles, members and prompt paths are explicitly configured through the UI or a file. There is no prompt directory scan or automatic member Profile or Orchestrator selection.
- Reporting and collaboration rules are prompt instructions. Provider behavior determines tool availability, interruptions and user steering.
- Session parameters are the values reported by Paseo. Harness updates may arrive after a change takes effect. Changes in native conversations are not automatically saved as launch defaults.
- The built-in Antigravity adapter cannot inject Paseo tools. The separate `antigravity-cli` adapter supports opt-in tool sharing through ACP. Pi depends on its installed integration.
- Native communication has been verified with an Antigravity CLI coordinator and two Codex members using saved Profiles. Other provider combinations, active interruption and restart recovery need live validation.
- Approval reviewers may require a user-authorized task scope in a member's conversation. The plugin does not grant that authorization or substitute permission settings.
- Shared files require coordination for overlapping edits. Role prompts do not enforce filesystem isolation.
- Timeline ordering depends on Paseo timestamps, which some providers reconstruct. Equal times do not establish cross-session ordering. Graph counts cover current sessions and exclude callbacks. Removed members' history remains accessible in Paseo archives.
- Long histories are backfilled on opening and displayed 20 matching records at a time. Navigation opens conversations rather than individual messages.
- The generic All agents view reads one page of Workspace and agent lists. Team management follows pagination. Historical sub-agent discovery reads the latest 200 timeline items per unarchived agent and may show stale status until new activity arrives.
- Native conversation links require client navigation. Paseo controls sidebar ordering.
