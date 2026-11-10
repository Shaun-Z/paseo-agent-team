import type { ResearchTeam } from "./research-team";
import type { Team } from "./team";
import type { TeamError } from "./validate";

/** Each workspace's team lives in its own file here, named after its orchestrator's workspace. */
export const TEAMS_DIR = ".agents/teams";

/** A team definition and the project-relative file it was read from. */
export interface TeamFile {
  file: string;
  team: Team;
  research?: ResearchTeam;
  /** Old role workspace titles, reserved until the file is rewritten without them. */
  legacyWorkspaces?: string[];
}

const key = (title: string) => title.trim().toLowerCase();

/** Captures old role workspace titles before RoleSchema strips them. */
export function legacyWorkspacesOf(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("roles" in value) || !Array.isArray(value.roles)) return [];
  const titles = value.roles.flatMap((role: unknown) => role && typeof role === "object" && "workspace" in role && typeof role.workspace === "string" && role.workspace.trim() ? [role.workspace.trim()] : []);
  return [...new Map(titles.map((title) => [key(title), title])).values()];
}

/** Workspaces reserved by a file, including old role workspaces until Apply rewrites it. */
export function teamFileWorkspaces(entry: TeamFile): string[] {
  return [...new Map([...teamWorkspaces(entry.team), ...(entry.legacyWorkspaces ?? [])].map((title) => [key(title), title])).values()];
}

/** The team reserving a workspace, including an old role workspace. */
export function workspaceOwnerOf(files: readonly TeamFile[], workspace: string): TeamFile | undefined {
  return teamIn(files, workspace) ?? files.find((entry) => teamFileWorkspaces(entry).some((title) => key(title) === key(workspace)));
}

/** The team whose orchestrator runs in the workspace with this title. */
export function teamIn(files: readonly TeamFile[], workspace: string): TeamFile | undefined {
  return files.find((entry) => key(entry.team.orchestrator.workspace) === key(workspace));
}

/** The file and every other team file for the same orchestrator workspace, such as an old `.agents/team.json` beside its new file. */
export function sameTeamFiles(files: readonly TeamFile[], file: string): TeamFile[] {
  const own = files.find((entry) => entry.file === file);
  return own ? files.filter((entry) => key(entry.team.orchestrator.workspace) === key(own.team.orchestrator.workspace)) : [];
}

/** The team's workspace. */
export function teamWorkspaces(team: Team): string[] {
  return [team.orchestrator.workspace];
}

/** The workspace of every team except the one that runs in `workspace`. */
export function workspacesOfOtherTeams(files: readonly TeamFile[], workspace: string): string[] {
  return files
    .filter((entry) => key(entry.team.orchestrator.workspace) !== key(workspace))
    .flatMap(teamFileWorkspaces);
}

/** The team's workspaces that another team already uses; teams never share a workspace. */
export function workspaceClashes(team: Team, taken: readonly string[]): TeamError[] {
  const used = new Set(taken.map(key));
  const message = (workspace: string) => `workspace "${workspace}" belongs to another team`;
  return [
    ...(used.has(key(team.orchestrator.workspace)) ? [{ target: "orchestrator", message: message(team.orchestrator.workspace) }] : []),
  ];
}

/** Where the team is written: the file it already lives in, else a new file in TEAMS_DIR named after its orchestrator's workspace. */
export function teamFileFor(team: Team, files: readonly TeamFile[], names: readonly string[]): string {
  const existing = teamIn(files, team.orchestrator.workspace);
  if (existing) return existing.file;
  const base = key(team.orchestrator.workspace).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "team";
  const taken = new Set(names.map((name) => name.toLowerCase()));
  let file = `${TEAMS_DIR}/${base}.json`;
  for (let index = 2; taken.has(file.toLowerCase()); index += 1) file = `${TEAMS_DIR}/${base}-${index}.json`;
  return file;
}
