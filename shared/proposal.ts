import { checkTeam, type ParseResult, type Role, type Team } from "./team";
import type { ProviderInfo } from "./validate";

const text = { type: "string", minLength: 1 } as const;

/** The instructions planner's `outputSchema`: only the rewritten instructions. */
export const INSTRUCTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["instructions"],
  properties: { instructions: text },
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
    roles: { type: "array", minItems: 1, items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "provider", "model", "folders", "instructions"],
      properties: { name: text, provider: text, model: text, folders: { type: "array", items: text }, instructions: { type: "string" } },
    } },
  },
};

// outputSchema isn't enforced by every provider (Claude answered with its own key names),
// so the prompt shows the exact shape too.
const INSTRUCTIONS_EXAMPLE = { instructions: "<improved instructions>" };
const EXAMPLE = {
  version: 1,
  goal: "<the goal>",
  orchestrator: { workspace: "orchestrator", provider: "<provider id>", model: "<model id>" },
  roles: [{ name: "<role>", provider: "<provider id>", model: "<model id>", folders: ["<relative/path>"], instructions: "<what this role does>" }],
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

/** The team context used to keep a role's instructions within its ownership. */
export interface TeamOutline {
  orchestratorWorkspace: string;
  roles: { name: string; folders: string[] }[];
}

/** Asks a planner to revise the current draft, keeping its orchestrator workspace fixed. */
export function teamEditPrompt(request: string, draft: Team, catalog: readonly ProviderInfo[]): string {
  return [
    "Revise this project's entire agent team according to the user's request.",
    "",
    `User request: ${request.trim()}`,
    "Current draft:",
    JSON.stringify(draft, null, 2),
    "",
    "Providers and model ids available on this host (use these exact ids, nothing else):",
    ...modelLines(catalog),
    "",
    "Rules:",
    "- Look around the repository to ground the changes. Do not create, change or delete any file.",
    "- Treat the request as an edit of the existing team. When it names an existing role, or the work fits an existing role's folders or responsibility, change that role's instructions, folders, provider/model or name instead of adding a role.",
    '- For example, "add UI testing to tester" means update tester\'s instructions/folders; do not create a new role.',
    "- Add a new role only when the request explicitly asks for a new or separate role, or when no existing role can own the work.",
    "- Remove a role only when the request asks for it or its work is merged into another role by the request.",
    '- A request may affect several roles at once: for example, "every role must run the tests" means change all of them.',
    "- Keep roles the request does not affect exactly as they are. Change the orchestrator's provider/model and revise the goal when requested.",
    `- Keep the orchestrator workspace exactly ${JSON.stringify(draft.orchestrator.workspace)} and version ${draft.version}.`,
    "- Use only the listed provider/model ids and give each role a unique name.",
    "- Answer with the full team JSON only, using exactly these keys and no others:",
    JSON.stringify({ ...EXAMPLE, orchestrator: { ...EXAMPLE.orchestrator, workspace: draft.orchestrator.workspace } }, null, 2),
  ].join("\n");
}

/** Asks a planner to improve one role's instructions without requiring a valid team draft. */
export function instructionsPrompt(role: Pick<Role, "name" | "folders" | "instructions">, request: string, team: TeamOutline & { goal: string }): string {
  const roles = team.roles.filter((other) => other.name !== role.name).map((other) => `- ${other.name} (folders ${other.folders.length ? other.folders.join(", ") : "any"})`);
  return [
    "Rewrite this role's instructions for this project's agent team in Paseo.",
    "",
    `Role: ${role.name}`,
    `Folders: ${role.folders.length ? role.folders.join(", ") : "any"}`,
    `Current instructions: ${role.instructions}`,
    ...(request.trim() ? [`User request: ${request.trim()}`] : []),
    "",
    `Team goal: ${team.goal}`,
    `Orchestrator workspace: ${team.orchestratorWorkspace}`,
    "Other roles:",
    ...(roles.length ? roles : ["- (none)"]),
    "",
    "Rules:",
    "- Look around the repository, including CLAUDE.md and the role's folders, to ground the instructions in what is there. Do not create, change or delete any file.",
    "- Write a few concrete imperative sentences that the orchestrator can paste into a role agent's task.",
    "- Stay within the role's folders and do not take over other roles' work.",
    "- Follow the user's request when given.",
    "- Write in the same language as the current instructions; use English when they are empty.",
    "- Answer with JSON only, using exactly these keys and no others:",
    JSON.stringify(INSTRUCTIONS_EXAMPLE, null, 2),
  ].join("\n");
}

/** Reads the instructions planner's final message, tolerating a code fence or surrounding text. */
export function extractInstructions(message: string | null): { ok: true; instructions: string } | { ok: false; errors: string[] } {
  const json = jsonIn(message, "instructions");
  if (!json.ok) return json;
  const value = json.value;
  if (typeof value !== "object" || value === null || !("instructions" in value) || typeof value.instructions !== "string" || !value.instructions.trim()) {
    return { ok: false, errors: ["instructions: expected a non-empty string"] };
  }
  return { ok: true, instructions: value.instructions.trim() };
}
