import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { promptFiles } from "../server/prompt-files";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "prompt-picker-")); roots.push(root);
  const project = { projectId: "p", projectRootPath: root, projectDisplayName: "P" };
  const ctx = { paseo: { projects: { list: async () => ({ projects: [project] }) }, workspaces: { ref: () => ({ refresh: async () => project }) } } } as unknown as PluginHandlerContext;
  return { root, ctx };
}

describe("explicit Project prompt file browsing", () => {
  it("lists only the requested directory, including hidden folders, without reading prompts or writing a team", async () => {
    const { root, ctx } = await fixture();
    await mkdir(join(root, ".prompts")); await mkdir(join(root, "prompts"));
    await writeFile(join(root, "README.md"), "readme");
    await writeFile(join(root, "prompts/role.md"), "private prompt text");
    const before = await readdir(root, { recursive: true });
    const result = await promptFiles({ projectId: "p", directory: "" }, ctx);
    expect(result.parent).toBeNull();
    expect(result.entries.map(entry => entry.path)).toEqual([".prompts", "prompts", "README.md"]);
    expect(result.entries[0].kind).toBe("directory");
    expect(JSON.stringify(result)).not.toContain("private prompt text");
    expect(await readdir(root, { recursive: true })).toEqual(before);
    expect(await readFile(join(root, "prompts/role.md"), "utf8")).toBe("private prompt text");
    const child = await promptFiles({ workspaceId: "w", directory: "prompts" }, ctx);
    expect(child).toEqual({ directory: "prompts", parent: "", truncated: false, entries: [{ name: "role.md", path: "prompts/role.md", kind: "file" }] });
  });

  it("rejects absolute paths, parent traversal and escaping directory symlinks", async () => {
    const { root, ctx } = await fixture(), outside = await fixture();
    await symlink(outside.root, join(root, "escape"));
    for (const directory of [outside.root, "..", "escape"]) await expect(promptFiles({ projectId: "p", directory }, ctx)).rejects.toThrow(/Project/);
    expect((await promptFiles({ projectId: "p", directory: "" }, ctx)).entries).toEqual([]);
  });

  it("bounds large directory listings and reports missing directories", async () => {
    const { root, ctx } = await fixture();
    await Promise.all(Array.from({ length: 301 }, (_, i) => writeFile(join(root, `file-${String(i).padStart(3, "0")}.md`), "")));
    const result = await promptFiles({ projectId: "p", directory: "" }, ctx);
    expect(result.entries).toHaveLength(300);
    expect(result.truncated).toBe(true);
    await expect(promptFiles({ projectId: "p", directory: "missing" }, ctx)).rejects.toThrow("ENOENT");
  });
});
