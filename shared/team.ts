import { z } from "zod";

// The team definition lives in the project repository, not in plugin settings
// (ADR 261029-093300), so it is shared through git and readable by agents.
export const TEAM_FILE = ".agents/team.json";

const name = z.string().trim().min(1);

export const OrchestratorSchema = z.object({
  /** Workspace title, matched by name so the file works on any machine. */
  workspace: name,
  provider: name,
  model: name,
});

export const RoleSchema = z.object({
  name,
  provider: name,
  model: name,
  folders: z.array(z.string().trim().min(1)).default([]),
  instructions: z.string().default(""),
});

export const TeamSchema = z
  .object({
    version: z.literal(1),
    goal: z.string().default(""),
    orchestrator: OrchestratorSchema,
    roles: z.array(RoleSchema).min(1),
  })
  .superRefine((team, ctx) => {
    const roleNames = new Set<string>();
    team.roles.forEach((role, index) => {
      const key = role.name.toLowerCase();
      if (roleNames.has(key)) ctx.addIssue({ code: "custom", path: ["roles", index, "name"], message: `duplicate role name "${role.name}"` });
      roleNames.add(key);
    });

  });

export type Team = z.output<typeof TeamSchema>;
export type Role = z.output<typeof RoleSchema>;

export type ParseResult = { ok: true; team: Team } | { ok: false; errors: string[] };

export function checkTeam(value: unknown): ParseResult {
  const result = TeamSchema.safeParse(value);
  if (result.success) return { ok: true, team: result.data };
  return { ok: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "team"}: ${issue.message}`) };
}

export function parseTeam(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`team file is not valid JSON: ${(error as Error).message}`] };
  }
  return checkTeam(value);
}

export function serializeTeam(team: Team): string {
  return JSON.stringify(team, null, 2) + "\n";
}
