import { describe, expect, it } from "vitest";
import { canonical, launchFromProfile, messageEdges, ResearchTeamSchema } from "../shared/research-team";
import { graphLine, memberGraph } from "../shared/member-graph";

import { teamFixture } from "./fixtures/research";
describe("research team identity", () => {
  it("allows multiple members of one role and rejects broken member/role references", () => {
    const team = teamFixture();
    expect(team.members.filter(m => m.roleId === "programmer")).toHaveLength(2);
    expect(ResearchTeamSchema.safeParse({ ...team, members: [...team.members, team.members[0]] }).success).toBe(false);
    expect(ResearchTeamSchema.safeParse({ ...team, orchestratorMemberId: "absent" }).success).toBe(false);
    expect(ResearchTeamSchema.safeParse({ ...team, members: [{ ...team.members[0], roleId: "absent" }] }).success).toBe(false);
    expect(ResearchTeamSchema.safeParse({ ...team, id: "../../other" }).success).toBe(false);
  });
  it("preserves explicit Profile settings, including false feature values, without inferring modes", () => {
    expect(launchFromProfile({ id: "p", name: "P", provider: "pi", model: "vendor/model", featureValues: { toggle: false } })).toEqual({ provider: "pi", model: "vendor/model", featureValues: { toggle: false } });
    expect(canonical({ b: 2, a: { b: false, a: 1 } })).toBe(canonical({ a: { a: 1, b: false }, b: 2 }));
    expect(JSON.parse(canonical({ b: 2, a: 1 }))).toEqual({ a: 1, b: 2 });
  });
  it("accepts additional user-defined roles without a built-in role enumeration", () => {
    const team = teamFixture();
    expect(ResearchTeamSchema.parse({ ...team, roles: [...team.roles, { id: "reviewer", name: "Reviewer", promptFiles: [".prompts/review.md"] }], members: [...team.members, { ...team.members[0], id: "review", roleId: "reviewer" }] }).members).toHaveLength(4);
  });
});
describe("observed member communication", () => {
  it("deduplicates timeline pages, ignores callbacks and preserves identities across session reset", () => {
    const message = { seq: 1, item: { callId: "delivery-1", agentMessage: { event: "message", sender: { id: "old-a" }, text: "curated result" } } };
    const finished = { seq: 2, item: { callId: "callback", agentMessage: { event: "finished", sender: { id: "old-a" }, text: "raw final" } } };
    expect(messageEdges([{ recipient: "lead-agent", entries: [message, finished] }, { recipient: "lead-agent", entries: [message] }], new Map([["old-a", "coder-a"], ["new-a", "coder-a"], ["lead-agent", "lead"]]))).toEqual([{ from: "coder-a", to: "lead", count: 1, lastText: "curated result" }]);
  });
});
describe("member graph layout", () => {
  it("keeps same-role members separately addressable and clips arrows to card boundaries", () => {
    const graph = memberGraph(["lead", "coder-a", "coder-b", "review"], "lead");
    expect(graph.nodes.size).toBe(4);
    expect(graph.nodes.get("coder-a")).not.toEqual(graph.nodes.get("coder-b"));
    const a = graph.nodes.get("coder-a")!, b = graph.nodes.get("coder-b")!;
    const edge = graphLine(a, b)!;
    expect(edge.x).toBe(a.x + a.width);
    expect(edge.endX).toBe(b.x);
    expect(edge.length).toBeGreaterThan(0);
  });
});
