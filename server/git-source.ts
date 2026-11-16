import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { promisify } from "node:util";
import { ResearchTeamSchema } from "../shared/research-team";
import { isTeamConfigFile, parseTeamConfig } from "./team-config";

const exec = promisify(execFile);
export type GitSnapshot = { directory: string; commit: string; files: Map<string, { mode: string; oid: string }> };
async function git(args: string[], maxBuffer = 4 * 1024 * 1024) {
  return (await exec("git", ["-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never", ...args], {
    encoding: "utf8", maxBuffer, timeout: 90_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })).stdout;
}
export function repositoryUrl(input: string): string {
  if (/^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9_./-]+$/.test(input)) return input;
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter an HTTPS or SSH Git repository URL"); }
  if (!["https:", "http:", "ssh:"].includes(url.protocol) || url.password || url.search || url.hash || url.protocol !== "ssh:" && url.username || !url.hostname || !url.pathname || /[\x00-\x20]/.test(input)) throw new Error("Enter an HTTPS or SSH Git repository URL without embedded credentials");
  return url.toString();
}
export function repositoryRef(input: string): string {
  const ref = input || "HEAD";
  if (ref.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(ref) || ref.includes("..") || ref.endsWith("/") || ref.includes("//")) throw new Error("Enter a branch, tag or commit ID");
  return ref;
}

/** Fetch objects only: no checkout, repository scripts, hooks, filters or submodules are run. */
export async function fetchGitSnapshot(repository: string, ref: string): Promise<GitSnapshot> {
  const url = repositoryUrl(repository), revision = repositoryRef(ref);
  const directory = await mkdtemp(join(tmpdir(), "paseo-team-git-"));
  try {
    await git(["init", "--bare", "--template=", directory]);
    await git(["--git-dir", directory, "fetch", "--depth=1", "--no-tags", "--", url, revision]);
    return await readGitSnapshot(directory, "FETCH_HEAD");
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error("Could not fetch the Git repository. Check the URL, revision and host Git authentication.");
  }
}
/** Also used with local test repositories; all blob access remains pinned to this resolved commit. */
export async function readGitSnapshot(directory: string, revision: string): Promise<GitSnapshot> {
  const commit = (await git(["--git-dir", directory, "rev-parse", "--verify", `${revision}^{commit}`])).trim();
  const tree = await git(["--git-dir", directory, "ls-tree", "-rz", "--full-tree", commit]);
  const files = new Map<string, { mode: string; oid: string }>();
  for (const item of tree.split("\0").filter(Boolean)) {
    const tab = item.indexOf("\t"), [mode, , oid] = item.slice(0, tab).split(" ");
    files.set(item.slice(tab + 1), { mode, oid });
  }
  return { directory, commit, files };
}
export const gitConfigFiles = (snapshot: GitSnapshot) => [...snapshot.files].filter(([file, entry]) => /^100(644|755)$/.test(entry.mode) && (/(^|\/)team\.(json|ya?ml)$/i.test(file) || /^\.agents\/teams\/[^/]+\.(json|ya?ml)$/i.test(file))).map(([file]) => file).sort();

export function promptImportPath(path: string): string {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").includes("..") || /[\x00-\x1f]/.test(path)) throw new Error(`Invalid Project-relative prompt path: ${path}`);
  const normalized = posix.normalize(path);
  if (normalized === "." || normalized.split("/").some(segment => segment.toLowerCase() === ".git") || /^\.agents\/(\.runtime(?:\/|$)|teams(?:\/|$)|team\.(json|ya?ml)$)/i.test(normalized)) throw new Error(`Reserved prompt destination: ${path}`);
  return normalized;
}
export async function gitBlob(snapshot: GitSnapshot, path: string): Promise<string> {
  const entry = snapshot.files.get(path);
  if (!entry || !/^100(644|755)$/.test(entry.mode)) throw new Error(`Repository file is missing or not a regular file: ${path}`);
  const size = Number((await git(["--git-dir", snapshot.directory, "cat-file", "-s", entry.oid])).trim());
  if (size > 512 * 1024) throw new Error(`Repository file exceeds 512 KiB: ${path}`);
  const text = await git(["--git-dir", snapshot.directory, "cat-file", "blob", entry.oid], 1024 * 1024);
  if (text.includes("\0")) throw new Error(`Repository file is not text: ${path}`);
  return text;
}
export async function extractGitTeam(snapshot: GitSnapshot, configFile: string) {
  if (!isTeamConfigFile(configFile)) throw new Error("Select a JSON or YAML team definition in the repository");
  const source = await gitBlob(snapshot, configFile);
  const team = ResearchTeamSchema.parse(parseTeamConfig(configFile, source));
  const paths = [...new Set([...team.commonPromptFiles, ...team.roles.flatMap(role => role.promptFiles)].map(promptImportPath))];
  if (new Set(paths.map(path => path.normalize("NFC").toLowerCase())).size !== paths.length) throw new Error("Prompt paths collide on case-insensitive filesystems");
  if (paths.length > 100) throw new Error("A repository team may reference at most 100 prompt files");
  const prompts = new Map<string, string>();
  let bytes = Buffer.byteLength(source);
  for (const path of paths) {
    const text = await gitBlob(snapshot, path);
    bytes += Buffer.byteLength(text);
    if (bytes > 4 * 1024 * 1024) throw new Error("Team definition and prompts exceed 4 MiB");
    prompts.set(path, text);
  }
  return { source, team, prompts };
}
