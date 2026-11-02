import type { Team } from "./team";

const MODE_RULE = "Start each role's agent with its Mode from the table using `--mode <mode>`; omit `--mode` when the Mode is `default`.";

function workspaceLookup(team: Team): string {
  return `Your own workspace id is the one whose title is "${team.orchestrator.workspace}" in this project (Paseo tools, or \`paseo workspace ls --json\`). Use that id as <your-workspace-id> in \`paseo run\`.`;
}

// A provider can have a single, unattended mode (Antigravity has only `full-access`); swapping it fails or changes the team.
const NO_SUBSTITUTE = "Use exactly the role's provider, model and Mode: never substitute another mode or provider, for example `auto` for a provider that has only `full-access`. If starting a role's agent is denied, do not retry it another way; tell the user which role, provider and Mode were blocked.";

/**
 * The team as a markdown table; Mode is the role's agent mode, or "default" when its provider has none.
 */
function teamTable(team: Team, modes: Record<string, string | undefined>): string[] {
  return [
    "| Role | Provider/model | Mode | Folders |",
    "| --- | --- | --- | --- |",
    ...team.roles.map((role) => `| ${role.name} | ${role.provider}/${role.model} | ${modes[role.name] ?? "default"} | ${role.folders.length ? role.folders.join(", ") : "(any)"} |`),
  ];
}

/** The orchestrator's standing instructions, rendered from the team definition in `file` (project-relative). */
export function orchestratorPrompt(team: Team, modes: Record<string, string | undefined>, file: string): string {
  const notes = team.roles.filter((role) => role.instructions.trim()).map((role) => `- ${role.name}: ${role.instructions.trim()}`);
  return [
    "You are the orchestrator of this project's agent team in Paseo.",
    team.goal.trim() ? `Team goal: ${team.goal.trim()}` : "",
    `The team is defined in ${file} at the project root. Re-read it before delegating; it wins over this summary if they differ.`,
    "Other workspaces of this project may run other teams from other files in .agents/. Ignore them and their workspaces.",
    "",
    "## Team",
    ...teamTable(team, modes),
    `Every role runs in the orchestrator's workspace "${team.orchestrator.workspace}".`,
    ...(notes.length ? ["", "## Role notes", ...notes] : []),
    "",
    "## How to delegate",
    "- Split each request into parts and give each part to the role that owns it. Do the work yourself only when no role fits.",
    workspaceLookup(team),
    "- Start a role's agent in your own workspace with exactly that role's provider and model: Paseo tools, or `paseo run --workspace <your-workspace-id> --provider <provider>/<model> --mode <mode> --title <role>#<id> --label role=<role> --no-wait \"<task>\"`. Use 4 random uppercase hex characters for <id> (e.g. ui#ADB2); set the same agent title through Paseo tools. Use the role's Mode from the table with `--mode`, and omit `--mode` when the Mode is `default`.",
    `- ${NO_SUBSTITUTE}`,
    "- Look in your own workspace for an unarchived agent labelled role=<role> and continue it using send (`paseo send <agent-id> \"<task>\"`) instead of starting another.",
    "- Keep roles inside their folders. When two parts touch the same files, run them one after another, not at the same time.",
    "- Wait for the agents you started (`paseo wait <agent-id>`), read their results (`paseo logs <agent-id>`), then report what each role did and what is left.",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}

/** What a running orchestrator is told when the team is applied again. */
export function teamChangedMessage(team: Team, modes: Record<string, string | undefined>, file: string): string {
  return [
    `The team in ${file} changed. Re-read it and use it from now on.`,
    `Every role now runs in the orchestrator's workspace "${team.orchestrator.workspace}". Earlier instructions about per-role workspaces no longer apply.`,
    "Start and continue role agents only in your own workspace. Find a role's unarchived agent by label role=<role> and continue it with send; start it here if none exists.",
    workspaceLookup(team),
    "", ...teamTable(team, modes), "", MODE_RULE, NO_SUBSTITUTE,
  ].join("\n");
}
