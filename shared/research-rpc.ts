import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { AgentProfileSchema, ResearchTeamSchema } from "./research-team";
import { SessionSettingsSchema } from "./member-settings";
import { GitChangeSchema } from "./git-team";
const target = z.union([z.object({ workspaceId: z.string() }), z.object({ projectId: z.string() })]);
export const researchGitFetchRpc = defineRpc({ name: "research.git.fetch", input: target.and(z.object({ repository: z.string().trim().min(1), ref: z.string().trim().default("HEAD") })), output: z.object({
  sourceId: z.string(), commit: z.string(), configFiles: z.array(z.string()),
}) });
export const researchGitCompareRpc = defineRpc({ name: "research.git.compare", input: target.and(z.object({ sourceId: z.string(), configFile: z.string(), workspaceName: z.string().trim().optional() })), output: z.object({
  planId: z.string(), commit: z.string(), configFile: z.string(), before: ResearchTeamSchema.nullable(), incoming: ResearchTeamSchema, changes: z.array(GitChangeSchema),
}) });
export const researchGitImportRpc = defineRpc({ name: "research.git.import", input: target.and(z.object({ planId: z.string(), selected: z.array(z.string()).min(1) })), output: z.object({ file: z.string(), team: ResearchTeamSchema, changedFiles: z.array(z.string()) }) });
export const researchPromptFilesRpc = defineRpc({ name: "research.prompt-files", input: target.and(z.object({ directory: z.string().default("") })), output: z.object({
  directory: z.string(), parent: z.string().nullable(), truncated: z.boolean(),
  entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(["file", "directory"]) })),
}) });
export const researchBrowseHostRpc = defineRpc({ name: "research.browse-host", input: z.object({ workspaceId: z.string(), directory: z.string().default("") }), output: z.object({
  directory: z.string(), parent: z.string().nullable(), projectRoot: z.string(), home: z.string(), truncated: z.boolean(),
  entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(["file", "directory"]) })),
}) });
export const MemberStateSchema = z.object({
  id: z.string(), agentId: z.string().nullable(), status: z.string(), pending: z.boolean(), error: z.string().nullable(),
  sessionSettings: SessionSettingsSchema.nullable(), settingsChanged: z.boolean(),
});
export const researchReadRpc = defineRpc({ name: "research.read", input: target, output: z.object({
  project: z.object({ id: z.string(), name: z.string(), root: z.string() }), workspace: z.string().nullable(),
  file: z.string().nullable(), team: ResearchTeamSchema.nullable(),
  profiles: z.array(AgentProfileSchema), bindings: z.record(z.string(), z.string()),
  identities: z.record(z.string(), z.string()), members: z.array(MemberStateSchema), errors: z.array(z.string()),
}) });
export const researchApplyRpc = defineRpc({ name: "research.apply", input: target.and(z.object({
  team: ResearchTeamSchema, bindings: z.record(z.string(), z.string()).default({}),
})), output: z.object({ workspaceId: z.string(), orchestratorAgentId: z.string(), file: z.string() }) });
export const researchResetRpc = defineRpc({ name: "research.reset", input: z.object({ workspaceId: z.string(), memberId: z.string() }), output: z.object({ agentId: z.string() }) });
export const researchLoadRpc = defineRpc({ name: "research.load", input: z.object({ workspaceId: z.string(), path: z.string().trim().min(1) }), output: z.object({ file: z.string() }) });
export const researchExportRpc = defineRpc({ name: "research.export", input: z.object({ workspaceId: z.string(), path: z.string().trim().min(1), overwrite: z.boolean().default(false) }), output: z.object({ file: z.string() }) });

export const teamProjectsRpc = defineRpc({ name: "team.projects", input: z.object({}), output: z.array(z.object({
  id: z.string(), name: z.string(), root: z.string(),
  workspaces: z.array(z.object({ id: z.string(), title: z.string() })),
  teams: z.array(z.object({ file: z.string(), goal: z.string(), orchestratorWorkspace: z.string(), workspaceId: z.string().nullable(), roles: z.number(), members: z.number() })),
  errors: z.array(z.string()),
})) });
export const teamDeleteRpc = defineRpc({ name: "team.delete", input: z.object({ projectId: z.string(), file: z.string() }), output: z.object({
  files: z.array(z.string()), archived: z.number(), failures: z.array(z.string()), fileFailures: z.array(z.string()),
}) });
export const teamReconnectRpc = defineRpc({ name: "team.reconnect", input: z.object({ projectId: z.string(), file: z.string(), workspaceId: z.string() }), output: z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(false), errors: z.array(z.string()) }), z.object({ ok: z.literal(true), files: z.array(z.string()) }),
]) });
export const teamRestoreRpc = defineRpc({ name: "team.restore", input: z.object({ projectId: z.string(), file: z.string() }), output: researchApplyRpc.output });
