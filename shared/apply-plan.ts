import type { Team } from "./team";

/** The part of a Paseo workspace descriptor that matching needs. */
export interface WorkspaceRef {
  id: string;
  name: string;
  title?: string | null;
}

export interface WorkspaceStep {
  /** "orchestrator". */
  target: string;
  /** The workspace title from the team definition. */
  workspace: string;
  /** The workspace to reuse, or null to create one. */
  existingId: string | null;
}

/** What Paseo's sidebar shows for a workspace: its title when set, else its name. */
export function workspaceLabel(workspace: WorkspaceRef): string {
  return workspace.title?.trim() || workspace.name;
}

const key = (label: string) => label.trim().toLowerCase();

/** Matches the team's workspace by title, or marks it for creation. */
export function planWorkspaces(team: Team, existing: readonly WorkspaceRef[]): WorkspaceStep[] {
  const find = (title: string) => existing.find((workspace) => key(workspaceLabel(workspace)) === key(title))?.id ?? null;
  return [
    { target: "orchestrator", workspace: team.orchestrator.workspace, existingId: find(team.orchestrator.workspace) },
  ];
}

export interface AppliedWorkspace {
  target: string;
  workspace: string;
  id: string;
  created: boolean;
}

/** Creates missing workspaces and returns them in step order. */
export async function ensureWorkspaces(steps: readonly WorkspaceStep[], create: (title: string) => Promise<string>): Promise<AppliedWorkspace[]> {
  const ids: string[] = [];
  for (let at = steps.length - 1; at >= 0; at -= 1) ids[at] = steps[at]!.existingId ?? (await create(steps[at]!.workspace));
  return steps.map((step, at) => ({ target: step.target, workspace: step.workspace, id: ids[at]!, created: step.existingId === null }));
}

/** `base` when no workspace in `taken` has that title, else the first free `base-2`, `base-3`, … */
export function freeWorkspace(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map(key));
  if (!used.has(key(base))) return base;
  let index = 2;
  while (used.has(key(`${base}-${index}`))) index += 1;
  return `${base}-${index}`;
}

/** A new draft whose workspace is free unless the orchestrator is fixed. */
export function withFreeWorkspaces(team: Team, titles: readonly string[], { orchestrator }: { orchestrator: boolean }): Team {
  const workspace = orchestrator ? freeWorkspace(team.orchestrator.workspace, titles) : team.orchestrator.workspace;
  return { ...team, orchestrator: { ...team.orchestrator, workspace } };
}
