import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { researchPromptFilesRpc } from "../shared/research-rpc";
import { projectOf } from "./team-directory";

/** Read one requested directory. No prompt contents, Role inference or recursive scan. */
export async function promptFiles({ directory, ...target }: RpcInput<typeof researchPromptFilesRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchPromptFilesRpc>> {
  if (isAbsolute(directory)) throw new Error("Prompt directory must be Project-relative");
  const project = await projectOf(paseo, target);
  const base = await realpath(project.root), path = await realpath(resolve(base, directory));
  const rel = relative(base, path);
  const current = rel.replace(/\\/g, "/");
  if (current === ".." || current.startsWith("../") || isAbsolute(rel)) throw new Error("Prompt directory is outside the Project");
  const entries = (await readdir(path, { withFileTypes: true })).filter(entry => entry.isFile() || entry.isDirectory())
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  return { directory: current, parent: current ? (dirname(current) === "." ? "" : dirname(current)) : null,
    truncated: entries.length > 300, entries: entries.slice(0, 300).map(entry => ({ name: entry.name, path: [current, entry.name].filter(Boolean).join("/"), kind: entry.isDirectory() ? "directory" : "file" })) };
}
