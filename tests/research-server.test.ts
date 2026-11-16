import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { parse } from "yaml";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResearch, exportResearch, loadResearch, readPrompt, readResearch, resetResearchMember } from "../server/research-team";
import { projectTeams, projectTeamsList, reconnectTeam, restoreTeam, deleteTeam } from "../server/team-directory";
import { buildAgentForest, filterForest } from "../shared/agent-tree";
import { allPages } from "../server/pagination";
import { CONFIG_LABEL, MEMBER_LABEL, ResearchTeamSchema, runtimeFile, TEAM_LABEL } from "../shared/research-team";
import { teamFixture } from "./fixtures/research";
import { serializeTeamConfig } from "../server/team-config";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "research-team-")); roots.push(root);
  await mkdir(join(root, "prompts"));
  for (const name of ["common", "anchor", "programmer"]) await writeFile(join(root, `prompts/${name}.md`), `${name} standing instructions`);
  const project = { projectId: "prj", projectRootPath: root, projectDisplayName: "Research" };
  const workspace = { ...project, id: "wks", name: "research", title: "research", workspaceDirectory: root, archivingAt: null };
  type Agent = { id: string; workspaceId: string; labels: Record<string,string>; provider: string; model: string | null; currentModeId?: string | null; thinkingOptionId?: string | null; effectiveThinkingOptionId?: string | null; status: string; archivedAt: string | null; requiresAttention: boolean };
  const agents: Agent[] = [];
  const configs: Record<string, unknown>[] = [];
  const archive = vi.fn(async (id: string) => { agents.find(a => a.id === id)!.archivedAt = "now"; return { archivedAt: "now" }; });
  let failMember = "";
  const create = vi.fn(async (options: { config: Record<string, unknown>; labels: Record<string,string>; prompt?: string }) => {
    if (options.labels[MEMBER_LABEL] === failMember) throw new Error("simulated provider failure");
    configs.push(options.config);
    const id = `agent-${agents.length + 1}`;
    const selected = String(options.config.provider), slash = selected.indexOf("/");
    agents.push({ id, workspaceId: "wks", labels: options.labels, provider: selected.slice(0, slash), model: selected.slice(slash + 1),
      currentModeId: options.config.modeId as string | undefined ?? null,
      thinkingOptionId: options.config.thinkingOptionId as string | undefined ?? null,
      effectiveThinkingOptionId: options.config.thinkingOptionId as string | undefined ?? null,
      status: "idle", archivedAt: null, requiresAttention: false });
    return { id };
  });
  const profiles = [{ id: "profile", name: "Configured", provider: "test", model: "m", modeId: "ask", featureValues: { flag: false } }];
  const api = {
    projects: { list: async () => ({ projects: [project] }) },
    providers: { snapshot: async () => ({ entries: ["test", "other"].map(provider => ({ provider, enabled: true, status: "ready", models: [{ id: "m", label: "M" }, { id: "alternative", label: "Alternative" }], modes: [{ id: "auto" }] })) }) },
    config: { get: async () => ({ config: { agentProfiles: profiles } }) },
    workspaces: { list: async () => ({ entries: [workspace] }), ref: () => ({ refresh: async () => workspace, agents: { create } }) },
    agents: { list: async () => ({ entries: agents.map(agent => ({ agent })) }), ref: (id: string) => ({ archive: () => archive(id) }) },
  };
  const ctx = { paseo: api as unknown as PluginHandlerContext["paseo"] };
  return { root, ctx, workspace, agents, configs, create, archive, fail: (member: string) => { failMember = member; } };
}
describe("research sessions", () => {
  it("loads a configuration into an empty Workspace without creating sessions", async () => {
    const f = await fixture(), team = { ...teamFixture(), workspace: "Portable Workspace" };
    await writeFile(join(f.root, "portable.yml"), "# Portable team\n" + serializeTeamConfig("portable.yml", team));
    const result = await loadResearch({ workspaceId: "wks", path: "portable.yml" }, f.ctx);
    expect(result.file).toBe(join(f.root, ".agents/teams/research.yaml"));
    expect(parse(await readFile(result.file, "utf8"))).toEqual({ ...team, workspace: "research" });
    expect(await readFile(result.file, "utf8")).toContain("# Portable team");
    expect((await readResearch({ workspaceId: "wks" }, f.ctx)).team?.id).toBe(team.id);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.archive).not.toHaveBeenCalled();
  });

  it.each(["json", "yaml", "yml"])("replaces an existing %s file while preserving Workspace identity, sessions and unchanged Profile bindings", async ext => {
    const f = await fixture(), team = teamFixture(), file = `.agents/team.${ext}`;
    await mkdir(join(f.root, ".agents"));
    await writeFile(join(f.root, file), serializeTeamConfig(file, team));
    await applyResearch({ workspaceId: "wks", team, bindings: { lead: "profile", "coder-a": "profile" } }, f.ctx);
    const originalIds = f.agents.map(agent => agent.id);
    const incoming = { ...team, id: "portable-id", workspace: "foreign-title", goal: "Imported goal", members: team.members.map(member => member.id === "coder-a" ? { ...member, launchSnapshot: { ...member.launchSnapshot, thinkingOptionId: "medium" } } : member) };
    const source = join(f.root, "portable.yaml");
    await writeFile(source, serializeTeamConfig(source, incoming));
    const result = await loadResearch({ workspaceId: "wks", path: source }, f.ctx);
    expect(result.file).toBe(join(f.root, file));
    expect(parse(await readFile(result.file, "utf8"))).toEqual({ ...incoming, id: team.id, workspace: "research" });
    if (ext === "json") expect(JSON.parse(await readFile(result.file, "utf8")).goal).toBe("Imported goal");
    const observed = await readResearch({ workspaceId: "wks" }, f.ctx);
    expect(observed.bindings).toEqual({ lead: "profile" });
    expect(observed.members.find(member => member.id === "coder-a")?.pending).toBe(true);
    expect(f.agents.map(agent => agent.id)).toEqual(originalIds);
    expect(f.create).toHaveBeenCalledTimes(3);
    expect(f.archive).not.toHaveBeenCalled();
  });

  it.each(["id: [", "version: 1\n", "id: first\nid: second\n"])("does not change the saved configuration or routing when Load rejects %s", async invalid => {
    const f = await fixture(), team = teamFixture();
    const applied = await applyResearch({ workspaceId: "wks", team, bindings: { lead: "profile" } }, f.ctx);
    const before = await readFile(applied.file, "utf8"), directory = await readFile(join(f.root, runtimeFile(team.id)), "utf8");
    await writeFile(join(f.root, "invalid.yaml"), invalid);
    await expect(loadResearch({ workspaceId: "wks", path: "invalid.yaml" }, f.ctx)).rejects.toThrow();
    expect(await readFile(applied.file, "utf8")).toBe(before);
    expect(await readFile(join(f.root, runtimeFile(team.id)), "utf8")).toBe(directory);
    expect(f.create).toHaveBeenCalledTimes(3);
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("rejects a conflicting imported Team ID before writing a new Workspace definition", async () => {
    const f = await fixture(), team = teamFixture();
    await mkdir(join(f.root, ".agents/teams"), { recursive: true });
    await writeFile(join(f.root, ".agents/teams/other.yaml"), serializeTeamConfig("other.yaml", { ...team, workspace: "other" }));
    await writeFile(join(f.root, "portable.json"), JSON.stringify(team));
    await expect(loadResearch({ workspaceId: "wks", path: "portable.json" }, f.ctx)).rejects.toThrow("already belongs");
    expect((await projectTeams({ id: "prj", name: "P", root: f.root })).teams).toHaveLength(1);
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each(["yaml", "yml", "json"])("exports saved configuration as %s without runtime data or session effects", async ext => {
    const f = await fixture(), team = teamFixture();
    const applied = await applyResearch({ workspaceId: "wks", team, bindings: { lead: "private-profile-id" } }, f.ctx);
    const original = await readFile(applied.file, "utf8");
    await writeFile(applied.file, "# Saved comment\n" + original);
    const result = await exportResearch({ workspaceId: "wks", path: `exports/team.${ext}`, overwrite: false }, f.ctx);
    const output = await readFile(result.file, "utf8");
    expect(parse(output)).toEqual(team);
    if (ext !== "json") expect(output).toBe("# Saved comment\n" + original);
    else expect(JSON.parse(output)).toEqual(team);
    expect(output).not.toContain("private-profile-id");
    expect(output).not.toContain(f.agents[0].id);
    expect(await readFile(applied.file, "utf8")).toBe("# Saved comment\n" + original);
    expect(f.create).toHaveBeenCalledTimes(3);
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("requires an explicit overwrite for an existing export destination", async () => {
    const f = await fixture(), team = teamFixture();
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    const path = join(f.root, "export.json");
    await writeFile(path, "existing file");
    await expect(exportResearch({ workspaceId: "wks", path, overwrite: false }, f.ctx)).rejects.toThrow("EEXIST");
    expect(await readFile(path, "utf8")).toBe("existing file");
    await exportResearch({ workspaceId: "wks", path, overwrite: true }, f.ctx);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(team);
  });

  it("refuses export without a saved configuration or into active configuration/runtime paths", async () => {
    const f = await fixture();
    await expect(exportResearch({ workspaceId: "wks", path: "export.yaml", overwrite: false }, f.ctx)).rejects.toThrow("before exporting");
    const applied = await applyResearch({ workspaceId: "wks", team: teamFixture(), bindings: {} }, f.ctx);
    const original = await readFile(applied.file, "utf8");
    for (const path of [".agents/team.json", ".agents/teams/research.yaml", runtimeFile("research")]) await expect(exportResearch({ workspaceId: "wks", path, overwrite: true }, f.ctx)).rejects.toThrow("outside this Project");
    expect(await readFile(applied.file, "utf8")).toBe(original);
    await expect(loadResearch({ workspaceId: "wks", path: "missing.yaml" }, f.ctx)).rejects.toThrow("ENOENT");
    await expect(loadResearch({ workspaceId: "wks", path: "notes.md" }, f.ctx)).rejects.toThrow(".json, .yaml or .yml");
  });

  it("protects active export locations reached through a symlink", async () => {
    const f = await fixture();
    const applied = await applyResearch({ workspaceId: "wks", team: teamFixture(), bindings: {} }, f.ctx);
    await symlink(join(f.root, ".agents/teams"), join(f.root, "alias"));
    await expect(exportResearch({ workspaceId: "wks", path: "alias/research.yaml", overwrite: true }, f.ctx)).rejects.toThrow("outside this Project");
    expect(parse(await readFile(applied.file, "utf8")).id).toBe("research");
  });
  it.each([".agents/team.json", ".agents/team.yaml", ".agents/team.yml", ".agents/teams/manual.json", ".agents/teams/manual.yaml", ".agents/teams/manual.yml"])("configures members directly from %s and retains its format on Apply", async file => {
    const f = await fixture(), team = teamFixture();
    await mkdir(join(f.root, file.slice(0, file.lastIndexOf("/"))), { recursive: true });
    const source = (file.endsWith("json") ? "" : "# User configuration\n") + serializeTeamConfig(file, team);
    await writeFile(join(f.root, file), source);
    const loaded = await readResearch({ workspaceId: "wks" }, f.ctx);
    expect(loaded.errors).toEqual([]);
    expect(loaded.team).toEqual(team);
    expect(loaded.file).toBe(file);
    expect(f.create).not.toHaveBeenCalled();
    const result = await applyResearch({ workspaceId: "wks", team: ResearchTeamSchema.parse(loaded.team), bindings: {} }, f.ctx);
    expect(result.file).toBe(join(f.root, file));
    expect(parse(await readFile(result.file, "utf8"))).toEqual(team);
    if (!file.endsWith("json")) expect(await readFile(result.file, "utf8")).toBe(source);
    expect(f.create).toHaveBeenCalledTimes(3);
    const edited = { ...team, goal: "Edited in a file" };
    await writeFile(result.file, serializeTeamConfig(file, edited, source));
    const refreshed = await readResearch({ workspaceId: "wks" }, f.ctx);
    expect(refreshed.team?.goal).toBe("Edited in a file");
    await applyResearch({ workspaceId: "wks", team: ResearchTeamSchema.parse(refreshed.team), bindings: {} }, f.ctx);
    expect(f.create).toHaveBeenCalledTimes(3);
  });
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
  it("uses member overrides instead of its source Profile and saves manual changes without resetting sessions", async () => {
    const f = await fixture(), team = teamFixture();
    team.members[0].launchSnapshot = { provider: "test", model: "alternative", modeId: "plan", thinkingOptionId: "medium", featureValues: { flag: false, custom: { limit: 3 } } };
    await applyResearch({ workspaceId: "wks", team, bindings: { lead: "profile" } }, f.ctx);
    expect(f.configs[0]).toMatchObject({ provider: "test/alternative", modeId: "plan", thinkingOptionId: "medium", featureValues: { flag: false, custom: { limit: 3 } } });
    const first = await readResearch({ workspaceId: "wks" }, f.ctx);
    expect(first.bindings.lead).toBe("profile");
    expect(first.profiles[0]).toMatchObject({ model: "m", modeId: "ask", featureValues: { flag: false } });
    expect(first.team!.members[0].launchSnapshot).toEqual(team.members[0].launchSnapshot);

    // Switching to manual detaches the Profile but preserves the member's settings.
    delete team.members[0].launchSnapshot.modeId;
    team.members[0].launchSnapshot.thinkingOptionId = "low";
    await applyResearch({ workspaceId: "wks", team, bindings: { lead: "" } }, f.ctx);
    expect(f.create).toHaveBeenCalledTimes(3);
    expect(f.archive).not.toHaveBeenCalled();
    const changed = await readResearch({ workspaceId: "wks" }, f.ctx);
    expect(changed.bindings).not.toHaveProperty("lead");
    expect(changed.members.map(member => member.pending)).toEqual([true, false, false]);
    expect(changed.team!.members[0].launchSnapshot).toEqual(team.members[0].launchSnapshot);

    await resetResearchMember({ workspaceId: "wks", memberId: "lead" }, f.ctx);
    expect(f.configs.at(-1)).toMatchObject({ provider: "test/alternative", thinkingOptionId: "low", featureValues: { flag: false, custom: { limit: 3 } } });
    expect(f.configs.at(-1)).not.toHaveProperty("modeId");
    expect((await readResearch({ workspaceId: "wks" }, f.ctx)).profiles).toEqual(first.profiles);
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
  it("reports manual session changes without rewriting saved settings or replacing the member", async () => {
    const f = await fixture(), team = teamFixture();
    const applied = await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    const savedFile = await readFile(applied.file, "utf8");
    const member = f.agents[1]!, id = member.id;
    member.model = "manually-selected-model";
    member.thinkingOptionId = "low";
    member.effectiveThinkingOptionId = "low";
    const read = await readResearch({ workspaceId: "wks" }, f.ctx);
    expect(read.members[1]).toMatchObject({ agentId: id, pending: false, settingsChanged: true,
      sessionSettings: { provider: "test", model: "manually-selected-model", thinkingOptionId: "low", effectiveThinkingOptionId: "low" } });
    expect(read.team!.members[1]!.launchSnapshot).toEqual(team.members[1]!.launchSnapshot);
    expect(await readFile(applied.file, "utf8")).toBe(savedFile);
    await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    expect(f.create).toHaveBeenCalledTimes(3);
    expect(member.model).toBe("manually-selected-model");
    expect((await readResearch({ workspaceId: "wks" }, f.ctx)).members[1]!.agentId).toBe(id);
    await resetResearchMember({ workspaceId: "wks", memberId: "coder-a" }, f.ctx);
    const reset = (await readResearch({ workspaceId: "wks" }, f.ctx)).members[1]!;
    expect(reset.agentId).not.toBe(id);
    expect(reset.settingsChanged).toBe(false);
    expect(reset.sessionSettings).toMatchObject({ model: "m", thinkingOptionId: "high" });
  });
  it("keeps missing-session settings separate from its saved launch parameters", async () => {
    const f = await fixture();
    await applyResearch({ workspaceId: "wks", team: teamFixture(), bindings: {} }, f.ctx);
    f.agents[1]!.archivedAt = "now";
    const state = (await readResearch({ workspaceId: "wks" }, f.ctx)).members[1]!;
    expect(state).toMatchObject({ agentId: null, sessionSettings: null, settingsChanged: false });
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
    const stored = parse(await readFile(applied.file, "utf8"));
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
    expect(created.file).toBe(join(f.root, ".agents/teams/research.yaml"));
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
    const file = ".agents/teams/research.yaml";
    f.archive.mockRejectedValueOnce(new Error("offline"));
    const failed = await deleteTeam({ projectId: "prj", file }, f.ctx);
    expect(failed.files).toEqual([]);
    expect(failed.failures).toHaveLength(1);
    expect(parse(await readFile(applied.file, "utf8")).version).toBe(2);
    const retried = await deleteTeam({ projectId: "prj", file }, f.ctx);
    expect(retried.failures).toEqual([]);
    expect(retried.files).toEqual([file]);
  });
  it("refuses reconnecting to another team's Workspace", async () => {
    const f = await fixture(), team = teamFixture();
    const applied = await applyResearch({ workspaceId: "wks", team, bindings: {} }, f.ctx);
    await writeFile(join(f.root, ".agents/teams/other.json"), JSON.stringify({ ...team, id: "other", workspace: "occupied" }));
    f.workspace.title = "occupied";
    const result = await reconnectTeam({ projectId: "prj", file: ".agents/teams/research.yaml", workspaceId: "wks" }, f.ctx);
    expect(result.ok).toBe(false);
    expect(parse(await readFile(applied.file, "utf8")).workspace).toBe("research");
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
