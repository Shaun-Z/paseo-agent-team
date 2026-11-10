import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResearch, readPrompt, readResearch, resetResearchMember } from "../server/research-team";
import { projectTeams, projectTeamsList, reconnectTeam, restoreTeam, deleteTeam } from "../server/team-directory";
import { buildAgentForest, filterForest } from "../shared/agent-tree";
import { allPages } from "../server/pagination";
import { CONFIG_LABEL, MEMBER_LABEL, runtimeFile, TEAM_LABEL } from "../shared/research-team";
import { teamFixture } from "./fixtures/research";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "research-team-")); roots.push(root);
  await mkdir(join(root, "prompts"));
  for (const name of ["common", "anchor", "programmer"]) await writeFile(join(root, `prompts/${name}.md`), `${name} standing instructions`);
  const project = { projectId: "prj", projectRootPath: root, projectDisplayName: "Research" };
  const workspace = { ...project, id: "wks", name: "research", title: "research", workspaceDirectory: root, archivingAt: null };
  type Agent = { id: string; workspaceId: string; labels: Record<string,string>; provider: string; model: string; status: string; archivedAt: string | null; requiresAttention: boolean };
  const agents: Agent[] = [];
  const configs: Record<string, unknown>[] = [];
  const archive = vi.fn(async (id: string) => { agents.find(a => a.id === id)!.archivedAt = "now"; return { archivedAt: "now" }; });
  let failMember = "";
  const create = vi.fn(async (options: { config: Record<string, unknown>; labels: Record<string,string>; prompt?: string }) => {
    if (options.labels[MEMBER_LABEL] === failMember) throw new Error("simulated provider failure");
    configs.push(options.config);
    const id = `agent-${agents.length + 1}`;
    agents.push({ id, workspaceId: "wks", labels: options.labels, provider: String(options.config.provider), model: "m", status: "idle", archivedAt: null, requiresAttention: false });
    return { id };
  });
  const profiles = [{ id: "profile", name: "Configured", provider: "test", model: "m", modeId: "ask", featureValues: { flag: false } }];
  const api = {
    projects: { list: async () => ({ projects: [project] }) },
    providers: { snapshot: async () => ({ entries: ["test", "other"].map(provider => ({ provider, enabled: true, status: "ready", models: [{ id: "m", label: "M" }], modes: [{ id: "auto" }] })) }) },
    config: { get: async () => ({ config: { agentProfiles: profiles } }) },
    workspaces: { list: async () => ({ entries: [workspace] }), ref: () => ({ refresh: async () => workspace, agents: { create } }) },
    agents: { list: async () => ({ entries: agents.map(agent => ({ agent })) }), ref: (id: string) => ({ archive: () => archive(id) }) },
  };
  const ctx = { paseo: api as unknown as PluginHandlerContext["paseo"] };
  return { root, ctx, workspace, agents, configs, create, archive, fail: (member: string) => { failMember = member; } };
}
describe("research sessions", () => {
  it("keeps research members visible in All agents without legacy waiting duplicates", async () => {
    const f = await fixture();
    await applyResearch({ workspaceId: "wks", team: teamFixture(), bindings: {} }, f.ctx);
    await writeFile(join(f.root, ".agents/teams/legacy.json"), JSON.stringify({ version: 1, goal: "Legacy team", orchestrator: { workspace: "legacy", provider: "test", model: "m" }, roles: [{ name: "legacy-coder", provider: "test", model: "m", folders: [], instructions: "Implement" }] }));
    const [project] = await projectTeamsList({}, f.ctx);
    expect(project!.errors).toEqual([]);
    expect(project!.teams).toHaveLength(1);
    expect(project!.teams[0]).toMatchObject({ roles: 2, members: 3 });
    const agents = f.agents.map((agent, index) => ({ ...agent, createdAt: `2026-11-10T00:00:0${index}Z` }));
    const forest = filterForest(buildAgentForest(agents, ["wks"], { showClosed: false }), "idle");
    const nodes = [...forest.trees, ...forest.solo];
    expect(nodes.map(node => node.agent.id).sort()).toEqual(agents.map(agent => agent.id).sort());
    expect(nodes.every(node => !node.waiting && node.children.length === 0)).toBe(true);
  });
  it("creates idle independent members with exact Profile settings and reuses them by identity", async () => {
    const f = await fixture(), team = teamFixture();
    await applyResearch({ workspaceId: "wks", team, bindings: { "coder-a": "profile" } }, f.ctx);
    expect(f.create).toHaveBeenCalledTimes(3);
    expect(f.create.mock.calls.every(([options]) => options.prompt === undefined && !("parent" in options))).toBe(true);
    expect(f.configs[1]).toMatchObject({ provider: "test/m", modeId: "ask", thinkingOptionId: "high", featureValues: { feature: { enabled: false } } });
    expect(f.configs[2]).not.toHaveProperty("modeId");
    expect(f.configs.every(config => String(config.systemPrompt).includes("common standing instructions"))).toBe(true);
    await Promise.all([applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx), applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx)]);
    expect(f.create).toHaveBeenCalledTimes(3);
    const directory = JSON.parse(await readFile(join(f.root, runtimeFile(team.id)), "utf8"));
    expect(new Set(directory.members.map((m: {agentId: string}) => m.agentId)).size).toBe(3);
    expect(directory.bindings["coder-a"]).toBe("profile");
    expect(await readFile(join(f.root, ".gitignore"), "utf8")).toContain("/.agents/.runtime/paseo-agent-team/");
  });
  it("marks changed prompts pending, resets only the selected member and retains other sessions", async () => {
    const f = await fixture(), team = teamFixture();
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    await writeFile(join(f.root, "prompts/programmer.md"), "New programmer instructions");
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    expect(f.create).toHaveBeenCalledTimes(3);
    const read = await readResearch({ workspaceId: "wks" }, f.ctx);
    expect(read.members.map(m => m.pending)).toEqual([false, true, true]);
    const result = await resetResearchMember({ workspaceId: "wks", memberId: "coder-a" }, f.ctx);
    expect(f.archive).toHaveBeenCalledWith("agent-2");
    expect(result.agentId).toBe("agent-4");
    expect(f.agents.find(a => a.id === "agent-1")!.archivedAt).toBeNull();
    expect(f.agents.find(a => a.id === "agent-3")!.archivedAt).toBeNull();
    expect(String(f.configs.at(-1)!.systemPrompt)).toContain("New programmer instructions");
  });
  it("recovers partial creation and rejects missing prompts before creating any sessions", async () => {
    const f = await fixture(), team = teamFixture();
    await rm(join(f.root, "prompts/anchor.md"));
    await expect(applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx)).rejects.toThrow();
    expect(f.create).not.toHaveBeenCalled();
    await writeFile(join(f.root, "prompts/anchor.md"), "Anchor");
    f.fail("coder-b");
    await expect(applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx)).rejects.toThrow("simulated");
    f.fail("");
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    expect(f.agents).toHaveLength(3);
  });
  it("preserves the member model through listing, restoration and workspace reconnection", async () => {
    const f = await fixture(), team = teamFixture();
    const applied = await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    const listing = await projectTeams({ id: "prj", name: "Research", root: f.root });
    expect(listing.teams[0]!.team.members).toHaveLength(3);
    await restoreTeam({ projectId: "prj", file: listing.teams[0]!.file }, f.ctx);
    expect(f.create).toHaveBeenCalledTimes(3);
    f.workspace.title = "renamed";
    await reconnectTeam({ projectId: "prj", file: listing.teams[0]!.file, workspaceId: "wks" }, f.ctx);
    const stored = JSON.parse(await readFile(applied.file, "utf8"));
    expect(stored.version).toBe(2);
    expect(stored.workspace).toBe("renamed");
    expect(stored.members).toHaveLength(3);
  });
  it("refuses ambiguous active sessions instead of silently choosing a same-role agent", async () => {
    const f = await fixture(), team = teamFixture();
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    f.agents.push({ ...f.agents[1]!, id: "duplicate" });
    await expect(applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx)).rejects.toThrow("Multiple sessions");
    expect(f.agents[0]!.labels[TEAM_LABEL]).toBe(team.id);
    expect(f.agents[0]!.labels[CONFIG_LABEL]).toHaveLength(64);
  });
  it("ignores retired definitions without converting files, prompts or sessions", async () => {
    const f = await fixture();
    const legacy = { version: 1, goal: "Old team", orchestrator: { workspace: "research", provider: "test", model: "m" }, roles: [{ name: "proof", provider: "test", model: "m", instructions: "Old instructions" }] };
    await mkdir(join(f.root, ".agents/teams"), { recursive: true });
    const oldFile = join(f.root, ".agents/teams/research.json"), original = JSON.stringify(legacy);
    await writeFile(oldFile, original);
    const empty = await readResearch({ workspaceId: "wks" }, f.ctx);
    expect(empty.team).toBeNull();
    expect(empty.file).toBeNull();
    expect(empty.errors).toEqual([]);
    const created = await applyResearch({ workspaceId: "wks", team: teamFixture(), bindings: {} }, f.ctx);
    expect(created.file).toBe(join(f.root, ".agents/teams/research-2.json"));
    expect(await readFile(oldFile, "utf8")).toBe(original);
    expect(f.archive).not.toHaveBeenCalled();
    expect((await readResearch({ workspaceId: "wks" }, f.ctx)).team?.members).toHaveLength(3);
    await expect(deleteTeam({ projectId: "prj", file: ".agents/teams/research.json" }, f.ctx)).rejects.toThrow("not a team file");
    await expect(restoreTeam({ projectId: "prj", file: ".agents/teams/research.json" }, f.ctx)).rejects.toThrow("not a team file");
  });
  it("refuses duplicate definitions instead of silently choosing a team", async () => {
    const f = await fixture(), team = teamFixture();
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    await writeFile(join(f.root, ".agents/teams/duplicate.json"), JSON.stringify({ ...team, id: "different" }));
    expect((await readResearch({ workspaceId: "wks" }, f.ctx)).errors.join(" ")).toContain("multiple teams");
    await expect(applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx)).rejects.toThrow("multiple teams");
  });
  it("adds a new role without resetting existing members and archives removed members", async () => {
    const f = await fixture(), team = teamFixture();
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    await writeFile(join(f.root, "prompts/review.md"), "Review evidence");
    team.roles.push({ id: "review", name: "Review", promptFiles: ["prompts/review.md"] });
    team.members.push({ id: "reviewer", roleId: "review", launchSnapshot: { provider: "test", model: "m" } });
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    expect(f.create).toHaveBeenCalledTimes(4);
    expect((await readResearch({ workspaceId: "wks" }, f.ctx)).members.every(member => !member.pending)).toBe(true);
    team.members = team.members.filter(member => member.id !== "coder-b");
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    expect(f.agents.find(agent => agent.id === "agent-3")!.archivedAt).toBe("now");
    expect(f.agents.find(agent => agent.id === "agent-1")!.archivedAt).toBeNull();
  });
  it("deletes only labelled team members and rebuilds a damaged runtime directory", async () => {
    const f = await fixture(), team = teamFixture();
    const applied = await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    await writeFile(join(f.root, runtimeFile(team.id)), "broken json");
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    expect(f.create).toHaveBeenCalledTimes(3);
    f.agents.push({ ...f.agents[1]!, id: "outside-team", labels: { role: "programmer" } });
    const listing = await projectTeams({ id: "prj", name: "Research", root: f.root });
    await deleteTeam({ projectId: "prj", file: listing.teams[0]!.file }, f.ctx);
    expect(f.agents.find(agent => agent.id === "outside-team")!.archivedAt).toBeNull();
    expect(f.archive).toHaveBeenCalledTimes(3);
  });
  it("retains the definition after an archive failure so deletion can be retried", async () => {
    const f = await fixture();
    const applied = await applyResearch({ workspaceId: "wks", team: teamFixture(), bindings: {} }, f.ctx);
    const file = ".agents/teams/research.json";
    f.archive.mockRejectedValueOnce(new Error("offline"));
    const failed = await deleteTeam({ projectId: "prj", file }, f.ctx);
    expect(failed.files).toEqual([]);
    expect(failed.failures).toHaveLength(1);
    expect(JSON.parse(await readFile(applied.file, "utf8")).version).toBe(2);
    const retried = await deleteTeam({ projectId: "prj", file }, f.ctx);
    expect(retried.failures).toEqual([]);
    expect(retried.files).toEqual([file]);
  });
  it("refuses reconnecting to another team's Workspace", async () => {
    const f = await fixture(), team = teamFixture();
    const applied = await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    await writeFile(join(f.root, ".agents/teams/other.json"), JSON.stringify({ ...team, id: "other", workspace: "occupied" }));
    f.workspace.title = "occupied";
    const result = await reconnectTeam({ projectId: "prj", file: ".agents/teams/research.json", workspaceId: "wks" }, f.ctx);
    expect(result.ok).toBe(false);
    expect(JSON.parse(await readFile(applied.file, "utf8")).workspace).toBe("research");
  });
  it("rejects prompt traversal and symlinks outside the project", async () => {
    const f = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "outside-prompts-")); roots.push(outside);
    await writeFile(join(outside, "prompt.md"), "outside");
    await symlink(join(outside, "prompt.md"), join(f.root, "prompts/link.md"));
    await expect(readPrompt(f.root, "prompts/link.md")).rejects.toThrow("outside");
    await expect(readPrompt(f.root, join(outside, "prompt.md"))).rejects.toThrow("relative");
  });
});
it("reads all pages and refuses cursor cycles", async () => {
  expect(await allPages(async cursor => cursor ? { entries: [2], pageInfo: { hasMore: false, nextCursor: null } } : { entries: [1], pageInfo: { hasMore: true, nextCursor: "next" } })).toEqual([1, 2]);
  await expect(allPages(async () => ({ entries: [], pageInfo: { hasMore: true, nextCursor: "same" } }))).rejects.toThrow("cursor");
});
