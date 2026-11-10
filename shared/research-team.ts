import { z } from "zod";
import type { Team } from "./team";
import type { ProviderInfo } from "./validate";

const id = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "use letters, digits, underscores or hyphens");
const text = z.string().trim().min(1);
export const LaunchSchema = z.object({
  provider: text, model: text, modeId: text.optional(), thinkingOptionId: text.optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
});
export const AgentProfileSchema = z.object({
  id: z.string(), name: z.string(), provider: z.string(), model: z.string().optional(),
  modeId: z.string().optional(), thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(), notes: z.string().optional(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export const ResearchRoleSchema = z.object({ id, name: text, promptFiles: z.array(text).min(1) });
export const MemberSchema = z.object({ id, roleId: id, name: text.optional(), launchSnapshot: LaunchSchema });
export const ResearchTeamSchema = z.object({
  version: z.literal(2), id, goal: z.string().default(""), workspace: text,
  commonPromptFiles: z.array(text).default([]), orchestratorMemberId: id,
  roles: z.array(ResearchRoleSchema).min(1), members: z.array(MemberSchema).min(1),
}).superRefine((team, ctx) => {
  for (const field of ["roles", "members"] as const) {
    const seen = new Set<string>();
    team[field].forEach((entry, index) => {
      const key = entry.id.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: [field, index, "id"], message: "duplicate id" });
      seen.add(key);
    });
  }
  const roles = new Set(team.roles.map(role => role.id));
  team.members.forEach((member, index) => {
    if (!roles.has(member.roleId)) ctx.addIssue({ code: "custom", path: ["members", index, "roleId"], message: "unknown role" });
  });
  if (!team.members.some(member => member.id === team.orchestratorMemberId)) ctx.addIssue({ code: "custom", path: ["orchestratorMemberId"], message: "unknown member" });
});
export type ResearchTeam = z.infer<typeof ResearchTeamSchema>;
export type Member = ResearchTeam["members"][number];
export const TEAM_LABEL = "paseo-agent-team.team";
export const MEMBER_LABEL = "paseo-agent-team.member";
export const CONFIG_LABEL = "paseo-agent-team.config";
export const runtimeFile = (teamId: string) => `.agents/.runtime/paseo-agent-team/${teamId}.json`;

export function launchFromProfile(profile: AgentProfile) {
  return { provider: profile.provider, model: profile.model ?? "", ...(profile.modeId ? { modeId: profile.modeId } : {}),
    ...(profile.thinkingOptionId ? { thinkingOptionId: profile.thinkingOptionId } : {}),
    ...(profile.featureValues !== undefined ? { featureValues: profile.featureValues } : {}) };
}
/** Compatibility view for the existing project/workspace listing, never serialized as v2. */
export function legacyView(team: ResearchTeam): Team {
  const lead = team.members.find(member => member.id === team.orchestratorMemberId)!;
  return { version: 1, goal: team.goal, orchestrator: { workspace: team.workspace, provider: lead.launchSnapshot.provider, model: lead.launchSnapshot.model },
    roles: team.members.map(member => ({ name: member.id, ...member.launchSnapshot, folders: [], instructions: "" })) };
}
export function validateResearch(team: ResearchTeam, catalog: readonly ProviderInfo[]): string[] {
  return team.members.flatMap(member => {
    const provider = catalog.find(entry => entry.id === member.launchSnapshot.provider);
    if (!provider?.ready) return [`${member.id}: provider ${member.launchSnapshot.provider} is not ready`];
    return provider.models.some(model => model.id === member.launchSnapshot.model) ? [] : [`${member.id}: model ${member.launchSnapshot.model} is not available`];
  });
}
export function memberPrompt(team: ResearchTeam, member: Member, file: string, common: string, role: string): string {
  return [common, role, "## Paseo team coordination",
    `Team: ${team.id}. Your member ID: ${member.id}. Your role: ${member.roleId}.`,
    `Team definition: ${file}. Current member directory: ${runtimeFile(team.id)}. Paths are relative to the Project root.`,
    "Before contacting anyone, read the current directory and use the recipient member's agentId. Never infer identity from a role or an old agent ID.",
    "Use Paseo's native send_agent_prompt with notifyOnFinish: false for tasks, questions and replies. Send proactively; do not wait for automatic completion callbacks or poll continuously.",
    "Do not create additional agents, change another member's launch settings, or substitute a provider/model/mode. Only the user configures members.",
    `The coordinator member is ${team.orchestratorMemberId}.`,
    member.id === team.orchestratorMemberId
      ? "You are the Orchestrator. Talk with the user, guide the research, and wake the configured members you need by sending them tasks. Reuse their existing sessions. Read the latest team definition before delegating."
      : "Collaborate directly with other members. Before reporting to the coordinator, compose a concise report of key findings or blockers, supporting evidence/file references, implications and decisions needed. Send it yourself using send_agent_prompt. Do not forward raw logs or copy ordinary discussion to the coordinator.",
    "All members share files but have separate conversations. Coordinate overlapping edits. Read the relevant research state files when starting a task.",
    "The user can intervene in any member's conversation. Incorporate the user's latest direction; if it affects collaborators, compose and send an update to those concerned.",
  ].filter(Boolean).join("\n\n");
}
/** Stable comparison and hashing input, independent of object key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export type MessageEdge = { from: string; to: string; count: number; lastText: string };
/** Timeline pages are authoritative; source identity, not text, deduplicates repeated fetches. */
export function messageEdges(pages: readonly { recipient: string; entries: readonly unknown[] }[], agentToMember: ReadonlyMap<string, string>): MessageEdge[] {
  const edges = new Map<string, MessageEdge>();
  const seen = new Set<string>();
  for (const page of pages) for (const raw of page.entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { seq?: number; item?: { callId?: string; agentMessage?: { event?: string; sender?: { id?: string }; text?: string } } };
    const message = entry.item?.agentMessage;
    if (message?.event !== "message") continue;
    const from = agentToMember.get(message.sender?.id ?? "");
    const to = agentToMember.get(page.recipient);
    if (!from || !to || from === to) continue;
    const identity = entry.item?.callId ?? entry.seq;
    if (identity === undefined) continue;
    const key = `${page.recipient}:${identity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const edgeKey = JSON.stringify([from, to]);
    const edge = edges.get(edgeKey) ?? { from, to, count: 0, lastText: "" };
    edge.count++;
    edge.lastText = message.text ?? "";
    edges.set(edgeKey, edge);
  }
  return [...edges.values()];
}

/** Editable migration draft: the user still selects Profiles before applying. */
export function researchFromLegacy(team: Team): ResearchTeam {
  return { version: 2, id: "research-team", goal: team.goal, workspace: team.orchestrator.workspace,
    commonPromptFiles: ["prompts/research-team/common.md"], orchestratorMemberId: "anchor-main",
    roles: [{ id: "anchor", name: "Orchestrator", promptFiles: ["prompts/research-team/anchor.md"] }, ...team.roles.map((role, index) => ({ id: `role-${index + 1}`, name: role.name, promptFiles: [`prompts/research-team/role-${index + 1}.md`] }))],
    members: [{ id: "anchor-main", roleId: "anchor", launchSnapshot: { provider: "", model: "" } }, ...team.roles.map((_, index) => ({ id: `member-${index + 1}`, roleId: `role-${index + 1}`, launchSnapshot: { provider: "", model: "" } }))] };
}
