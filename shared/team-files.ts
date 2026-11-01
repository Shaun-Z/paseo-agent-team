import { isSharedRole, type Team } from "./team";
import type { TeamError } from "./validate";

/** Each workspace's team lives in its own file here, named after its orchestrator's workspace. */
export const TEAMS_DIR = ".agents/teams";

/** A team definition and the project-relative file it was read from. */
export interface TeamFile {
  file: string;
  team: Team;
}

const key = (title: string) => title.trim().toLowerCase();

/** The team whose orchestrator runs in the workspace with this title. */
export function teamIn(files: readonly TeamFile[], workspace: string): TeamFile | undefined {
  return files.find((entry) => key(entry.team.orchestrator.workspace) === key(workspace));
}

/** The file and every other team file for the same orchestrator workspace, such as an old `.agents/team.json` beside its new file. */
export function sameTeamFiles(files: readonly TeamFile[], file: string): TeamFile[] {
  const own = files.find((entry) => entry.file === file);
  return own ? files.filter((entry) => key(entry.team.orchestrator.workspace) === key(own.team.orchestrator.workspace)) : [];
}

/** The team (by its orchestrator's workspace) and role that use this workspace as the role's own. */
export function roleOwnerOf(files: readonly TeamFile[], workspace: string): { team: string; role: string } | undefined {
  for (const { team } of files) {
    const role = team.roles.find((candidate) => !isSharedRole(candidate) && key(candidate.workspace) === key(workspace));
    if (role) return { team: team.orchestrator.workspace, role: role.name };
  }
  return undefined;
}

/** The team's orchestrator and own role workspaces. */
export function teamWorkspaces(team: Team): string[] {
  return [team.orchestrator.workspace, ...team.roles.filter((role) => !isSharedRole(role)).map((role) => role.workspace)];
}

/** The orchestrator and own role workspaces of every team except the one that runs in `workspace`. */
export function workspacesOfOtherTeams(files: readonly TeamFile[], workspace: string): string[] {
  return files
    .filter((entry) => key(entry.team.orchestrator.workspace) !== key(workspace))
    .flatMap(({ team }) => teamWorkspaces(team));
}

/** The team's workspaces that another team already uses; teams never share a workspace. */
export function workspaceClashes(team: Team, taken: readonly string[]): TeamError[] {
  const used = new Set(taken.map(key));
  const message = (workspace: string) => `workspace "${workspace}" belongs to another team`;
  return [
    ...(used.has(key(team.orchestrator.workspace)) ? [{ target: "orchestrator", message: message(team.orchestrator.workspace) }] : []),
    ...team.roles.filter((role) => !isSharedRole(role) && used.has(key(role.workspace))).map((role) => ({ target: role.name, message: message(role.workspace) })),
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
