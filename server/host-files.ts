import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { researchBrowseHostRpc } from "../shared/research-rpc";
import { projectOf } from "./team-directory";
import { isTeamConfigFile } from "./team-config";

const portable = (path: string) => path.replace(/\\/g, "/");

/** Browse one explicitly requested directory on the selected agent host. */
export async function browseHost({ workspaceId, directory }: RpcInput<typeof researchBrowseHostRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchBrowseHostRpc>> {
  const project = await projectOf(paseo, { workspaceId });
  const requested = directory === "~" ? homedir() : directory.startsWith("~/") ? resolve(homedir(), directory.slice(2)) : resolve(project.root, directory);
  const path = await realpath(requested);
  const entries = await Promise.all((await readdir(path, { withFileTypes: true })).map(async entry => {
    const full = join(path, entry.name);
    const type = entry.isSymbolicLink() ? await stat(full).catch(() => null) : entry;
    if (!type || !(type.isDirectory() || type.isFile() && isTeamConfigFile(entry.name))) return null;
    return { name: entry.name, path: portable(full), kind: type.isDirectory() ? "directory" as const : "file" as const };
  }));
  const sorted = entries.filter(entry => entry !== null).sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
  return { directory: portable(path), parent: dirname(path) === path ? null : portable(dirname(path)), projectRoot: portable(project.root), home: portable(homedir()), truncated: sorted.length > 300, entries: sorted.slice(0, 300) };
}
