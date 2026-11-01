import type { Role } from "./team";
import type { ProviderInfo } from "./validate";

export function parseFolders(text: string): string[] {
  return text
    .split(",")
    .map((folder) => folder.trim())
    .filter(Boolean);
}

export function foldersText(folders: readonly string[]): string {
  return folders.join(", ");
}

export function uniqueName(base: string, taken: readonly string[]): string {
  base = base.trim();
  const names = new Set(taken.map((name) => name.trim().toLowerCase()));
  let name = base;
  while (names.has(name.toLowerCase())) name = `${base}#${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0").toUpperCase()}`;
  return name;
}

/** A blank role on the first ready provider, with a unique name, sharing the orchestrator's workspace. */
export function newRole(catalog: readonly ProviderInfo[], takenNames: readonly string[]): Role {
  const provider = catalog.find((entry) => entry.ready);
  return { name: uniqueName("role", takenNames), workspace: "", provider: provider?.id ?? "", model: provider?.models[0]?.id ?? "", folders: [], instructions: "" };
}
