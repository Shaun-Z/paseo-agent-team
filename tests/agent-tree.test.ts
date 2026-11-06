import { describe, expect, it } from "vitest";
import { agentNode, buildAgentForest, canDismiss, dismissibleIds, formatAgentTitle, isHidden, parentOf, titleParts, type AgentNode, type DashboardAgent } from "../shared/agent-tree";
import { PROVIDER_LOGOS, providerIcon } from "../shared/provider-icons";

const PARENT = "paseo.parent-agent-id";

/** An agent shaped like the client snapshot: the parent only travels in the `paseo.parent-agent-id` label. */
const agent = (id: string, over: Partial<DashboardAgent> = {}): DashboardAgent => ({
  id,
  workspaceId: "wks_a",
  provider: "claude",
  model: "claude-opus-5-5",
  title: null,
  status: "idle",
  currentModeId: "auto",
  thinkingOptionId: null,
  effectiveThinkingOptionId: null,
  labels: {},
  archivedAt: null,
  requiresAttention: false,
  attentionReason: null,
  createdAt: "2026-10-30T00:00:00Z",
  ...over,
});

const child = (id: string, parent: string, over: Partial<DashboardAgent> = {}) => agent(id, { ...over, labels: { ...over.labels, [PARENT]: parent } });
const at = (minute: number) => `2026-10-30T00:${String(minute).padStart(2, "0")}:00Z`;
const ids = (nodes: AgentNode[]) => nodes.map((node) => node.agent.id);
const show = { showClosed: true };
const hide = { showClosed: false };

describe("parentOf", () => {
  it("reads the parent from the label", () => {
    expect(parentOf(child("c", "p"))).toBe("p");
  });

  it("prefers parentAgentId over the label", () => {
    expect(parentOf(child("c", "from-label", { parentAgentId: "from-field" }))).toBe("from-field");
  });

  it("falls back to the label when parentAgentId is null", () => {
    expect(parentOf(child("c", "p", { parentAgentId: null }))).toBe("p");
  });

  it("is undefined without a parent or with an empty one", () => {
    expect(parentOf(agent("c"))).toBeUndefined();
    expect(parentOf(child("c", ""))).toBeUndefined();
  });
});

describe("isHidden", () => {
  it("hides closed and archived agents", () => {
    expect(isHidden(agent("a", { status: "closed" }))).toBe(true);
    expect(isHidden(agent("a", { archivedAt: "2026-10-30T01:00:00Z" }))).toBe(true);
  });

  it("keeps the others", () => {
    for (const status of ["initializing", "idle", "running", "error"]) expect(isHidden(agent("a", { status }))).toBe(false);
  });
});

describe("formatAgentTitle", () => {
  it("separates the hex suffix from the name", () => {
    expect(formatAgentTitle("qa#71C4")).toBe("qa #71C4");
  });

  it("leaves an already separated suffix unchanged", () => {
    expect(formatAgentTitle("qa #71C4")).toBe("qa #71C4");
  });

  it("trims surrounding whitespace", () => {
    expect(formatAgentTitle("  qa#71C4  ")).toBe("qa #71C4");
    expect(formatAgentTitle("  plain  ")).toBe("plain");
  });

  it("leaves a lone suffix unchanged", () => {
    expect(formatAgentTitle("#71C4")).toBe("#71C4");
  });

  it("leaves lowercase, 5-digit and missing suffixes unchanged", () => {
    expect(formatAgentTitle("ui#ad12")).toBe("ui#ad12");
    expect(formatAgentTitle("a#12345")).toBe("a#12345");
    expect(formatAgentTitle("Research image APIs")).toBe("Research image APIs");
  });

  it("is what agentNode shows, while the agent keeps its original title", () => {
    const node = agentNode(agent("a", { title: "qa#71C4" }));
    expect(node.title).toBe("qa #71C4");
    expect(node.agent.title).toBe("qa#71C4");
  });

  it("still falls back to the id prefix for an empty title", () => {
    expect(agentNode(agent("6eebacb4-4e8d", { title: "" })).title).toBe("6eebacb");
    expect(agentNode(agent("6eebacb4-4e8d", { title: "  " })).title).toBe("6eebacb");
  });
});

describe("titleParts", () => {
  it("splits the name from the id suffix", () => {
    expect(titleParts("qa #71C4")).toEqual({ name: "qa", id: "#71C4" });
    expect(titleParts("core #7A3E")).toEqual({ name: "core", id: "#7A3E" });
  });

  it("gives the same parts for a formatted title", () => {
    expect(titleParts(formatAgentTitle("qa#71C4"))).toEqual({ name: "qa", id: "#71C4" });
  });

  it("keeps a name with spaces whole", () => {
    expect(titleParts("Team editor #1A2B")).toEqual({ name: "Team editor", id: "#1A2B" });
  });

  it("returns the title and a null id without a valid suffix", () => {
    for (const title of ["Research image APIs", "ui #ad12", "a #12345", "#71C4"]) {
      expect(titleParts(title)).toEqual({ name: title, id: null });
    }
  });
});

describe("agentNode", () => {
  it("takes the kind from the workspace-agents label first", () => {
    expect(agentNode(agent("a", { labels: { "workspace-agents": "orchestrator", role: "x" } })).kind).toBe("orchestrator");
    expect(agentNode(agent("a", { labels: { "workspace-agents": "planner" } })).kind).toBe("planner");
  });

  it("is a role with a role label, else a plain agent", () => {
    const role = agentNode(agent("a", { labels: { role: "tests" } }));
    expect(role.kind).toBe("role");
    expect(role.role).toBe("tests");
    const plain = agentNode(agent("a"));
    expect(plain.kind).toBe("agent");
    expect(plain.role).toBeNull();
  });

  it("ignores an unknown workspace-agents value", () => {
    expect(agentNode(agent("a", { labels: { "workspace-agents": "other" } })).kind).toBe("agent");
  });

  it("titles with the trimmed title, else the first 7 characters of the id", () => {
    expect(agentNode(agent("6eebacb4-4e8d", { title: "  Orchestrator  " })).title).toBe("Orchestrator");
    expect(agentNode(agent("6eebacb4-4e8d", { title: null })).title).toBe("6eebacb");
    expect(agentNode(agent("6eebacb4-4e8d", { title: "   " })).title).toBe("6eebacb");
  });

  it("passes model and mode through, null when missing", () => {
    const node = agentNode(agent("a", { model: "gpt-6.1-sol", currentModeId: "auto-review" }));
    expect(node.model).toBe("gpt-6.1-sol");
    expect(node.mode).toBe("auto-review");
    const bare = agentNode(agent("a", { model: null, currentModeId: undefined }));
    expect(bare.model).toBeNull();
    expect(bare.mode).toBeNull();
  });

  it("uses the effective thinking option, then the requested one, then null", () => {
    expect(agentNode(agent("a", { effectiveThinkingOptionId: "high", thinkingOptionId: "auto" })).effort).toBe("high");
    expect(agentNode(agent("a", { effectiveThinkingOptionId: null, thinkingOptionId: "auto" })).effort).toBe("auto");
    expect(agentNode(agent("a")).effort).toBeNull();
  });

  it("carries the given children and defaults to none", () => {
    const kid = agentNode(agent("k"));
    expect(agentNode(agent("p"), [kid]).children).toEqual([kid]);
    expect(agentNode(agent("p")).children).toEqual([]);
  });

  describe("badge and live", () => {
    const badge = (over: Partial<DashboardAgent>) => agentNode(agent("a", over)).badge;

    it("is attention for a permission or error request", () => {
      expect(badge({ requiresAttention: true, attentionReason: "permission" })).toBe("attention");
      expect(badge({ requiresAttention: true, attentionReason: "error" })).toBe("attention");
    });

    it("keeps attention over running", () => {
      expect(badge({ status: "running", requiresAttention: true, attentionReason: "permission" })).toBe("attention");
    });

    it("is attention for status error", () => {
      expect(badge({ status: "error" })).toBe("attention");
    });

    it("is running while running", () => {
      expect(badge({ status: "running" })).toBe("running");
    });

    it("is done when finished and waiting for attention", () => {
      expect(badge({ requiresAttention: true, attentionReason: "finished" })).toBe("done");
    });

    it("prefers running over done", () => {
      expect(badge({ status: "running", requiresAttention: true, attentionReason: "finished" })).toBe("running");
    });

    it("is null otherwise", () => {
      expect(badge({})).toBeNull();
      expect(badge({ requiresAttention: false, attentionReason: "finished" })).toBeNull();
      expect(badge({ requiresAttention: false, attentionReason: "permission" })).toBeNull();
      expect(badge({ status: "initializing" })).toBeNull();
    });

    it("is live only while running", () => {
      expect(agentNode(agent("a", { status: "running" })).live).toBe(true);
      expect(agentNode(agent("a", { status: "idle" })).live).toBe(false);
      expect(agentNode(agent("a", { status: "error" })).live).toBe(false);
    });
  });
});

describe("buildAgentForest", () => {
  const scope = ["wks_a", "wks_b"];

  it("nests a child under its parent given by the label", () => {
    const { trees, solo } = buildAgentForest([agent("p"), child("c", "p")], scope, hide);
    expect(ids(trees)).toEqual(["p"]);
    expect(ids(trees[0]!.children)).toEqual(["c"]);
    expect(solo).toEqual([]);
  });

  it("nests a child under its parent given by parentAgentId", () => {
    const { trees } = buildAgentForest([agent("p"), agent("c", { parentAgentId: "p" })], scope, hide);
    expect(ids(trees[0]!.children)).toEqual(["c"]);
  });

  it("builds nodes with agentNode's fields", () => {
    const { trees } = buildAgentForest([agent("p", { labels: { "workspace-agents": "orchestrator" }, title: "Lead" }), child("c", "p", { labels: { role: "tests" } })], scope, hide);
    expect(trees[0]).toMatchObject({ kind: "orchestrator", title: "Lead" });
    expect(trees[0]!.children[0]).toMatchObject({ kind: "role", role: "tests", title: "c" });
  });

  it("only includes agents in the given workspaces", () => {
    const { trees, solo } = buildAgentForest([agent("in"), agent("out", { workspaceId: "wks_other" }), agent("none", { workspaceId: null })], ["wks_a"], hide);
    expect([...ids(trees), ...ids(solo)]).toEqual(["in"]);
  });

  it("returns nothing for an empty scope", () => {
    expect(buildAgentForest([agent("a")], [], hide)).toEqual({ trees: [], solo: [] });
  });

  it("hides closed and archived agents by default", () => {
    const agents = [agent("live"), agent("closed", { status: "closed" }), agent("archived", { archivedAt: "2026-10-30T01:00:00Z" })];
    expect(ids(buildAgentForest(agents, scope, hide).solo)).toEqual(["live"]);
  });

  it("shows them with showClosed", () => {
    const agents = [agent("live", { createdAt: at(3) }), agent("closed", { status: "closed", createdAt: at(2) }), agent("archived", { archivedAt: "2026-10-30T01:00:00Z", createdAt: at(1) })];
    expect(ids(buildAgentForest(agents, scope, show).solo)).toEqual(["live", "closed", "archived"]);
  });

  it("promotes a child whose parent is hidden to a root", () => {
    const agents = [agent("p", { status: "closed" }), child("c", "p")];
    const hidden = buildAgentForest(agents, scope, hide);
    expect(hidden.trees).toEqual([]);
    expect(ids(hidden.solo)).toEqual(["c"]);
    const shown = buildAgentForest(agents, scope, show);
    expect(ids(shown.trees)).toEqual(["p"]);
    expect(ids(shown.trees[0]!.children)).toEqual(["c"]);
  });

  it("promotes a child whose parent is out of scope or unknown to a root", () => {
    const agents = [agent("p", { workspaceId: "wks_other" }), child("c", "p"), child("orphan", "missing")];
    const { trees, solo } = buildAgentForest(agents, ["wks_a"], hide);
    expect(trees).toEqual([]);
    expect(ids(solo).sort()).toEqual(["c", "orphan"]);
  });

  it("nests across several levels without a depth limit", () => {
    const chain = [agent("l0")];
    for (let level = 1; level <= 6; level += 1) chain.push(child(`l${level}`, `l${level - 1}`));
    const { trees } = buildAgentForest(chain, scope, hide);
    let node = trees[0]!;
    for (let level = 1; level <= 6; level += 1) {
      expect(ids(node.children)).toEqual([`l${level}`]);
      node = node.children[0]!;
    }
    expect(node.children).toEqual([]);
  });

  it("nests siblings and grandchildren together", () => {
    const agents = [agent("p"), child("a", "p", { createdAt: at(1), labels: { role: "a" } }), child("b", "p", { createdAt: at(2), labels: { role: "b" } }), child("a1", "a")];
    const { trees } = buildAgentForest(agents, scope, hide);
    expect(ids(trees[0]!.children)).toEqual(["a", "b"]);
    expect(ids(trees[0]!.children[0]!.children)).toEqual(["a1"]);
  });

  it("does not loop on a cycle and makes a root of it", () => {
    const { trees, solo } = buildAgentForest([child("a", "b"), child("b", "a")], scope, hide);
    const all = [...trees, ...solo];
    expect(all.length).toBeGreaterThanOrEqual(1);
    const seen: string[] = [];
    const walk = (node: AgentNode) => {
      seen.push(node.agent.id);
      node.children.forEach(walk);
    };
    all.forEach(walk);
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("makes a root of an agent that is its own parent", () => {
    const { trees, solo } = buildAgentForest([child("a", "a")], scope, hide);
    expect(trees).toEqual([]);
    expect(ids(solo)).toEqual(["a"]);
  });

  it("splits roots with children into trees and the rest into solo", () => {
    const { trees, solo } = buildAgentForest([agent("p"), child("c", "p"), agent("alone")], scope, hide);
    expect(ids(trees)).toEqual(["p"]);
    expect(ids(solo)).toEqual(["alone"]);
  });

  describe("order", () => {
    it("puts orchestrator roots first, then the rest by createdAt descending", () => {
      const agents = [
        agent("old", { createdAt: at(1) }),
        child("old-kid", "old"),
        agent("new", { createdAt: at(9) }),
        child("new-kid", "new"),
        agent("lead", { createdAt: at(0), labels: { "workspace-agents": "orchestrator" } }),
        child("lead-kid", "lead"),
      ];
      expect(ids(buildAgentForest(agents, scope, hide).trees)).toEqual(["lead", "new", "old"]);
    });

    it("orders several orchestrators by createdAt descending", () => {
      const lead = (id: string, minute: number) => agent(id, { createdAt: at(minute), labels: { "workspace-agents": "orchestrator" } });
      const agents = [lead("l1", 1), child("k1", "l1"), lead("l2", 5), child("k2", "l2")];
      expect(ids(buildAgentForest(agents, scope, hide).trees)).toEqual(["l2", "l1"]);
    });

    it("orders children by createdAt ascending", () => {
      const agents = [agent("p"), child("late", "p", { createdAt: at(8) }), child("early", "p", { createdAt: at(2) }), child("mid", "p", { createdAt: at(5) })];
      expect(ids(buildAgentForest(agents, scope, show).trees[0]!.children)).toEqual(["early", "mid", "late"]);
    });

    it("orders solo agents by createdAt descending", () => {
      const agents = [agent("a", { createdAt: at(1) }), agent("c", { createdAt: at(3) }), agent("b", { createdAt: at(2) })];
      expect(ids(buildAgentForest(agents, scope, hide).solo)).toEqual(["c", "b", "a"]);
    });
  });
});

describe("delegating", () => {
  const scope = ["wks_a"];
  const running = { status: "running" };
  const forest = (agents: DashboardAgent[]) => buildAgentForest(agents, scope, { showClosed: false });

  it("is true for an idle parent with a running child", () => {
    const { trees } = forest([agent("p"), child("c", "p", running)]);
    expect(trees[0]!.live).toBe(false);
    expect(trees[0]!.delegating).toBe(true);
  });

  it("is false for a running parent, even with a running child", () => {
    const { trees } = forest([agent("p", running), child("c", "p", running)]);
    expect(trees[0]!.live).toBe(true);
    expect(trees[0]!.delegating).toBe(false);
  });

  it("is true for every idle ancestor of a running descendant", () => {
    const { trees } = forest([agent("gp"), child("p", "gp"), child("c", "p", running)]);
    const parent = trees[0]!.children[0]!;
    expect(trees[0]!.delegating).toBe(true);
    expect(parent.delegating).toBe(true);
    expect(parent.children[0]!.delegating).toBe(false);
  });

  it("stops at a running ancestor but still marks the idle ones above it", () => {
    const { trees } = forest([agent("gp"), child("p", "gp", running), child("c", "p", running)]);
    expect(trees[0]!.delegating).toBe(true);
    expect(trees[0]!.children[0]!.delegating).toBe(false);
  });

  it("is false when no descendant is running", () => {
    const { trees } = forest([agent("p"), child("c", "p"), child("d", "c", { status: "error" })]);
    expect(trees[0]!.delegating).toBe(false);
    expect(trees[0]!.children[0]!.delegating).toBe(false);
  });

  it("is false for solo nodes", () => {
    const { solo } = forest([agent("a"), agent("b", running)]);
    expect(solo.map((node) => node.delegating)).toEqual([false, false]);
  });

  it("is computed by agentNode from the given children", () => {
    const live = agentNode(agent("c", running));
    const idle = agentNode(agent("c"));
    expect(agentNode(agent("p"), [live]).delegating).toBe(true);
    expect(agentNode(agent("p"), [agentNode(agent("m"), [live])]).delegating).toBe(true);
    expect(agentNode(agent("p"), [idle]).delegating).toBe(false);
    expect(agentNode(agent("p", running), [live]).delegating).toBe(false);
    expect(agentNode(agent("p")).delegating).toBe(false);
  });
});

describe("default effort", () => {
  const scope = ["wks_a"];
  const defaultEfforts = { "claude/claude-opus-5-5": "high" };
  const forest = (agents: DashboardAgent[], efforts: Record<string, string> | undefined = defaultEfforts) => buildAgentForest(agents, scope, { showClosed: false, defaultEfforts: efforts });

  it("fills an empty effort with the provider/model default and flags it", () => {
    const { solo } = forest([agent("a")]);
    expect(solo[0]!.effort).toBe("high");
    expect(solo[0]!.effortDefault).toBe(true);
  });

  it("keeps an explicit thinkingOptionId", () => {
    const { solo } = forest([agent("a", { thinkingOptionId: "low" })]);
    expect(solo[0]!.effort).toBe("low");
    expect(solo[0]!.effortDefault).toBe(false);
  });

  it("keeps an explicit effectiveThinkingOptionId", () => {
    const { solo } = forest([agent("a", { effectiveThinkingOptionId: "medium", thinkingOptionId: "low" })]);
    expect(solo[0]!.effort).toBe("medium");
    expect(solo[0]!.effortDefault).toBe(false);
  });

  it("leaves effort null when no default matches the provider/model", () => {
    const { solo } = forest([agent("a", { model: "other" }), agent("b", { provider: "codex" }), agent("c", { model: null })]);
    for (const node of solo) {
      expect(node.effort).toBeNull();
      expect(node.effortDefault).toBe(false);
    }
  });

  it("leaves effort null without any defaults", () => {
    expect(forest([agent("a")], {}).solo[0]).toMatchObject({ effort: null, effortDefault: false });
    expect(buildAgentForest([agent("a")], scope, { showClosed: false }).solo[0]).toMatchObject({ effort: null, effortDefault: false });
  });

  it("applies at every depth of the tree", () => {
    const { trees } = forest([agent("p"), child("c", "p"), child("g", "c", { thinkingOptionId: "low", labels: { role: "x" } }), child("h", "c", { labels: { role: "y" } })]);
    const mid = trees[0]!.children[0]!;
    expect(trees[0]).toMatchObject({ effort: "high", effortDefault: true });
    expect(mid).toMatchObject({ effort: "high", effortDefault: true });
    const [explicit, filled] = mid.children;
    expect(explicit).toMatchObject({ effort: "low", effortDefault: false });
    expect(filled).toMatchObject({ effort: "high", effortDefault: true });
  });

  it("looks each agent up by its own provider/model", () => {
    const efforts = { "claude/claude-opus-5-5": "high", "codex/gpt-6.1-sol": "xhigh" };
    const { trees } = forest([agent("p"), child("c", "p", { provider: "codex", model: "gpt-6.1-sol" })], efforts);
    expect(trees[0]!.effort).toBe("high");
    expect(trees[0]!.children[0]!.effort).toBe("xhigh");
  });

  it("does not change agentNode called on its own", () => {
    expect(agentNode(agent("a"))).toMatchObject({ effort: null, effortDefault: false });
  });
});

describe("PROVIDER_LOGOS", () => {
  it.each(["claude", "codex", "copilot"])("has an inline svg for %s", (provider) => {
    const svg = PROVIDER_LOGOS[provider];
    expect(svg).toBeDefined();
    expect(svg!.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    expect(svg).not.toMatch(/<script|href=|xlink:|https?:/i);
  });
});

describe("providerIcon", () => {
  it("uses the built-in logo first", () => {
    expect(providerIcon("claude", "<svg>snapshot</svg>")).toEqual({ kind: "svg", svg: PROVIDER_LOGOS.claude });
    expect(providerIcon("codex")).toEqual({ kind: "svg", svg: PROVIDER_LOGOS.codex });
  });

  it("falls back to the snapshot svg", () => {
    expect(providerIcon("antigravity", "<svg>snapshot</svg>")).toEqual({ kind: "svg", svg: "<svg>snapshot</svg>" });
  });

  it("falls back to the uppercased first letter", () => {
    expect(providerIcon("antigravity")).toEqual({ kind: "letter", letter: "A" });
    expect(providerIcon("omp", null)).toEqual({ kind: "letter", letter: "O" });
    expect(providerIcon("omp", "")).toEqual({ kind: "letter", letter: "O" });
  });

  it("uses ? for an empty provider", () => {
    expect(providerIcon("")).toEqual({ kind: "letter", letter: "?" });
  });
});

describe("buildAgentForest with a roster", () => {
  const LABEL = "workspace-agents";
  const orchestrator = (id: string, over: Partial<DashboardAgent> = {}) => agent(id, { ...over, labels: { [LABEL]: "orchestrator", ...over.labels } });
  const roster = [{
    orchestratorWorkspaceId: "wks_a",
    roles: [
      { name: "builder", provider: "codex", model: "gpt-6.1-sol", workspaceId: "wks_a" },
      { name: "tester", provider: "antigravity", model: "gemini-4-argon-medium", workspaceId: "wks_a" },
    ],
  }];
  const waiting = (node: AgentNode) => node.children.filter((kid) => kid.waiting).map((kid) => kid.role);

  it("adds a waiting node for every role without a session, after the real children", () => {
    const forest = buildAgentForest([orchestrator("o"), child("x", "o", { labels: { role: "other" } })], ["wks_a", "wks_b"], { ...hide, roster });
    expect(forest.trees[0]!.children.map((kid) => kid.waiting ? `waiting:${kid.role}` : kid.agent.id)).toEqual(["x", "waiting:builder", "waiting:tester"]);
    const tester = forest.trees[0]!.children[2]!;
    expect(tester).toMatchObject({ kind: "role", title: "tester", model: "gemini-4-argon-medium", live: false, badge: null });
    expect(tester.agent.provider).toBe("antigravity");
  });

  it("lifts an orchestrator whose only children are waiting roles into the trees", () => {
    const forest = buildAgentForest([orchestrator("o")], ["wks_a", "wks_b"], { ...hide, roster });
    expect(ids(forest.trees)).toEqual(["o"]);
    expect(forest.solo).toEqual([]);
  });

  it("hides a role's waiting node when a shown agent in the team's workspace has its label, whoever started it", () => {
    const forest = buildAgentForest([orchestrator("o"), agent("t", { workspaceId: "wks_a", labels: { role: "tester" } })], ["wks_a", "wks_b"], { ...hide, roster });
    expect(waiting(forest.trees[0]!)).toEqual(["builder"]);
  });

  it("ignores a role session in another workspace", () => {
    const forest = buildAgentForest([orchestrator("o"), agent("t", { workspaceId: "wks_b", labels: { role: "tester" } })], ["wks_a", "wks_b"], { ...hide, roster });
    expect(waiting(forest.trees[0]!)).toEqual(["builder", "tester"]);
  });

  it("shows the waiting node again when the role's only session is archived and hidden", () => {
    const agents = [orchestrator("o"), child("b", "o", { labels: { role: "builder" }, archivedAt: "2026-10-30T01:00:00Z" })];
    expect(waiting(buildAgentForest(agents, ["wks_a", "wks_b"], { ...hide, roster }).trees[0]!)).toEqual(["builder", "tester"]);
    expect(waiting(buildAgentForest(agents, ["wks_a", "wks_b"], { ...show, roster }).trees[0]!)).toEqual(["tester"]);
  });

  it("puts the waiting nodes under the newest shown orchestrator only", () => {
    const forest = buildAgentForest([orchestrator("old", { createdAt: at(1) }), orchestrator("new", { createdAt: at(2) })], ["wks_a", "wks_b"], { ...hide, roster });
    expect(ids(forest.trees)).toEqual(["new"]);
    expect(ids(forest.solo)).toEqual(["old"]);
  });

  it("adds nothing when the team's workspace has no shown orchestrator", () => {
    const forest = buildAgentForest([agent("plain"), orchestrator("gone", { status: "closed" })], ["wks_a", "wks_b"], { ...hide, roster });
    expect(forest.trees).toEqual([]);
    expect(ids(forest.solo)).toEqual(["plain"]);
  });

  describe("role sessions whose parent is not shown", () => {
    const role = (id: string, over: Partial<DashboardAgent> = {}) => agent(id, { ...over, labels: { role: "builder", ...over.labels } });
    const scope = ["wks_a", "wks_b"];

    it("moves under the newest shown orchestrator when the parent is archived and hidden", () => {
      const agents = [orchestrator("old", { createdAt: at(1), archivedAt: "2026-10-30T01:00:00Z" }), orchestrator("new", { createdAt: at(2) }), role("b", { labels: { [PARENT]: "old" }, createdAt: at(1) })];
      const forest = buildAgentForest(agents, scope, { ...hide, roster });
      expect(ids(forest.trees)).toEqual(["new"]);
      expect(ids(forest.trees[0]!.children.filter((kid) => !kid.waiting))).toEqual(["b"]);
      expect(forest.solo).toEqual([]);
    });

    it("keeps a session whose parent is shown where it is", () => {
      const agents = [orchestrator("old", { createdAt: at(1) }), orchestrator("new", { createdAt: at(2) }), role("b", { labels: { [PARENT]: "old" } })];
      const forest = buildAgentForest(agents, scope, { ...hide, roster });
      expect(ids(forest.trees.find((tree) => tree.agent.id === "old")!.children)).toEqual(["b"]);
      expect(ids(forest.trees.find((tree) => tree.agent.id === "new")?.children.filter((kid) => !kid.waiting) ?? [])).toEqual([]);
    });

    it("keeps a session that has no parent at all", () => {
      const forest = buildAgentForest([orchestrator("o"), role("b")], scope, { ...hide, roster });
      expect(ids(forest.solo)).toEqual(["b"]);
    });

    it("does not move a session outside the team's workspaces", () => {
      const agents = [orchestrator("o"), role("x", { workspaceId: "wks_c", labels: { [PARENT]: "gone" } })];
      const forest = buildAgentForest(agents, ["wks_a", "wks_b", "wks_c"], { ...hide, roster });
      expect(ids(forest.solo)).toEqual(["x"]);
    });

    it("does not move a session without a role label", () => {
      const forest = buildAgentForest([orchestrator("o"), agent("p", { labels: { [PARENT]: "gone" } })], scope, { ...hide, roster });
      expect(ids(forest.solo)).toEqual(["p"]);
    });

    it("stays a root without an orchestrator, and without a roster", () => {
      const agents = [role("b", { labels: { [PARENT]: "gone" } })];
      expect(ids(buildAgentForest(agents, scope, { ...hide, roster }).solo)).toEqual(["b"]);
      expect(ids(buildAgentForest([orchestrator("o"), ...agents], scope, hide).solo).sort()).toEqual(["b", "o"]);
    });
  });
});

describe("buildAgentForest without showClosed keeps the newest idle child per type", () => {
  const scope = ["wks_a"];
  const role = (name: string) => ({ role: name });
  const forest = (agents: DashboardAgent[]) => buildAgentForest(agents, scope, hide);
  const kids = (agents: DashboardAgent[]) => ids(forest(agents).trees[0]?.children ?? []);

  it("collapses idle children of one role to the newest", () => {
    const agents = [agent("p"), child("old", "p", { labels: role("qa"), createdAt: at(1) }), child("new", "p", { labels: role("qa"), createdAt: at(3) }), child("mid", "p", { labels: role("qa"), createdAt: at(2) })];
    expect(kids(agents)).toEqual(["new"]);
  });

  it("keeps the newest of each different role", () => {
    const agents = [
      agent("p"),
      child("qa1", "p", { labels: role("qa"), createdAt: at(1) }),
      child("qa2", "p", { labels: role("qa"), createdAt: at(2) }),
      child("ui1", "p", { labels: role("ui"), createdAt: at(3) }),
      child("ui2", "p", { labels: role("ui"), createdAt: at(4) }),
    ];
    expect(kids(agents)).toEqual(["qa2", "ui2"]);
  });

  it("keeps running children and children needing attention next to the newest idle one", () => {
    const agents = [
      agent("p"),
      child("idle-old", "p", { labels: role("qa"), createdAt: at(1) }),
      child("run", "p", { labels: role("qa"), createdAt: at(2), status: "running" }),
      child("perm", "p", { labels: role("qa"), createdAt: at(3), requiresAttention: true, attentionReason: "permission" }),
      child("err", "p", { labels: role("qa"), createdAt: at(4), requiresAttention: true, attentionReason: "error" }),
      child("idle-new", "p", { labels: role("qa"), createdAt: at(5) }),
    ];
    expect(kids(agents)).toEqual(["run", "perm", "err", "idle-new"]);
  });

  it("counts a done-badge child as idle", () => {
    const done = { requiresAttention: true, attentionReason: "finished" };
    const agents = [agent("p"), child("done-old", "p", { ...done, labels: role("qa"), createdAt: at(1) }), child("done-new", "p", { ...done, labels: role("qa"), createdAt: at(2) }), child("idle", "p", { labels: role("qa"), createdAt: at(3) })];
    expect(agentNode(agents[1]!).badge).toBe("done");
    expect(kids(agents)).toEqual(["idle"]);
  });

  it("keeps an idle child with a running grandchild, and the chain to it", () => {
    const agents = [
      agent("p"),
      child("old", "p", { labels: role("qa"), createdAt: at(1) }),
      child("run", "old", { status: "running" }),
      child("new", "p", { labels: role("qa"), createdAt: at(2) }),
    ];
    const tree = forest(agents).trees[0]!;
    expect(ids(tree.children)).toEqual(["old", "new"]);
    expect(ids(tree.children[0]!.children)).toEqual(["run"]);
    expect(tree.children[0]!.delegating).toBe(true);
  });

  it("drops the subtree of a dropped idle child", () => {
    const agents = [
      agent("p"),
      child("old", "p", { labels: role("qa"), createdAt: at(1) }),
      child("old-kid", "old", { createdAt: at(1) }),
      child("new", "p", { labels: role("qa"), createdAt: at(2) }),
    ];
    const result = forest(agents);
    expect(ids(result.trees[0]!.children)).toEqual(["new"]);
    const all = [...result.trees, ...result.solo];
    expect(all.some((node) => ids(node.children).includes("old-kid") || node.agent.id === "old-kid")).toBe(false);
  });

  it("competes plain agents by kind and sub-agents by their type", () => {
    const sub = (id: string, subagentType: string, minute: number) => child(id, "p", { subagent: true, subagentType, createdAt: at(minute), archivedAt: at(minute) });
    const agents = [agent("p"), sub("s1", "explore", 1), sub("s2", "explore", 2), sub("s3", "plan", 3)];
    expect(kids(agents)).toEqual(["s2", "s3"]);
  });

  it("promotes orphans of an archived parent and filters them per original parent", () => {
    const archived = { archivedAt: "2026-10-30T01:00:00Z" };
    const agents = [
      agent("gone1", archived),
      agent("gone2", archived),
      child("a-old", "gone1", { labels: role("qa"), createdAt: at(1) }),
      child("a-new", "gone1", { labels: role("qa"), createdAt: at(2) }),
      child("b-old", "gone2", { labels: role("qa"), createdAt: at(3) }),
      child("run", "gone1", { labels: role("qa"), createdAt: at(0), status: "running" }),
    ];
    const result = forest(agents);
    expect(result.trees).toEqual([]);
    expect(ids(result.solo).sort()).toEqual(["a-new", "b-old", "run"]);
  });

  it("always shows a running orphan", () => {
    const agents = [agent("gone", { status: "closed" }), child("run", "gone", { status: "running", createdAt: at(1) }), child("newer", "gone", { createdAt: at(2) })];
    expect(ids(forest(agents).solo).sort()).toEqual(["newer", "run"]);
  });

  it("keeps roots with no parent even when idle", () => {
    const agents = [agent("a", { createdAt: at(1) }), agent("b", { createdAt: at(2) }), agent("c", { createdAt: at(3), labels: role("qa") }), agent("d", { createdAt: at(4), labels: role("qa") })];
    expect(ids(forest(agents).solo)).toEqual(["d", "c", "b", "a"]);
  });

  it("shows everything with showClosed", () => {
    const agents = [agent("p"), child("old", "p", { labels: role("qa"), createdAt: at(1) }), child("new", "p", { labels: role("qa"), createdAt: at(2) }), child("old-kid", "old")];
    const tree = buildAgentForest(agents, scope, show).trees[0]!;
    expect(ids(tree.children)).toEqual(["old", "new"]);
    expect(ids(tree.children[0]!.children)).toEqual(["old-kid"]);
  });
});

describe("dismissed agents", () => {
  const scope = ["wks_a"];
  const allIds = (options: { showClosed: boolean; dismissed?: string[]; roster?: Parameters<typeof buildAgentForest>[2]["roster"] }, agents: DashboardAgent[]) => {
    const { trees, solo } = buildAgentForest(agents, scope, options);
    const seen: string[] = [];
    const walk = (node: AgentNode) => {
      seen.push(node.agent.id);
      node.children.forEach(walk);
    };
    [...trees, ...solo].forEach(walk);
    return seen.sort();
  };
  const agents = [
    agent("p"),
    child("a", "p", { labels: { role: "a" } }),
    child("a1", "a", { labels: { role: "x" } }),
    child("a2", "a1", { status: "running" }),
    child("sub", "a", { subagent: true, subagentType: "explore", archivedAt: at(1) }),
    child("b", "p", { labels: { role: "b" } }),
  ];

  it("leaves a dismissed agent out with showClosed true and false", () => {
    for (const showClosed of [true, false]) {
      expect(allIds({ showClosed, dismissed: ["b"] }, agents)).not.toContain("b");
      expect(allIds({ showClosed, dismissed: ["b"] }, agents)).toContain("a");
    }
  });

  it("drops its children, grandchildren and provider sub-agents without promoting them to roots", () => {
    for (const showClosed of [true, false]) {
      const result = buildAgentForest(agents, scope, { showClosed, dismissed: ["a"] });
      expect(allIds({ showClosed, dismissed: ["a"] }, agents)).toEqual(["b", "p"]);
      expect([...ids(result.trees), ...ids(result.solo)]).toEqual(["p"]);
    }
  });

  it("changes nothing when the dismissed id is not present", () => {
    for (const showClosed of [true, false]) {
      expect(buildAgentForest(agents, scope, { showClosed, dismissed: ["nope"] })).toEqual(buildAgentForest(agents, scope, { showClosed }));
      expect(buildAgentForest(agents, scope, { showClosed, dismissed: [] })).toEqual(buildAgentForest(agents, scope, { showClosed }));
    }
  });

  it("leaves waiting roster nodes unaffected", () => {
    const LABEL = "workspace-agents";
    const roster = [{ orchestratorWorkspaceId: "wks_a", roles: [{ name: "builder", provider: "codex", model: "m", workspaceId: "wks_a" }] }];
    const lead = agent("o", { labels: { [LABEL]: "orchestrator" } });
    const withRoster = (dismissed: string[]) => buildAgentForest([lead, child("x", "o", { labels: { role: "other" } })], scope, { showClosed: false, roster, dismissed });
    const waitingRoles = (forest: ReturnType<typeof buildAgentForest>) => forest.trees[0]!.children.filter((kid) => kid.waiting).map((kid) => kid.role);
    expect(waitingRoles(withRoster([]))).toEqual(["builder"]);
    expect(waitingRoles(withRoster(["x"]))).toEqual(["builder"]);
    expect(ids(withRoster(["x"]).trees[0]!.children)).toEqual(["waiting:o:builder"]);
  });
});

describe("canDismiss", () => {
  const node = (over: Partial<DashboardAgent>, children: AgentNode[] = []) => agentNode(agent("n", over), children);

  it("is true for a closed agent, an archived agent and a finished provider sub-agent", () => {
    expect(canDismiss(node({ status: "closed" }))).toBe(true);
    expect(canDismiss(node({ archivedAt: "2026-10-30T01:00:00Z" }))).toBe(true);
    expect(canDismiss(node({ subagent: true, archivedAt: at(1) }))).toBe(true);
    expect(canDismiss(node({ subagent: true, status: "idle", archivedAt: null }))).toBe(true);
  });

  it("is false for a running node", () => {
    expect(canDismiss(node({ status: "running" }))).toBe(false);
    expect(canDismiss(node({ status: "running", archivedAt: "2026-10-30T01:00:00Z" }))).toBe(false);
    expect(canDismiss(node({ subagent: true, status: "running" }))).toBe(false);
  });

  it("is false for a node with a running descendant", () => {
    const running = agentNode(agent("r", { status: "running" }));
    const closed = node({ status: "closed" }, [running]);
    expect(closed.delegating).toBe(true);
    expect(canDismiss(closed)).toBe(false);
  });

  it("is false for a permission or error attention node", () => {
    expect(canDismiss(node({ status: "closed", requiresAttention: true, attentionReason: "permission" }))).toBe(false);
    expect(canDismiss(node({ archivedAt: at(1), requiresAttention: true, attentionReason: "error" }))).toBe(false);
    expect(canDismiss(node({ status: "error" }))).toBe(false);
  });

  it("is false for a waiting node", () => {
    const roster = [{ orchestratorWorkspaceId: "wks_a", roles: [{ name: "builder", provider: "codex", model: "m", workspaceId: "wks_a" }] }];
    const { trees } = buildAgentForest([agent("o", { labels: { "workspace-agents": "orchestrator" } })], ["wks_a"], { showClosed: false, roster });
    const waiting = trees[0]!.children[0]!;
    expect(waiting.waiting).toBe(true);
    expect(canDismiss(waiting)).toBe(false);
  });

  it("is false for an idle agent that is not closed", () => {
    expect(canDismiss(node({}))).toBe(false);
    expect(canDismiss(node({ requiresAttention: true, attentionReason: "finished" }))).toBe(false);
  });
});

describe("dismissibleIds", () => {
  const scope = ["wks_a"];
  const LABEL = "workspace-agents";
  const roster = [{ orchestratorWorkspaceId: "wks_a", roles: [{ name: "builder", provider: "codex", model: "m", workspaceId: "wks_a" }] }];
  const archivedAt = "2026-10-30T01:00:00Z";
  const agents = [
    agent("o", { labels: { [LABEL]: "orchestrator" }, createdAt: at(50) }),
    agent("p", { createdAt: at(10) }),
    child("closed", "p", { status: "closed", labels: { role: "c" }, createdAt: at(1) }),
    child("deep", "closed", { archivedAt, labels: { role: "d" } }),
    child("sub", "p", { subagent: true, subagentType: "explore", archivedAt, createdAt: at(2) }),
    child("run", "p", { status: "running", labels: { role: "r" }, createdAt: at(3) }),
    child("deleg", "p", { status: "closed", labels: { role: "g" }, createdAt: at(4) }),
    child("deleg-run", "deleg", { status: "running" }),
    child("attn", "p", { archivedAt, requiresAttention: true, attentionReason: "permission", labels: { role: "a" }, createdAt: at(5) }),
    child("idle", "p", { labels: { role: "i" }, createdAt: at(6) }),
    agent("solo-closed", { status: "closed", createdAt: at(20) }),
    agent("solo-live", { createdAt: at(21) }),
  ];
  const forest = buildAgentForest(agents, scope, { showClosed: true, roster });

  it("returns closed, archived and finished sub-agent ids from trees and solo, at any depth", () => {
    expect(forest.solo.map((node) => node.agent.id)).toContain("solo-closed");
    expect(dismissibleIds(forest).sort()).toEqual(["closed", "deep", "solo-closed", "sub"]);
  });

  it("excludes running, delegating, attention, waiting and idle nodes", () => {
    const result = dismissibleIds(forest);
    for (const id of ["run", "deleg", "deleg-run", "attn", "idle", "solo-live", "p", "o"]) expect(result).not.toContain(id);
    expect(result.some((id) => id.startsWith("waiting:"))).toBe(false);
  });

  it("has no duplicates", () => {
    const result = dismissibleIds(forest);
    expect(new Set(result).size).toBe(result.length);
  });

  it("gives [] for an empty forest", () => {
    expect(dismissibleIds({ trees: [], solo: [] })).toEqual([]);
    expect(dismissibleIds(buildAgentForest([], scope, { showClosed: true }))).toEqual([]);
  });

  it("leaves no dismissible node when the forest is built again with them dismissed and showClosed true", () => {
    const again = buildAgentForest(agents, scope, { showClosed: true, roster, dismissed: dismissibleIds(forest) });
    const remaining: string[] = [];
    const visit = (node: AgentNode) => {
      if (canDismiss(node)) remaining.push(node.agent.id);
      node.children.forEach(visit);
    };
    [...again.trees, ...again.solo].forEach(visit);
    expect(remaining).toEqual([]);
    expect(dismissibleIds(again)).toEqual([]);
  });
});
