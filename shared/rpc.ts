import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { RoleSchema, TeamSchema } from "./team";

const ProviderInfoSchema = z.object({
  id: z.string(),
  ready: z.boolean(),
  status: z.string(),
  models: z.array(z.object({ id: z.string(), label: z.string() })),
});

const TeamErrorSchema = z.object({ target: z.string(), message: z.string() });

const ProjectSchema = z.object({ id: z.string(), name: z.string(), root: z.string() });

/** A workspace of the project, or the project itself when no workspace is open. */
const TargetSchema = z.union([z.object({ workspaceId: z.string() }), z.object({ projectId: z.string() })]);

/** Every project on this host with its teams, orchestrator workspaces and team-file parse errors. */
export const teamProjectsRpc = defineRpc({
  name: "team.projects",
  input: z.object({}),
  output: z.array(ProjectSchema.extend({
    workspaces: z.array(z.object({ id: z.string(), title: z.string() })),
    teams: z.array(z.object({
      file: z.string(),
      goal: z.string(),
      orchestratorWorkspace: z.string(),
      workspaceId: z.string().nullable(),
      roles: z.number(),
    })),
    errors: z.array(z.string()),
  })),
});

/**
 * Archives the team's agents in workspaces no other team uses, then deletes its files (including an old `.agents/team.json`).
 * Agent failures prevent file deletion; file failures are reported separately.
 */
export const teamDeleteRpc = defineRpc({
  name: "team.delete",
  input: z.object({ projectId: z.string(), file: z.string() }),
  output: z.object({ files: z.array(z.string()), archived: z.number(), failures: z.array(z.string()), fileFailures: z.array(z.string()) }),
});

/** Reconnects a team's files to an existing workspace by its current title, without changing agents. */
export const teamReconnectRpc = defineRpc({
  name: "team.reconnect",
  input: z.object({ projectId: z.string(), file: z.string(), workspaceId: z.string() }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(false), errors: z.array(z.string()) }),
    z.object({ ok: z.literal(true), files: z.array(z.string()) }),
  ]),
});

/** For the agent dashboard: the teams of a workspace's project, with their team workspace resolved to an id. */
export const teamRosterRpc = defineRpc({
  name: "team.roster",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({
    teams: z.array(z.object({
      /** Null when the orchestrator's workspace doesn't exist. */
      orchestratorWorkspaceId: z.string().nullable(),
      /** Every role uses the orchestrator workspace id. */
      roles: z.array(z.object({ name: z.string(), provider: z.string(), model: z.string(), workspaceId: z.string().nullable() })),
    })),
    /** Problems reading or parsing the project's team files. */
    errors: z.array(z.string()),
  }),
});

/** The project (or a workspace's project), the team that runs in the workspace (if any) and what this host can run. */
export const teamReadRpc = defineRpc({
  name: "team.read",
  input: TargetSchema,
  output: z.object({
    project: ProjectSchema,
    /** The target workspace's title, or null when the target is the project. */
    workspace: z.string().nullable(),
    /** The project-relative file of the team that runs in the workspace, or null when it has none. */
    file: z.string().nullable(),
    team: TeamSchema.nullable(),
    /** Workspace titles the project's other teams use; a team can't use them too. */
    takenWorkspaces: z.array(z.string()),
    /** Titles of the project's workspaces; a new draft gets workspace names that aren't among them. */
    projectWorkspaces: z.array(z.string()),
    /** Problems reading or parsing the project's team files. */
    errors: z.array(z.string()),
    /** Providers or models in the team file this host can't run. */
    validation: z.array(TeamErrorSchema),
    catalog: z.array(ProviderInfoSchema),
  }),
});

/** Starts a planner agent that proposes a team for the goal. */
export const teamProposeRpc = defineRpc({
  name: "team.propose",
  input: TargetSchema.and(z.object({ goal: z.string().trim().min(1) })),
  output: z.object({ agentId: z.string() }),
});

/** The planner's proposal once it has finished. */
export const teamProposalRpc = defineRpc({
  name: "team.proposal",
  input: z.object({ agentId: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("running") }),
    z.object({ status: z.literal("done"), team: TeamSchema, validation: z.array(TeamErrorSchema) }),
    z.object({ status: z.literal("failed"), errors: z.array(z.string()) }),
  ]),
});

/** The newest team planner still proposing for the target, so a reopened screen picks its proposal back up. */
export const teamPendingProposalRpc = defineRpc({
  name: "team.proposal.pending",
  input: TargetSchema,
  output: z.object({ agentId: z.string().nullable() }),
});

/** Archives the target's team planners, so a cancelled proposal does not come back. */
export const teamProposalCancelRpc = defineRpc({
  name: "team.proposal.cancel",
  input: TargetSchema,
  output: z.object({}),
});

const TeamOutlineSchema = z.object({
  orchestratorWorkspace: z.string(),
  roles: z.array(z.object({ name: z.string(), folders: z.array(z.string()) })),
});

/** Starts a planner agent that proposes one more role for the team being edited. */
export const teamRoleProposeRpc = defineRpc({
  name: "team.role.propose",
  input: TargetSchema.and(z.object({ description: z.string().trim().min(1), team: TeamOutlineSchema })),
  output: z.object({ agentId: z.string() }),
});

/** The role planner's proposal once it has finished. */
export const teamRoleProposalRpc = defineRpc({
  name: "team.role.proposal",
  input: z.object({ agentId: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("running") }),
    z.object({ status: z.literal("done"), role: RoleSchema }),
    z.object({ status: z.literal("failed"), errors: z.array(z.string()) }),
  ]),
});

/** Starts a planner that improves instructions for a role in the current draft. */
export const teamInstructionsImproveRpc = defineRpc({
  name: "team.instructions.improve",
  input: TargetSchema.and(z.object({
    role: z.object({ name: z.string(), folders: z.array(z.string()), instructions: z.string() }),
    request: z.string(),
    team: TeamOutlineSchema.extend({ goal: z.string() }),
  })),
  output: z.object({ agentId: z.string() }),
});

/** The instructions planner's proposal once it has finished. */
export const teamInstructionsProposalRpc = defineRpc({
  name: "team.instructions.proposal",
  input: z.object({ agentId: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("running") }),
    z.object({ status: z.literal("done"), instructions: z.string() }),
    z.object({ status: z.literal("failed"), errors: z.array(z.string()) }),
  ]),
});

const AppliedWorkspaceSchema = z.object({ target: z.string(), workspace: z.string(), id: z.string(), created: z.boolean() });

/** Writes the team file, creates missing workspaces, starts the orchestrator and archives the planners. */
export const teamApplyRpc = defineRpc({
  name: "team.apply",
  input: TargetSchema.and(z.object({ team: z.unknown() })),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(false), errors: z.array(z.string()) }),
    z.object({
      ok: z.literal(true),
      file: z.string(),
      workspaces: z.array(AppliedWorkspaceSchema),
      orchestratorAgentId: z.string(),
      /** Planners or planner workspaces that could not be archived; the team itself was applied. */
      cleanup: z.array(z.string()),
      /** The Claude settings file the orchestrator's `paseo run` allow rule was added to, or null when none was added. */
      permission: z.string().nullable(),
    }),
  ]),
});

/** Archives the workspace's orchestrators and starts a new one from the team file on disk; role sessions are kept. */
export const teamRestartOrchestratorRpc = defineRpc({
  name: "team.restart-orchestrator",
  input: TargetSchema,
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(false), errors: z.array(z.string()) }),
    z.object({ ok: z.literal(true), orchestratorAgentId: z.string(), archived: z.array(z.string()) }),
  ]),
});
