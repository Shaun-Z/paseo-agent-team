import { isMap, isScalar, isSeq, parseDocument, stringify, type Document, type Node } from "yaml";
import { canonical, type ResearchTeam } from "../shared/research-team";

export const isTeamConfigFile = (file: string) => /\.(json|ya?ml)$/i.test(file);
const isJson = (file: string) => /\.json$/i.test(file);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function yamlDocument(source: string) {
  const doc: Document = parseDocument(source, { version: "1.2", uniqueKeys: true, stringKeys: true, resolveKnownTags: false });
  if (doc.errors.length || doc.warnings.length) throw new Error([...doc.errors, ...doc.warnings].map(error => error.message).join("\n"));
  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  // Team definitions, including provider feature values, have JSON data semantics.
  JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Team configuration numbers must be finite");
    return item;
  }); // Also rejects circular alias graphs.
  return { doc, value };
}

export function parseTeamConfig(file: string, source: string): unknown {
  return isJson(file) ? JSON.parse(source) : yamlDocument(source).value;
}

/** Update existing nodes so comments on unchanged fields survive an editor save. */
function updateNode(doc: Document, node: Node | null | undefined, before: unknown, after: unknown): Node {
  if (node && canonical(before) === canonical(after)) return node;
  if (isMap(node) && object(before) && object(after)) {
    for (const key of Object.keys(before)) if (!(key in after)) node.delete(key);
    for (const [key, value] of Object.entries(after)) node.set(key, updateNode(doc, node.get(key, true) as Node | undefined, before[key], value));
    return node;
  }
  if (isSeq(node) && Array.isArray(before) && Array.isArray(after)) {
    const previous = [...node.items];
    const used = new Set<number>();
    node.items = after.map((value, index) => {
      // Role/member identity keeps comments with their owner when reordered.
      const byIdentity = object(value) && typeof value.id === "string";
      const match = before.findIndex((old, i) => !used.has(i) && (byIdentity ? object(old) && old.id === value.id : canonical(old) === canonical(value)));
      const oldIndex = match >= 0 ? match : !byIdentity && !used.has(index) ? index : -1;
      if (oldIndex >= 0) used.add(oldIndex);
      return updateNode(doc, oldIndex >= 0 ? previous[oldIndex] as Node : undefined, before[oldIndex], value);
    });
    return node;
  }
  if (isScalar(node) && (after === null || typeof after !== "object")) { node.value = after; return node; }
  const next = doc.createNode(after);
  if (node) { next.comment = node.comment; next.commentBefore = node.commentBefore; next.spaceBefore = node.spaceBefore; }
  return next;
}

export function serializeTeamConfig(file: string, team: ResearchTeam, source?: string): string {
  if (isJson(file)) return JSON.stringify(team, null, 2) + "\n";
  if (source !== undefined) {
    const { doc, value } = yamlDocument(source);
    if (canonical(value) === canonical(team)) return source;
    doc.contents = updateNode(doc, doc.contents, value, team);
    try {
      const output = doc.toString({ lineWidth: 0 });
      // An edited/removed anchor can affect aliases elsewhere. Never write altered settings.
      if (canonical(parseTeamConfig(file, output)) === canonical(team)) return output;
    } catch { /* Rebuild alias-dependent documents from the validated team below. */ }
  }
  return stringify(team, { lineWidth: 0 });
}
