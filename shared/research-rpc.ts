import { TeamSchema } from "./team";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { AgentProfileSchema, ResearchTeamSchema } from "./research-team";
const target = z.union([z.object({ workspaceId: z.string() }), z.object({ projectId: z.string() })]);
export const MemberStateSchema = z.object({
  id: z.string(), agentId: z.string().nullable(), status: z.string(), pending: z.boolean(), error: z.string().nullable(),
});
export const researchReadRpc = defineRpc({ name: "research.read", input: target, output: z.object({
  project: z.object({ id: z.string(), name: z.string(), root: z.string() }), workspace: z.string().nullable(),
  file: z.string().nullable(), team: ResearchTeamSchema.nullable(), legacy: z.boolean(), legacyTeam: TeamSchema.nullable(),
  profiles: z.array(AgentProfileSchema), bindings: z.record(z.string(), z.string()),
  identities: z.record(z.string(), z.string()), members: z.array(MemberStateSchema), errors: z.array(z.string()),
}) });
export const researchApplyRpc = defineRpc({ name: "research.apply", input: target.and(z.object({
  team: ResearchTeamSchema, migrateLegacy: z.boolean().default(false), bindings: z.record(z.string(), z.string()).default({}),
})), output: z.object({ workspaceId: z.string(), orchestratorAgentId: z.string(), file: z.string() }) });
export const researchResetRpc = defineRpc({ name: "research.reset", input: z.object({ workspaceId: z.string(), memberId: z.string() }), output: z.object({ agentId: z.string() }) });
