import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browseHost } from "../server/host-files";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "host-config-browser-"))); roots.push(root);
  const ctx = { paseo: { workspaces: { ref: () => ({ refresh: async () => ({ projectId: "p", projectRootPath: root, projectDisplayName: "P" }) }) } } } as unknown as PluginHandlerContext;
  return { root, ctx };
}
describe("agent host configuration browsing", () => {
  it("starts at the Project root and lists folders and configuration files only", async () => {
    const { root, ctx } = await fixture();
    await mkdir(join(root, ".config"));
    await writeFile(join(root, "team.yaml"), "private content");
    await writeFile(join(root, "team.json"), "{}");
    await writeFile(join(root, "other.txt"), "not a configuration");
    const before = await readdir(root, { recursive: true });
    const result = await browseHost({ workspaceId: "w", directory: "" }, ctx);
    expect(result.directory).toBe(root); expect(result.projectRoot).toBe(root); expect(result.home).toBe(homedir());
    expect(result.entries.map(entry => entry.name)).toEqual([".config", "team.json", "team.yaml"]);
    expect(result.entries[0].kind).toBe("directory"); expect(JSON.stringify(result)).not.toContain("private content");
    expect(await readdir(root, { recursive: true })).toEqual(before);
  });

  it("can browse absolute directories outside the Project on the same host", async () => {
    const { root, ctx } = await fixture(), other = await fixture();
    await writeFile(join(other.root, "portable.yml"), "");
    const result = await browseHost({ workspaceId: "w", directory: other.root }, ctx);
    expect(result.directory).toBe(other.root); expect(result.projectRoot).toBe(root);
    expect(result.entries).toEqual([{ name: "portable.yml", path: join(other.root, "portable.yml"), kind: "file" }]);
  });

  it("resolves readable directory symlinks and skips broken links", async () => {
    const { root, ctx } = await fixture();
    await mkdir(join(root, "actual"));
    await writeFile(join(root, "actual/team.yaml"), "");
    await symlink(join(root, "actual"), join(root, "linked"));
    await symlink(join(root, "missing.yaml"), join(root, "broken.yaml"));
    const result = await browseHost({ workspaceId: "w", directory: "linked" }, ctx);
    expect(result.directory).toBe(join(root, "actual"));
    expect(result.entries[0].path).toBe(join(root, "actual/team.yaml"));
    expect((await browseHost({ workspaceId: "w", directory: "" }, ctx)).entries.some(entry => entry.name === "broken.yaml")).toBe(false);
  });

  it("bounds large listings and reports non-directory and missing paths", async () => {
    const { root, ctx } = await fixture();
    await Promise.all(Array.from({ length: 301 }, (_, i) => writeFile(join(root, `${i}.yaml`), "")));
    const result = await browseHost({ workspaceId: "w", directory: "" }, ctx);
    expect(result.entries).toHaveLength(300); expect(result.truncated).toBe(true);
    await expect(browseHost({ workspaceId: "w", directory: "0.yaml" }, ctx)).rejects.toThrow("ENOTDIR");
    await expect(browseHost({ workspaceId: "w", directory: "missing" }, ctx)).rejects.toThrow("ENOENT");
  });
});
