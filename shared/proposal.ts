import { checkTeam, RoleSchema, type ParseResult, type Role } from "./team";
import type { ProviderInfo } from "./validate";

const text = { type: "string", minLength: 1 } as const;

/** The role planner's `outputSchema`: one role, every field present. */
export const ROLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "provider", "model", "folders", "instructions"],
  properties: { name: text, provider: text, model: text, folders: { type: "array", items: text }, instructions: { type: "string" } },
};

/** The planner agent's `outputSchema`: a complete team file, every field present. */
export const TEAM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "goal", "orchestrator", "roles"],
  properties: {
    version: { type: "integer", const: 1 },
    goal: { type: "string" },
    orchestrator: {
      type: "object",
      additionalProperties: false,
      required: ["workspace", "provider", "model"],
      properties: { workspace: text, provider: text, model: text },
    },
    roles: { type: "array", minItems: 1, items: ROLE_JSON_SCHEMA },
  },
};

// outputSchema isn't enforced by every provider (Claude answered with its own key names),
// so the prompt shows the exact shape too.
const ROLE_EXAMPLE = { name: "<role>", provider: "<provider id>", model: "<model id>", folders: ["<relative/path>"], instructions: "<what this role does>" };
const EXAMPLE = {
  version: 1,
  goal: "<the goal>",
  orchestrator: { workspace: "orchestrator", provider: "<provider id>", model: "<model id>" },
  roles: [ROLE_EXAMPLE],
};

function modelLines(catalog: readonly ProviderInfo[]): string[] {
  return catalog.filter((provider) => provider.ready).map((provider) => `- ${provider.id}: ${provider.models.map((model) => model.id).join(", ")}`);
}

/** The JSON object in a planner's final message, tolerating a code fence or text around it. */
function jsonIn(message: string | null, what: string): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  if (!message?.trim()) return { ok: false, errors: ["the planner finished without an answer"] };
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, errors: [`the planner's answer has no JSON ${what}`] };
  try {
    return { ok: true, value: JSON.parse(message.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, errors: [`the planner's answer is not valid JSON: ${(error as Error).message}`] };
  }
}

/** Asks a planner agent to propose a team for the goal, using only models this host can run. */
export function plannerPrompt(goal: string, catalog: readonly ProviderInfo[]): string {
  return [
    "Propose an agent team for this project. Each role runs in the orchestrator's workspace on its own provider and model; an orchestrator hands work to them.",
    "",
    `Goal: ${goal.trim()}`,
    "",
    "Providers and model ids available on this host (use these exact ids, nothing else):",
    ...modelLines(catalog),
    "",
    "Rules:",
    "- Look around the repository to fit roles and folders to what is there. Do not create, change or delete any file.",
    "- Pick 2 to 6 roles that do clearly separate work. Prefer different providers where they suit the work better (for example one provider for visual design, another for audio).",
    "- Give each role a short lowercase name, the folders it owns (relative paths, may be empty), and one or two sentences of instructions.",
    '- The orchestrator gets the workspace "orchestrator" and a strong reasoning model.',
    "- Set version to 1 and goal to the goal above.",
    "- Answer with JSON only, using exactly these keys and no others:",
    JSON.stringify(EXAMPLE, null, 2),
  ].join("\n");
}

/** Reads the planner's final message as a team, tolerating a code fence or text around the JSON. */
export function extractProposal(message: string | null): ParseResult {
  const json = jsonIn(message, "team");
  if (!json.ok) return json;
  return checkTeam(json.value);
}

/** What the role planner needs to know about the team being edited, so the new role doesn't overlap it. */
export interface TeamOutline {
  orchestratorWorkspace: string;
  roles: { name: string; folders: string[] }[];
}

/** Asks a planner agent for one more role matching the description, using only models this host can run. */
export function rolePrompt(description: string, team: TeamOutline, catalog: readonly ProviderInfo[]): string {
  const roles = team.roles.map((role) => `- ${role.name} (folders ${role.folders.length ? role.folders.join(", ") : "any"})`);
  return [
    "Propose one more role for this project's agent team in Paseo. The role runs in the orchestrator's workspace on its own provider and model; an orchestrator hands work to it.",
    "",
    `The role: ${description.trim()}`,
    "",
    `The team already has these roles, and the orchestrator uses the workspace "${team.orchestratorWorkspace}":`,
    ...(roles.length ? roles : ["- (none yet)"]),
    "",
    "Providers and model ids available on this host (use these exact ids, nothing else):",
    ...modelLines(catalog),
    "",
    "Rules:",
    "- Look around the repository to fit the role's folders to what is there. Do not create, change or delete any file.",
    "- Use a short lowercase name different from the existing roles.",
    "- Give it the folders it owns (relative paths, may be empty), avoiding folders other roles own, and one or two sentences of instructions.",
    "- Pick the provider and model that suit this work best.",
    "- Answer with JSON only, using exactly these keys and no others:",
    JSON.stringify(ROLE_EXAMPLE, null, 2),
  ].join("\n");
}

/** Reads the role planner's final message as one role, tolerating a code fence or text around the JSON. */
export function extractRole(message: string | null): { ok: true; role: Role } | { ok: false; errors: string[] } {
  const json = jsonIn(message, "role");
  if (!json.ok) return json;
  const result = RoleSchema.safeParse(json.value);
  if (result.success) return { ok: true, role: result.data };
  return { ok: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "role"}: ${issue.message}`) };
}
