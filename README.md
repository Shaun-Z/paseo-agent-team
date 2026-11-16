# Paseo Agent Team

A [Paseo](https://paseo.sh) plugin for teams with user-configured members, Agent Profiles and local Role prompts. All members work in one Workspace and keep independent conversations. The Orchestrator talks with the user, guides the work and wakes the configured members it needs through Paseo's native communication.

A Role defines responsibilities and prompt files. A member assigns that Role to user-selected provider, model and launch settings, optionally copied from a Profile. Multiple members can share a Role or Profile, and users can add new Roles at any time.

## Requirements

- Paseo 0.13.0 or later, with plugins enabled.
- Configured providers/models on the Host; Paseo Agent Profiles are optional templates.
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

1. Create the common and Role prompt files in your Project. Their paths are explicitly configured; no prompt directories are scanned.
2. Open the Workspace's **Agent team** panel and choose **Create configuration**, or choose **Agent teams → New team** and then **Create configuration**. Start with empty Roles and members, fill the goal and prompt paths, add members, configure launch settings manually or copy a Profile, and choose the Orchestrator.
3. Alternatively, write `.agents/team.yaml` or a `.yaml`, `.yml` or `.json` file under `.agents/teams/`, optionally adapting [`templates/research/team.yaml`](templates/research/team.yaml). The single-team names `.agents/team.yml` and `.agents/team.json` are also supported. Set `workspace` to the intended Paseo Workspace title, then **Reload from file**. A team without an active Workspace appears in **Agent teams**, where **Start new workspace** applies it.
4. Press **Apply**. Both configuration methods use the same editor. UI creation writes a YAML team definition; existing files retain their format. Apply creates or reuses independent idle member sessions without sending model tasks. Before Apply, Create configuration only opens a draft and does not write files or create sessions.
5. Open the Orchestrator's conversation and give it a task. It can wake any configured member by sending a native Paseo message. Members can discuss directly with one another and proactively send curated findings or blockers to the Orchestrator.

Prompt paths are relative to the Project root. Common prompts, the member's Role prompts and the generated coordination instructions are injected as supplemental instructions when its session is created. The harness keeps its own base instructions.

All projects use this workflow. Earlier `version: 1` definitions are ignored and remain on disk; there is no legacy editor, automatic conversion or planner flow. New team files avoid existing filenames.

## Team configuration and activity

**Agent team** loads team definitions from configuration files into one editor. Without a matching definition the Workspace panel offers Create configuration and the Load/Export controls, without a separate file-loading instructions box. The single editor has **General**, **Roles** and **Members** sections, expands one Role or member at a time, and shows editable member launch settings. General contains common prompts and the team definition path; Roles contains Role prompt files; Members contains optional Profile selection, editable launch settings, saved/current parameters, native conversation links and explicit per-member reset. Apply stays in the editor. Cancel discards draft changes and reloads the saved configuration without writing files or changing sessions. **Open dashboard** opens team activity.

The configuration panel uses a compact icon toolbar for Load, Export, reload and discard, with hover/focus labels and accessible names. Apply and Create configuration remain labelled primary actions. Load/Export opens a Paseo modal (a sheet on compact clients), keeping the editor in place. General, Roles and Members use a segmented navigation strip with counts; Role/member cards expand individually. Profile choices and directory entries use compact selection rows, while secondary explanations expand through the Details icon.

**Agent dashboard** shows activity in the current Workspace's team. **Overview** contains member status, a directed relationship graph and up to five recent messages. Wide panels place the graph and messages side by side. Click a member to open its native conversation and intervene. **Open dashboard** and **Team settings** switch between the two panels. A Workspace without a team shows a configuration entry.

Opposite message directions use separate paths and count badges. Filled arrowheads stop outside the cards, and each count badge includes a direction arrow. Badges are placed clear of cards and one another, above the lines, and remain clickable to open that direction in Timeline. A configured relationship is drawn once when the pair has no observed messages.

The Dashboard's **Timeline** merges current and archived sessions of configured members. It defaults to member messages, newest first. **All activity** adds user instructions, local replies, tools and events. Search stays visible; participant, activity and date/time controls expand through **Filters**. Select a graph arrow's message count to view that exchange. Expand a record for full text, tool details and native conversation links. Matching records are displayed 20 at a time. History is observed for the user; it is not forwarded to the Orchestrator.

The sidebar's **Agent teams** screen keeps the project card layout and lists all configured teams. **All agents** displays native sessions across projects, including activity filters and compact tree cards. Its counts describe agent trees. Configured members without sessions are shown in their team's Dashboard.

Members can edit Provider, model, mode and thinking before or after selecting a Profile. Fields accept typed values and offer choices from the Host catalog; Provider features expose the Host's toggle/select controls. Selecting a Profile replaces the member's launch settings with that template. Later edits affect only that member and never modify the global Profile. Choosing Manual configuration detaches the template while retaining settings. Catalog refreshes do not select defaults or rewrite saved values.

The member editor shows **Current session** settings alongside the saved launch parameters. Model, explicit mode or thinking-selection changes are marked **Differs from saved settings**, separately from pending prompt/config updates. Dashboard cards use the current session's model and effective thinking level, refreshed through agent updates and polling. Unreported values remain unknown. Provider defaults and automatic thinking resolution do not by themselves indicate a manual change. Displaying differences does not change settings: Apply reuses the session and reset uses saved launch parameters.

The relationship graph automatically scales down as a whole to fit its available column, including cards, lines, arrows and count badges. It preserves aspect ratio, reserves only the scaled height and recalculates on panel resize or graph changes. Recent messages keep their own column; the graph no longer extends behind them. Graphs that already fit remain at their original size.

## Change a team

Reapplying reuses member sessions by team and member identity. Changed prompts or launch settings are marked pending. **Reset member session** explicitly archives that member's session and creates a fresh one using the saved configuration; other members keep their sessions. Removing a member and applying archives its session.

Editing a Paseo Profile does not silently change a member. Reselect the Profile, Apply, then reset that member if its saved configuration changed. The plugin preserves selected modes, effort and feature values without choosing substitute models or permissions.

Teams match Workspaces by the team definition's `workspace` title. After renaming a Workspace, use **Reconnect** from the sidebar's team row. A Project can contain several teams, each in its own Workspace. **Start in a new workspace** restores a saved team when its Workspace is missing.

**Delete team** archives the team's labelled member sessions and removes its team file and local member directory. Archive failures keep the team definition for retry. Files in the research project are not deleted.

## Team definition

One team file configures the whole team in one Workspace: goal, common prompt files, Roles, members, launch parameters and Orchestrator. New configurations default to `.agents/teams/<workspace>.yaml`. The loader accepts `.json`, `.yaml` and `.yml` in `.agents/teams/`, and `.agents/team.json`, `.agents/team.yaml` or `.agents/team.yml`. Existing files retain their path and format. Use exactly one definition per Workspace; duplicate definitions are reported instead of picking a format by priority.

You can create the configuration through the editor or write the file directly. Match `workspace` to the intended Paseo Workspace title and fill the launch snapshots from the Profiles you selected. Open **Agent team**, use **Reload from file** if the editor was already open, review, then **Apply**. Reload discards unsaved form edits and does not create sessions. A definition with no active Workspace is listed under **Agent teams**, where **Start new workspace** applies it. Saving a file alone does not create or restart sessions. Existing sessions are reused; changed prompts or launch settings require an explicit member reset.

For example:

```yaml
version: 2
id: research-team
workspace: Research # Match the Paseo Workspace title.
goal: |
  Investigate and validate a method.
commonPromptFiles:
  - prompts/research-team-common.md
orchestratorMemberId: anchor-main
roles:
  - id: anchor
    name: Anchor
    promptFiles:
      - prompts/anchor.md
  - id: programmer
    name: Programmer
    promptFiles:
      - prompts/programmer.md
members:
  - id: anchor-main
    roleId: anchor
    launchSnapshot:
      provider: YOUR_PROVIDER
      model: YOUR_MODEL
  - id: programmer-main
    roleId: programmer
    launchSnapshot:
      provider: YOUR_PROVIDER
      model: YOUR_MODEL
```

An optional three-Role example is available in [`templates/research/team.yaml`](templates/research/team.yaml). It is not automatically loaded. The provider and model placeholders must be filled from user-selected Profiles; preserve `modeId`, `thinkingOptionId` and `featureValues` when set. Files store launch snapshots rather than Profile names, so sharing a team does not depend on another host's Profile IDs. Team definitions are intended for git. Host-local Profile bindings and agent IDs remain JSON in `.agents/.runtime/paseo-agent-team/`, which Apply excludes through the Project's `.gitignore`.

YAML supports comments and multiline text. Editor saves retain unchanged nodes and their comments where possible; edits involving aliases may rebuild the document to preserve launch settings. JSON and YAML use the same version 2 schema. Syntax errors, duplicate YAML keys and conflicting team ownership are reported with the filename. Version 1 definitions remain ignored.

### Load and export

The Workspace's **Agent team** panel offers **Load** and **Export**, including Load before a team has been configured. Both browse directories on the **current agent host**: when the Workspace is on raspi5, the browser lists raspi5 files. It does not open the client computer's system file chooser. The same React Native UI works on desktop, Web and mobile. Project-level New team still opens the configuration editor.

**Load** opens a modal host directory browser at the Project root. Open folders, jump to **Project**, **Home** or the parent, filter the current directory, or enter an absolute, Project-relative or `~/` directory path and press **Go**. The browser shows directories and JSON/YAML/YML files, including hidden directories and readable symlinks. Select a configuration file, then confirm **Load and replace configuration**. Browsing and selection alone do not write configuration or change sessions. The source file path may also be entered manually.

Load retains the target Workspace title and an existing Team ID so current sessions remain associated with their team. A Workspace with no team keeps the imported Team ID, provided it does not belong to another Workspace. The existing definition path and format are preserved; a new definition defaults to YAML. Common and Role prompt paths remain relative to the target Project root. Invalid files and conflicting Team IDs leave the configuration untouched. Profile bindings are retained only for unchanged member launch snapshots; imported settings do not guess a matching host Profile. Load does not create, archive, reset or message sessions. Apply synchronizes the configured member set; changed prompts and launch parameters still need explicit member reset.

**Export** browses the same agent host. Select a directory and enter an **Export filename**, or select an existing configuration file to reuse its name. The full destination is shown in **Export file path** and remains manually editable. Confirm Export to write the saved team definition there. Unsaved editor changes and the separate host runtime directory are excluded. Export before the first save is disabled. `.json` selects JSON; `.yaml` and `.yml` select YAML. Same-format exports retain source text and comments; conversions serialize the validated settings. Export creates parent directories as needed, requires **Overwrite existing export file** for existing destinations, and refuses the current Project's active team definition/runtime locations.

The host directory browser reads one directory at a time and returns at most 300 entries. It can navigate outside the Project when the agent host's filesystem permissions allow it. Prompt selection has a separate Project-only boundary.

Load/Export keeps a bounded dialog relative to the client window, with the directory list scrolling inside the available space. Folder contents, loading, empty and error states do not resize the dialog. Prompt dropdowns likewise keep a fixed list height while navigating.

### Prompt file selection

Common prompts and each Role's prompt paths include a **Choose prompt files** dropdown. It browses one requested directory at a time on the Project's Paseo host, supports multiple selections, filtering the current folder, parent navigation and refresh, and includes hidden folders. Selection updates only the editor draft. Direct path entry remains available. Lists contain at most 300 entries per directory and omit symlinks; Prompt content is read only when the existing validation/injection flow needs it. Browsing does not infer Roles or recursively scan `prompt/` or `prompts/`.

## Import and compare a Git repository

The **Import from Git** icon is available before and after configuring a team, including the project-level creation editor. Enter an HTTPS or SSH Git URL and a branch, tag or commit (default `HEAD`). Git must be installed and authenticated on the current agent host. Fetch resolves one commit without checking out files or running repository scripts, hooks, filters or submodules. Select a JSON/YAML version 2 team definition, such as root `team.yaml` or `.agents/team.yaml`; conventional paths are listed, and other tracked configuration paths can be entered explicitly. Referenced prompt paths are relative to the repository root. For example, [Multi-Agent Scientific Research Framework](https://github.com/Shaun-Z/Multi-Agent-Scientific-Research-Framework) provides `team.yaml` and its Role/common prompts.

**Compare configuration** reads the saved local definition and referenced prompt contents. For a new team, creation items are selected for review. For an existing team, all updates start unselected. Select Role names or prompt paths, member names or Role assignments, individual launch fields (provider, model, mode, thinking, features), common prompt paths, goal, Orchestrator, and prompt contents independently. Expand each item to see its full local and repository values. Local-only Roles and members can be removed explicitly; unselected entries and local-only prompt files are retained. Dependent Role/member selections must form a valid team, and every final prompt reference must exist locally or be selected for import.

**Import selected** saves only selected prompt files and the merged team definition, then reloads the editor draft. Existing Team ID, Workspace title, definition path and format are retained. New teams save YAML. Unchanged member launch snapshots keep source Profile bindings; importing different launch parameters removes that member's binding without selecting another Profile. No sessions are started, archived or reset. Review launch settings and use Apply and explicit member reset afterward.

Comparisons use the fetched commit even if the remote branch moves. If local configuration or compared prompt contents change before import, compare again. Previews expire after 20 minutes or plugin reload, with at most ten fetched sources retained. The import rejects symlink destinations, traversal/reserved prompt paths, case-colliding source paths, files over 512 KiB, more than 100 prompts, and bundles over 4 MiB. Only referenced prompts and the team definition are imported; README, research state, experiments and other repository files are left out.

## Language

The UI follows Paseo's app language. English, Korean, Japanese and Simplified Chinese are included. Daemon-side errors are English.

## Limitations

- Git import requires host Git access and a version 2 team definition with explicit prompt paths. It does not infer Roles from prompt directories, merge arbitrary repository files, or synchronize future repository updates automatically. Preview compares saved files; importing replaces the editor draft.
- Launch settings are stored per member; Profiles are optional templates. Unsupported provider/model values are rejected on Apply. Existing sessions require explicit reset to adopt saved changes.
- Secondary actions use icons with hover/focus hints and accessibility labels. Compact clients present Load/Export in a Paseo sheet; modal size and gestures follow the host client.
- Load/Export browses the selected agent host and shows at most 300 entries per directory; filesystem permissions determine which locations are readable or writable. Prompt selection is restricted to that host's Project and also shows at most 300 entries per folder. There is no client-device upload/download or system file dialog.
- External JSON/YAML edits are not automatically applied to sessions. Reload discards unsaved editor changes. Changed prompts or launch parameters still require an explicit per-member reset. YAML comments are preserved where possible; alias-dependent rewrites can reformat them.
- Roles, members and prompt paths are explicitly configured through the UI or a team definition file. The plugin does not scan prompt directories or preselect member Profiles or the Orchestrator.
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
