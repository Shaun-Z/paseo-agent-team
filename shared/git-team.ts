import { z } from "zod";
import { canonical, ResearchTeamSchema, type ResearchTeam } from "./research-team";

export const GitChangeSchema = z.object({
  id: z.string(), kind: z.enum(["team", "role", "member", "prompt"]), key: z.string(), field: z.array(z.string()),
  status: z.enum(["added", "changed", "removed"]), before: z.string().nullable(), after: z.string().nullable(),
});
export type GitChange = z.infer<typeof GitChangeSchema>;
const json = (value: unknown) => value === undefined ? null : JSON.stringify(value, null, 2);
export function gitChange(kind: GitChange["kind"], key: string, before: unknown, after: unknown, field: string[] = []): GitChange | null {
  if (canonical(before) === canonical(after)) return null;
  return { id: JSON.stringify([kind, key, ...field]), kind, key, field,
    status: before === undefined ? "added" : after === undefined ? "removed" : "changed", before: json(before), after: json(after) };
}

/** Config identities are stable; updates expose individual launch fields so local model choices can be retained. */
export function gitTeamChanges(before: ResearchTeam | null, incoming: ResearchTeam): GitChange[] {
  const changes: (GitChange | null)[] = [];
  for (const key of ["goal", "commonPromptFiles", "orchestratorMemberId"] as const) changes.push(gitChange("team", key, before?.[key], incoming[key]));
  for (const [kind, key] of [["role", "roles"], ["member", "members"]] as const) {
    for (const entry of incoming[key]) {
      const old = before?.[key].find(item => item.id === entry.id);
      if (!old) { changes.push(gitChange(kind, entry.id, undefined, entry)); continue; }
      if (kind === "role") {
        const a = old as ResearchTeam["roles"][number], b = entry as typeof a;
        for (const field of ["name", "promptFiles"] as const) changes.push(gitChange(kind, entry.id, a[field], b[field], [field]));
      } else {
        const a = old as ResearchTeam["members"][number], b = entry as typeof a;
        for (const field of ["name", "roleId"] as const) changes.push(gitChange(kind, entry.id, a[field], b[field], [field]));
        for (const field of ["provider", "model", "modeId", "thinkingOptionId", "featureValues"] as const) changes.push(gitChange(kind, entry.id, a.launchSnapshot[field], b.launchSnapshot[field], ["launchSnapshot", field]));
      }
    }
    for (const entry of before?.[key] ?? []) if (!incoming[key].some(item => item.id === entry.id)) changes.push(gitChange(kind, entry.id, entry, undefined));
  }
  return changes.filter((change): change is GitChange => change !== null);
}

/** Pure preview of the exact selection. Structural validation is shared with the import writer. */
export function mergeGitTeam(before: ResearchTeam | null, incoming: ResearchTeam, changes: readonly GitChange[], selected: readonly string[]): ResearchTeam {
  const result: ResearchTeam = JSON.parse(JSON.stringify(before ?? { ...incoming, goal: "", commonPromptFiles: [], orchestratorMemberId: "", roles: [], members: [] }));
  const ids = new Set(selected);
  for (const change of changes) {
    if (!ids.has(change.id) || change.kind === "prompt") continue;
    const value: unknown = change.after === null ? undefined : JSON.parse(change.after);
    if (change.kind === "team") {
      if (!["goal", "commonPromptFiles", "orchestratorMemberId"].includes(change.key)) throw new Error("Unknown team field");
      Object.assign(result, { [change.key]: value });
      continue;
    }
    const entries = result[change.kind === "role" ? "roles" : "members"];
    const index = entries.findIndex(entry => entry.id === change.key);
    if (!change.field.length) {
      if (index >= 0) entries.splice(index, 1);
      if (value !== undefined) entries.splice(index >= 0 ? index : entries.length, 0, value as never);
    } else {
      if (index < 0) throw new Error(`Missing ${change.kind}: ${change.key}`);
      let owner = entries[index] as unknown as Record<string, unknown>;
      for (const field of change.field.slice(0, -1)) owner = owner[field] as Record<string, unknown>;
      const field = change.field.at(-1)!;
      if (value === undefined) delete owner[field]; else owner[field] = value;
    }
  }
  return ResearchTeamSchema.parse(result);
}
