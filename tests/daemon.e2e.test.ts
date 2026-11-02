// Runs the server handlers against a live local Paseo daemon. It starts real agents
// (a planner and an orchestrator), so it only runs with PASEO_E2E=1:
//   PASEO_E2E=1 npx vitest run tests/daemon.e2e.test.ts
import { createPaseoClient, type PaseoClient } from "@getpaseo/client";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTeam, cancelProposal, deleteTeam, pendingProposal, projectTeamsList, proposeRole, proposeTeam, readTeam, roleProposal, teamProposal } from "../server/team";
import { workspaceLabel } from "../shared/apply-plan";
import { CLAUDE_LOCAL_SETTINGS, needsRunPermission, PASEO_RUN_RULE } from "../shared/permissions";
import { TeamSchema, type Team } from "../shared/team";
import { agentModeOf, validateTeam } from "../shared/validate";

describe.skipIf(!process.env.PASEO_E2E)("server handlers against the local daemon", () => {
  let paseo: PaseoClient;
  let root: string;
  let workspaceId: string;
  let projectId: string;
  let proposed: Team;

  beforeAll(async () => {
    paseo = createPaseoClient({ url: process.env.PASEO_URL ?? "ws://127.0.0.1:6767/ws", reconnect: { enabled: false } });
    await paseo.connect();
    root = mkdtempSync(join(tmpdir(), "pwa-game-"));
    execFileSync("git", ["init", "-q", root]);
    workspaceId = (await paseo.workspaces.create({ title: "main", source: { kind: "directory", path: root } })).id;
    projectId = (await paseo.workspaces.ref(workspaceId).refresh())!.projectId;
  }, 60_000);

  // Archives every agent the tests left in the temp project (planners, orchestrators and the role agents they started).
  afterAll(async () => {
    if (!paseo) return;
    try {
      if (projectId) {
        const workspaceIds = new Set((await paseo.workspaces.list()).entries.filter((entry) => entry.projectId === projectId).map((entry) => entry.id));
        const { entries } = await paseo.agents.list({ filter: { includeArchived: true } });
        for (const { agent } of entries) {
          if (!workspaceIds.has(agent.workspaceId ?? "") || agent.archivedAt) continue;
          // The client's archive() has no force option, so a running agent that refuses is logged and left.
          await paseo.agents.ref(agent.id).archive().catch((error: unknown) => console.warn(`e2e cleanup: could not archive agent ${agent.id}: ${String(error)}`));
        }
      }
    } catch (error) {
      console.warn(`e2e cleanup failed: ${String(error)}`);
    } finally {
      await paseo.close();
    }
  }, 60_000);

  it("reads a project without a team file", async () => {
    const result = await readTeam({ workspaceId }, { paseo });
    expect(result.team).toBeNull();
    expect(result.project.root).toBe(root);
    expect(result.catalog.some((provider) => provider.ready)).toBe(true);
  });

  it("reads the same project by its id and lists it with no teams", async () => {
    const result = await readTeam({ projectId }, { paseo });
    expect(result.team).toBeNull();
    expect(result.project).toEqual({ id: projectId, name: expect.any(String), root });
    expect((await projectTeamsList({}, { paseo })).find((project) => project.id === projectId)?.teams).toEqual([]);
  });

  it("starts the planner in an existing workspace of the project when given only the project", async () => {
    const { agentId } = await proposeTeam({ projectId, goal: "A tiny CLI tool" }, { paseo });
    const planner = paseo.agents.ref(agentId);
    expect((await planner.refresh())?.agent.workspaceId).toBe(workspaceId);
    await planner.archive();
  });

  it("gets a valid proposal from the planner", async () => {
    const { agentId } = await proposeTeam({ workspaceId, goal: "A small 2D platformer game: one role for visual design on codex, one for sound on antigravity" }, { paseo });
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const result = await teamProposal({ agentId }, { paseo });
      if (result.status === "failed") throw new Error(result.errors.join("\n"));
      if (result.status === "done") {
        expect(result.validation).toEqual([]);
        proposed = TeamSchema.parse(result.team);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("the planner did not finish in 5 minutes");
  }, 330_000);

  it("proposes one role from a description", async () => {
    const team = { orchestratorWorkspace: proposed.orchestrator.workspace, roles: proposed.roles.map(({ name, folders }) => ({ name, folders })) };
    const { agentId } = await proposeRole({ workspaceId, description: "Writes and runs end-to-end tests for the game", team }, { paseo });
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const result = await roleProposal({ agentId }, { paseo });
      if (result.status === "failed") throw new Error(result.errors.join("\n"));
      if (result.status === "done") {
        const extended = TeamSchema.parse({ ...proposed, roles: [...proposed.roles, result.role] });
        expect(validateTeam(extended, (await readTeam({ workspaceId }, { paseo })).catalog)).toEqual([]);
        proposed = extended;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("the role planner did not finish in 5 minutes");
  }, 330_000);

  it("restores the pending team proposal and archives it on cancel", async () => {
    // The planner from "gets a valid proposal" is still the workspace's pending proposal.
    const earlier = (await pendingProposal({ workspaceId }, { paseo })).agentId;
    expect(earlier).not.toBeNull();
    // A new proposal replaces it.
    const { agentId } = await proposeTeam({ workspaceId, goal: "A tiny CLI tool" }, { paseo });
    expect((await pendingProposal({ workspaceId }, { paseo })).agentId).toBe(agentId);
    expect((await paseo.agents.ref(earlier!).refresh())?.agent.archivedAt).toBeTruthy();
    // Cancelling leaves nothing to restore.
    await cancelProposal({ workspaceId }, { paseo });
    expect((await pendingProposal({ workspaceId }, { paseo })).agentId).toBeNull();
    expect((await paseo.agents.ref(agentId).refresh())?.agent.archivedAt).toBeTruthy();
  }, 60_000);

  it("applies the team: file, workspaces and orchestrator", async () => {
    // A planner workspace with nothing left in it, as the sidebar screen leaves behind for a project without workspaces.
    const plannerWorkspace = (await paseo.workspaces.create({ title: "Team planner", source: { kind: "directory", path: root, projectId } })).id;
    const result = await applyTeam({ workspaceId, team: proposed }, { paseo });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.cleanup).toEqual([]);
    // A new team gets its own file, named after its orchestrator's workspace.
    expect(result.file.startsWith(join(root, ".agents/teams/"))).toBe(true);
    expect(JSON.parse(readFileSync(result.file, "utf8")).roles.length).toBe(proposed.roles.length);
    // Every role runs in the orchestrator's workspace, so it is the only one planned.
    expect(result.workspaces.map((workspace) => workspace.target)).toEqual(["orchestrator"]);

    const { entries } = await paseo.workspaces.list();
    for (const workspace of result.workspaces) {
      expect(entries.find((entry) => entry.id === workspace.id)?.projectRootPath).toBe(root);
    }
    const orchestrator = await paseo.agents.ref(result.orchestratorAgentId).refresh();
    expect(orchestrator?.agent.workspaceId).toBe(result.workspaces[0]!.id);
    expect(orchestrator?.agent.provider).toBe(proposed.orchestrator.provider);
    const orchestratorMode = agentModeOf((await paseo.providers.snapshot()).entries, proposed.orchestrator.provider);
    if (proposed.orchestrator.provider === "claude") expect(orchestratorMode).toBeDefined();
    if (orchestratorMode) expect(orchestrator?.agent.currentModeId).toBe(orchestratorMode);

    // Planners are archived, and so is the emptied Team planner workspace; the team's workspaces stay.
    const projectWorkspaces = (await paseo.workspaces.list()).entries.filter((entry) => entry.projectId === projectId && !entry.archivingAt).map((entry) => entry.id);
    expect(projectWorkspaces).not.toContain(plannerWorkspace);
    expect(projectWorkspaces).toEqual(expect.arrayContaining([workspaceId, ...result.workspaces.map((workspace) => workspace.id)]));
    const planners = (await paseo.agents.list()).entries.map((entry) => entry.agent).filter((agent) => agent.labels["workspace-agents"] === "planner" && !agent.archivedAt && projectWorkspaces.includes(agent.workspaceId ?? ""));
    expect(planners).toEqual([]);

    // Applying again by project id reuses everything and the project lists the team.
    const again = await applyTeam({ projectId, team: proposed }, { paseo });
    expect(again.ok && again.workspaces.every((workspace) => !workspace.created)).toBe(true);
    expect(again.ok && again.orchestratorAgentId).toBe(result.orchestratorAgentId);
    expect(again.ok && again.file).toBe(result.file);

    // A Claude orchestrator with a role in an unattended mode gets the paseo run allow rule, once.
    if (needsRunPermission(proposed, (await paseo.providers.snapshot()).entries)) {
      expect(result.permission).toBe(join(root, CLAUDE_LOCAL_SETTINGS));
      expect(JSON.parse(readFileSync(join(root, CLAUDE_LOCAL_SETTINGS), "utf8")).permissions.allow).toEqual([PASEO_RUN_RULE]);
    } else {
      expect(result.permission).toBeNull();
    }
    expect(again.ok && again.permission).toBeNull();
    expect((await projectTeamsList({}, { paseo })).find((project) => project.id === projectId)?.teams.map((team) => team.file)).toEqual([result.file]);
  }, 120_000);

  it("applies a team with several roles using only the orchestrator's workspace", async () => {
    const template = proposed.roles[0]!;
    const team: Team = { ...proposed, roles: [...proposed.roles, { ...template, name: "shared-qa", folders: [], instructions: "" }] };
    const result = await applyTeam({ projectId, team }, { paseo });
    if (!result.ok) throw new Error(result.errors.join("\n"));

    expect(result.workspaces.map((workspace) => workspace.target)).toEqual(["orchestrator"]);
    const titles = (await paseo.workspaces.list()).entries.filter((entry) => entry.projectId === projectId && !entry.archivingAt).map((entry) => workspaceLabel(entry).trim().toLowerCase());
    expect(titles).toContain(team.orchestrator.workspace.toLowerCase());
    expect(titles).not.toContain("shared-qa");
  }, 120_000);

  it("runs a second team in another workspace, from its own file", async () => {
    const projectWorkspaces = async () => (await paseo.workspaces.list()).entries.filter((entry) => entry.projectId === projectId && !entry.archivingAt);
    const lead = (await projectWorkspaces()).find((entry) => workspaceLabel(entry).trim().toLowerCase() === proposed.orchestrator.workspace.trim().toLowerCase())!;
    const first = await readTeam({ workspaceId: lead.id }, { paseo });
    expect(first.team?.orchestrator.workspace).toBe(proposed.orchestrator.workspace);

    const title = `side-${Date.now()}`;
    const side = (await paseo.workspaces.create({ title, source: { kind: "directory", path: root, projectId } })).id;
    const before = await readTeam({ workspaceId: side }, { paseo });
    expect(before.team).toBeNull();
    expect(before.workspace).toBe(title);
    expect(before.takenWorkspaces.map((workspace) => workspace.toLowerCase())).toContain(proposed.orchestrator.workspace.toLowerCase());

    // A team whose orchestrator takes the first team's workspace is refused before anything is written.
    const template = proposed.roles[0]!;
    const clashing: Team = { ...proposed, orchestrator: { ...proposed.orchestrator, workspace: proposed.orchestrator.workspace }, roles: [{ ...template, name: "steal" }] };
    const refused = await applyTeam({ workspaceId: side, team: clashing }, { paseo });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.errors.join("\n")).toContain("belongs to another team");

    const workspacesBefore = (await projectWorkspaces()).length;
    const second: Team = { ...proposed, goal: "Second team", orchestrator: { ...proposed.orchestrator, workspace: title }, roles: [template] };
    const applied = await applyTeam({ workspaceId: side, team: second }, { paseo });
    if (!applied.ok) throw new Error(applied.errors.join("\n"));
    expect(applied.file).toBe(join(root, ".agents/teams", `${title}.json`));
    expect(applied.workspaces).toEqual([{ target: "orchestrator", workspace: title, id: side, created: false }]);
    expect((await projectWorkspaces()).length).toBe(workspacesBefore);
    const orchestrator = (await paseo.agents.ref(applied.orchestratorAgentId).refresh())!.agent;
    expect(orchestrator.workspaceId).toBe(side);
    expect(orchestrator.labels["workspace-agents"]).toBe("orchestrator");

    // Each workspace reads its own team; the first one is untouched.
    expect((await readTeam({ workspaceId: side }, { paseo })).team?.goal).toBe("Second team");
    expect((await readTeam({ workspaceId: lead.id }, { paseo })).team).toEqual(first.team);

    // An old single-team file for the same orchestrator workspace goes with it.
    writeFileSync(join(root, ".agents/team.json"), JSON.stringify(second));
    // Deleting the second team removes both files, archives its orchestrator but leaves its workspaces; the first team stays.
    const removed = await deleteTeam({ projectId, file: `.agents/teams/${title}.json` }, { paseo });
    expect(removed.failures).toEqual([]);
    expect(removed.files.sort()).toEqual([".agents/team.json", `.agents/teams/${title}.json`].sort());
    expect(removed.archived).toBeGreaterThanOrEqual(1);
    expect(removed.fileFailures).toEqual([]);
    expect(existsSync(join(root, ".agents/teams", `${title}.json`))).toBe(false);
    expect(existsSync(join(root, ".agents/team.json"))).toBe(false);
    expect((await paseo.agents.ref(applied.orchestratorAgentId).refresh())?.agent.archivedAt).toBeTruthy();
    expect((await projectWorkspaces()).some((entry) => entry.id === side)).toBe(true);
    expect((await projectWorkspaces()).some((entry) => entry.id === lead.id)).toBe(true);
    expect((await readTeam({ workspaceId: lead.id }, { paseo })).team).toEqual(first.team);
    await expect(deleteTeam({ projectId, file: "../outside.json" }, { paseo })).rejects.toThrow("is not a team file");
  }, 180_000);
});
