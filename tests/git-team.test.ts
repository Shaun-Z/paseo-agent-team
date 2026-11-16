import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { cleanupGitImports, compareResearchGit, fetchResearchGit, importResearchGit } from "../server/git-team";
import { extractGitTeam, fetchGitSnapshot, gitConfigFiles, promptImportPath, readGitSnapshot, repositoryRef, repositoryUrl } from "../server/git-source";
import { gitTeamChanges, mergeGitTeam } from "../shared/git-team";
import { runtimeFile, type ResearchTeam } from "../shared/research-team";
import { serializeTeamConfig } from "../server/team-config";
import { teamFixture } from "./fixtures/research";

vi.mock("../server/git-source", async original => ({ ...await original<typeof import("../server/git-source")>(), fetchGitSnapshot: vi.fn() }));
const exec = promisify(execFile), roots: string[] = [];
const target = { workspaceId: "w" }, url = "https://example.com/team.git";
async function temp(prefix: string) { const root = await realpath(await mkdtemp(join(tmpdir(), prefix))); roots.push(root); return root; }
async function put(root: string, path: string, text: string) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), text); }
async function commit(root: string) {
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(root, "no-hooks")}`, "commit", "-qm", "fixture"]);
}
afterEach(async () => { await cleanupGitImports(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); vi.clearAllMocks(); });
async function fixture(remote = teamFixture(), local?: ResearchTeam) {
  const repo = await temp("git-team-source-"), root = await temp("git-team-target-");
  await exec("git", ["init", "-q", "--template=", repo]);
  await put(repo, "team.yaml", "# Repository team\n" + serializeTeamConfig("team.yaml", remote));
  for (const path of new Set([...remote.commonPromptFiles, ...remote.roles.flatMap(role => role.promptFiles)])) if (!path.includes("..")) await put(repo, path, `Repository: ${path}\n`);
  await put(repo, "README.md", "Unrelated repository instructions. Do not execute.");
  await put(repo, "research/RESEARCH_STATE.md", "Unrelated research state");
  await commit(repo);
  const snapshot = await readGitSnapshot(join(repo, ".git"), "HEAD");
  vi.mocked(fetchGitSnapshot).mockResolvedValue(snapshot);
  const workspace = { id: "w", name: "Local", title: "Local", projectId: "p", projectRootPath: root, projectDisplayName: "P", workspaceDirectory: root };
  const create = vi.fn(), archive = vi.fn();
  const ctx = { paseo: {
    projects: { list: async () => ({ projects: [{ projectId: "p", projectRootPath: root, projectDisplayName: "P" }] }) },
    workspaces: { ref: () => ({ refresh: async () => workspace, agents: { create } }), list: async () => ({ entries: [workspace] }) },
    agents: { ref: () => ({ archive }), list: async () => ({ entries: [] }) },
  } } as unknown as PluginHandlerContext;
  if (local) {
    await put(root, ".agents/team.yml", "# Local team\n" + serializeTeamConfig("team.yml", { ...local, workspace: "Local" }));
    for (const path of new Set([...local.commonPromptFiles, ...local.roles.flatMap(role => role.promptFiles)])) await put(root, path, `Local: ${path}\n`);
  }
  const fetched = await fetchResearchGit({ ...target, repository: url, ref: "HEAD" }, ctx);
  const compare = () => compareResearchGit({ ...target, sourceId: fetched.sourceId, configFile: "team.yaml" }, ctx);
  return { repo, root, ctx, fetched, compare, create, archive, snapshot };
}

describe("Git team sources", () => {
  it("accepts HTTPS/SSH repository URLs and rejects executable transports, credentials and option-like refs", () => {
    expect(repositoryUrl(url)).toBe(url);
    expect(repositoryUrl("git@example.com:org/team.git")).toBe("git@example.com:org/team.git");
    expect(repositoryRef("release/v2")).toBe("release/v2");
    for (const value of ["ext::sh -c bad", "file:///tmp/team", "/tmp/team", "https://token:secret@example.com/team", "https://token@example.com/team"]) expect(() => repositoryUrl(value)).toThrow();
    for (const value of ["--upload-pack=bad", "HEAD~1", "a..b", "a\nb"]) expect(() => repositoryRef(value)).toThrow();
    for (const path of ["../outside", "/absolute", "C:/absolute", "prompts/../../outside", ".git/config", ".agents/team.yaml", ".agents/.runtime/secret", "prompts\\bad"]) expect(() => promptImportPath(path)).toThrow();
  });

  it("reads configuration and referenced blobs at the fetched commit without checking out or executing repository contents", async () => {
    const f = await fixture();
    expect(gitConfigFiles(f.snapshot)).toContain("team.yaml");
    await put(f.repo, "prompts/common.md", "A later revision"); await commit(f.repo);
    const result = await extractGitTeam(f.snapshot, "team.yaml");
    expect(result.prompts.get("prompts/common.md")).toBe("Repository: prompts/common.md\n");
    expect(result.prompts.has("README.md")).toBe(false);
    expect(await readdir(f.root)).toEqual([]);
  });

  it("rejects missing, symlinked and outside-repository prompt references", async () => {
    const f = await fixture();
    const missing = { ...f.snapshot, files: new Map(f.snapshot.files) }; missing.files.delete("prompts/common.md");
    await expect(extractGitTeam(missing, "team.yaml")).rejects.toThrow("missing");
    const link = { ...f.snapshot, files: new Map(f.snapshot.files) }; link.files.set("prompts/common.md", { mode: "120000", oid: "anything" });
    await expect(extractGitTeam(link, "team.yaml")).rejects.toThrow("regular file");
  });

  it("rejects invalid source prompt paths and oversized blobs before touching the Project", async () => {
    const f = await fixture();
    const invalid = teamFixture(); invalid.commonPromptFiles = ["../outside.md"];
    await put(f.repo, "team.yaml", serializeTeamConfig("team.yaml", invalid)); await commit(f.repo);
    await expect(extractGitTeam(await readGitSnapshot(join(f.repo, ".git"), "HEAD"), "team.yaml")).rejects.toThrow("Project-relative");
    await put(f.repo, "team.yaml", serializeTeamConfig("team.yaml", teamFixture()));
    await put(f.repo, "prompts/common.md", "x".repeat(512 * 1024 + 1)); await commit(f.repo);
    await expect(extractGitTeam(await readGitSnapshot(join(f.repo, ".git"), "HEAD"), "team.yaml")).rejects.toThrow("512 KiB");
    expect(await readdir(f.root)).toEqual([]);
  });

  it.runIf(process.env.PASEO_GIT_SOURCE_SMOKE === "1")("fetches the supplied public repository and reads its complete team without checkout", async () => {
    const actual = await vi.importActual<typeof import("../server/git-source")>("../server/git-source");
    const snapshot = await actual.fetchGitSnapshot("https://github.com/Shaun-Z/Multi-Agent-Scientific-Research-Framework", "HEAD");
    roots.push(snapshot.directory);
    const extracted = await actual.extractGitTeam(snapshot, "team.yaml");
    expect(extracted.team.roles.length).toBeGreaterThan(0);
    expect(extracted.prompts.size).toBeGreaterThanOrEqual(extracted.team.roles.length);
    expect(await readdir(snapshot.directory)).not.toContain("prompts");
  }, 120_000);
});

describe("selective Git team import", () => {
  it("previews without writes, then creates a team and only its explicitly referenced prompts without sessions", async () => {
    const f = await fixture(), plan = await f.compare();
    expect(plan.before).toBeNull(); expect(plan.incoming.workspace).toBe("Local");
    expect(await readdir(f.root)).toEqual([]);
    const result = await importResearchGit({ ...target, planId: plan.planId, selected: plan.changes.map(change => change.id) }, f.ctx);
    expect(result.file).toBe(join(f.root, ".agents/teams/local.yaml"));
    expect(await readFile(result.file, "utf8")).toContain("# Repository team");
    expect(parse(await readFile(result.file, "utf8"))).toEqual({ ...teamFixture(), workspace: "Local" });
    expect(await readFile(join(f.root, "prompts/common.md"), "utf8")).toContain("Repository:");
    expect(result.changedFiles).not.toContain("README.md"); expect(result.changedFiles).not.toContain("research/RESEARCH_STATE.md");
    expect(f.create).not.toHaveBeenCalled(); expect(f.archive).not.toHaveBeenCalled();
  });

  it("lets Role names and prompt text update independently while preserving local models, metadata and unselected files", async () => {
    const local = teamFixture(), remote = teamFixture();
    remote.id = "external-id"; remote.goal = "Remote goal"; remote.roles[0].name = "Remote Anchor";
    remote.members[0].launchSnapshot = { provider: "other", model: "remote-model", thinkingOptionId: "low" };
    const f = await fixture(remote, local), plan = await f.compare();
    const selected = plan.changes.filter(change => change.kind === "role" && change.key === "anchor" || change.kind === "prompt" && change.key === "prompts/common.md").map(change => change.id);
    const result = await importResearchGit({ ...target, planId: plan.planId, selected }, f.ctx);
    const saved = parse(await readFile(result.file, "utf8"));
    expect(saved.roles[0].name).toBe("Remote Anchor"); expect(saved.members).toEqual(local.members);
    expect(saved.id).toBe(local.id); expect(saved.goal).toBe(local.goal); expect(saved.workspace).toBe("Local");
    expect(await readFile(result.file, "utf8")).toContain("# Local team");
    expect(await readFile(join(f.root, "prompts/anchor.md"), "utf8")).toBe("Local: prompts/anchor.md\n");
    expect(await readFile(join(f.root, "prompts/common.md"), "utf8")).toBe("Repository: prompts/common.md\n");
  });

  it("selects thinking separately and drops only changed launch snapshots' source Profile bindings", async () => {
    const local = teamFixture(), remote = teamFixture();
    remote.members[1].launchSnapshot.model = "remote-model";
    remote.members[1].launchSnapshot.thinkingOptionId = "low";
    const f = await fixture(remote, local);
    const runtime = { workspaceId: "w", bindings: { lead: "p1", "coder-a": "p2" }, members: [{ id: "coder-a", agentId: "existing", fingerprint: "old" }] };
    await put(f.root, runtimeFile(local.id), JSON.stringify(runtime));
    const plan = await f.compare();
    const thinking = plan.changes.find(change => change.kind === "member" && change.key === "coder-a" && change.field.at(-1) === "thinkingOptionId")!;
    await importResearchGit({ ...target, planId: plan.planId, selected: [thinking.id] }, f.ctx);
    const saved = parse(await readFile(join(f.root, ".agents/team.yml"), "utf8"));
    expect(saved.members[1].launchSnapshot).toEqual({ ...local.members[1].launchSnapshot, thinkingOptionId: "low" });
    expect(JSON.parse(await readFile(join(f.root, runtimeFile(local.id)), "utf8"))).toEqual({ ...runtime, bindings: { lead: "p1" } });
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("keeps local-only members unless selected and rejects broken Role dependencies before writing", async () => {
    const local = teamFixture(), remote = teamFixture(); remote.members = remote.members.slice(0, 1); remote.roles = remote.roles.slice(0, 1);
    const f = await fixture(remote, local), plan = await f.compare();
    const removal = plan.changes.find(change => change.kind === "role" && change.status === "removed")!;
    const before = await readFile(join(f.root, ".agents/team.yml"), "utf8");
    await expect(importResearchGit({ ...target, planId: plan.planId, selected: [removal.id] }, f.ctx)).rejects.toThrow("unknown role");
    expect(await readFile(join(f.root, ".agents/team.yml"), "utf8")).toBe(before);
    const selected = plan.changes.filter(change => change.status === "removed").map(change => change.id);
    await importResearchGit({ ...target, planId: plan.planId, selected }, f.ctx);
    expect(parse(await readFile(join(f.root, ".agents/team.yml"), "utf8")).members).toHaveLength(1);
    expect(await readFile(join(f.root, "prompts/programmer.md"), "utf8")).toContain("Local:");
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("does not create a configuration if a required new prompt was skipped", async () => {
    const f = await fixture(), plan = await f.compare();
    await expect(importResearchGit({ ...target, planId: plan.planId, selected: plan.changes.filter(change => change.kind !== "prompt").map(change => change.id) }, f.ctx)).rejects.toThrow("Required prompt is missing");
    expect(await readdir(f.root)).toEqual([]);
  });

  it("supports the project-level creation entry without creating a Workspace or choosing a Profile", async () => {
    const f = await fixture(), project = { projectId: "p" };
    const source = await fetchResearchGit({ ...project, repository: url, ref: "HEAD" }, f.ctx);
    const plan = await compareResearchGit({ ...project, sourceId: source.sourceId, configFile: "team.yaml", workspaceName: "Project research" }, f.ctx);
    const result = await importResearchGit({ ...project, planId: plan.planId, selected: plan.changes.map(change => change.id) }, f.ctx);
    expect(result.team.workspace).toBe("Project research");
    expect(result.file).toBe(join(f.root, ".agents/teams/project-research.yaml"));
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each(["prompt", "configuration"])("refuses stale %s comparisons without overwriting new local edits", async kind => {
    const f = await fixture(teamFixture(), teamFixture()), plan = await f.compare();
    const path = kind === "prompt" ? "prompts/common.md" : ".agents/team.yml";
    const before = await readFile(join(f.root, path), "utf8"); await put(f.root, path, before + "\n# New local edit\n");
    await expect(importResearchGit({ ...target, planId: plan.planId, selected: plan.changes.map(change => change.id) }, f.ctx)).rejects.toThrow(/changed after comparison/);
    expect(await readFile(join(f.root, path), "utf8")).toBe(before + "\n# New local edit\n");
  });

  it("refuses symlink ancestors before preview can read or overwrite external files", async () => {
    const f = await fixture(), outside = await temp("git-team-outside-");
    await put(outside, "common.md", "external"); await symlink(outside, join(f.root, "prompts"));
    await expect(f.compare()).rejects.toThrow("regular Project path");
    expect(await readFile(join(outside, "common.md"), "utf8")).toBe("external");
  });

  it("rejects another Workspace's source and unknown change IDs", async () => {
    const f = await fixture(), plan = await f.compare();
    await expect(compareResearchGit({ workspaceId: "another", sourceId: f.fetched.sourceId, configFile: "team.yaml" }, f.ctx)).rejects.toThrow("another Workspace");
    await expect(importResearchGit({ ...target, planId: plan.planId, selected: ["invented"] }, f.ctx)).rejects.toThrow("Unknown Git change");
    expect(await readdir(f.root)).toEqual([]);
  });
});

describe("Git field selection preview", () => {
  it("preserves false feature values and removes only explicitly selected optional fields", () => {
    const local = teamFixture(), remote = teamFixture();
    delete remote.members[1].launchSnapshot.modeId;
    remote.members[1].launchSnapshot.featureValues = { enabled: false, budget: 0 };
    const changes = gitTeamChanges(local, remote);
    expect(mergeGitTeam(local, remote, changes, []).members).toEqual(local.members);
    const merged = mergeGitTeam(local, remote, changes, changes.map(change => change.id));
    expect(merged.members[1].launchSnapshot).not.toHaveProperty("modeId");
    expect(merged.members[1].launchSnapshot.featureValues).toEqual({ enabled: false, budget: 0 });
  });
});
