import { uniqueName } from "./draft";
import type { Team } from "./team";

/** Applies a proposed draft while keeping the team's identity and making role names unique. */
export function applyTeamEdit(draft: Team, proposed: Team): Team {
  const taken: string[] = [];
  const roles = proposed.roles.map((role) => {
    const name = uniqueName(role.name, taken);
    taken.push(name);
    return { ...role, name };
  });
  return { ...proposed, version: draft.version, orchestrator: { ...proposed.orchestrator, workspace: draft.orchestrator.workspace }, roles };
}

/** Compares roles by trimmed, case-sensitive name; a rename is an addition and a removal. */
export function summarizeTeamEdit(draft: Team, edited: Team): {
  added: string[];
  removed: string[];
  changed: { name: string; fields: ("provider" | "model" | "folders" | "instructions")[] }[];
  orchestrator: boolean;
  goal: boolean;
} {
  const before = new Map(draft.roles.map((role) => [role.name.trim(), role]));
  const after = new Map(edited.roles.map((role) => [role.name.trim(), role]));
  const changed: ReturnType<typeof summarizeTeamEdit>["changed"] = [];
  for (const [name, role] of after) {
    const previous = before.get(name);
    if (!previous) continue;
    const fields: ReturnType<typeof summarizeTeamEdit>["changed"][number]["fields"] = [];
    for (const field of ["provider", "model", "folders", "instructions"] as const) {
      const different = field === "folders"
        ? new Set(previous.folders).size !== new Set(role.folders).size || previous.folders.some((folder) => !role.folders.includes(folder))
        : previous[field] !== role[field];
      if (different) fields.push(field);
    }
    if (fields.length) changed.push({ name, fields });
  }
  return {
    added: [...after.keys()].filter((name) => !before.has(name)),
    removed: [...before.keys()].filter((name) => !after.has(name)),
    changed,
    orchestrator: draft.orchestrator.provider !== edited.orchestrator.provider || draft.orchestrator.model !== edited.orchestrator.model,
    goal: draft.goal !== edited.goal,
  };
}
