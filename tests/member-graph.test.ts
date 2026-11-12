import { describe, expect, it } from "vitest";
import { memberCommunicationGraph } from "../shared/member-graph";

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const example = [
  { from: "anchor", to: "programmer", count: 8 }, { from: "programmer", to: "anchor", count: 3 },
  { from: "anchor", to: "mathematician", count: 6 }, { from: "mathematician", to: "anchor", count: 4 },
  { from: "programmer", to: "mathematician", count: 118 }, { from: "mathematician", to: "programmer", count: 86 },
];
function intersectsCard(a: Point, b: Point, card: Rect) {
  let low = 0, high = 1;
  for (const axis of ["x", "y"] as const) {
    const min = card[axis] + 0.01, max = card[axis] + (axis === "x" ? card.width : card.height) - 0.01;
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 0.0001) { if (a[axis] < min || a[axis] > max) return false; }
    else {
      const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
      low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
    }
  }
  return low <= high;
}
function assertClear(graph: ReturnType<typeof memberCommunicationGraph>) {
  const labels = graph.connections.flatMap(edge => edge.label ? [edge.label] : []);
  for (const [i, label] of labels.entries()) {
    expect(label.x).toBeGreaterThanOrEqual(0); expect(label.y).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(graph.width);
    expect(label.y + label.height).toBeLessThanOrEqual(graph.height);
    const hitbox = (rect: Rect) => ({ x: rect.x - 8, y: rect.y - 8, width: rect.width + 16, height: rect.height + 16 });
    for (const other of labels.slice(i + 1)) expect(overlaps(hitbox(label), hitbox(other))).toBe(false);
    for (const card of graph.nodes.values()) expect(overlaps(label, card)).toBe(false);
  }
  for (const edge of graph.connections) for (const [i, end] of edge.points.slice(1).entries()) {
    const start = edge.points[i]!;
    for (const card of graph.nodes.values()) expect(intersectsCard(start, end, card)).toBe(false);
    for (const point of [start, end]) {
      expect(point.x).toBeGreaterThanOrEqual(0); expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(graph.width); expect(point.y).toBeLessThanOrEqual(graph.height);
    }
  }
}
describe("directed member graph", () => {
  it("separates the six directions and three-digit count badges from the reported case", () => {
    const graph = memberCommunicationGraph(["anchor", "programmer", "mathematician"], "anchor", example);
    expect(graph.connections).toHaveLength(6);
    expect(graph.connections.map(edge => edge.count).sort((a, b) => a - b)).toEqual([3, 4, 6, 8, 86, 118]);
    assertClear(graph);
    const there = graph.connections.find(edge => edge.from === "programmer" && edge.to === "mathematician")!;
    const back = graph.connections.find(edge => edge.from === "mathematician" && edge.to === "programmer")!;
    expect(there.points[1]!.y).not.toBe(back.points[1]!.y);
    expect(there.label!.arrow).toBe("→"); expect(back.label!.arrow).toBe("←");
    const down = graph.connections.find(edge => edge.from === "anchor" && edge.to === "programmer")!;
    const up = graph.connections.find(edge => edge.from === "programmer" && edge.to === "anchor")!;
    expect(down.points).not.toEqual([...up.points].reverse());
    expect(down.label!.arrow).toBe("↙"); expect(up.label!.arrow).toBe("↗");
  });
  it("leaves visible room between arrow tips and the recipient card", () => {
    const graph = memberCommunicationGraph(["anchor", "programmer", "mathematician"], "anchor", example);
    for (const edge of graph.connections) {
      const tip = edge.points.at(-1)!, node = graph.nodes.get(edge.to)!;
      const padded = { x: node.x - 4, y: node.y - 4, width: node.width + 8, height: node.height + 8 };
      expect(tip.x < padded.x || tip.x > padded.x + padded.width || tip.y < padded.y || tip.y > padded.y + padded.height).toBe(true);
    }
  });
  it("does not stack any of the reported case's line segments on top of another", () => {
    const graph = memberCommunicationGraph(["anchor", "programmer", "mathematician"], "anchor", example);
    const segments = graph.connections.flatMap(edge => edge.points.slice(1).map((b, i) => ({ a: edge.points[i]!, b })));
    for (const [i, first] of segments.entries()) for (const second of segments.slice(i + 1)) {
      const dx = first.b.x - first.a.x, dy = first.b.y - first.a.y, squared = dx * dx + dy * dy;
      const cross = (p: Point) => (p.x - first.a.x) * dy - (p.y - first.a.y) * dx;
      if (!squared || Math.abs(cross(second.a)) > 0.001 || Math.abs(cross(second.b)) > 0.001) continue;
      const project = (p: Point) => ((p.x - first.a.x) * dx + (p.y - first.a.y) * dy) / squared;
      const p = project(second.a), q = project(second.b);
      expect(Math.min(1, Math.max(p, q)) - Math.max(0, Math.min(p, q))).toBeLessThanOrEqual(0.001);
    }
  });
  it("draws a structural link only when that pair has no observed communication", () => {
    const graph = memberCommunicationGraph(["anchor", "programmer", "mathematician"], "anchor", [example[0]!]);
    expect(graph.connections).toHaveLength(2);
    expect(graph.connections.find(edge => edge.to === "programmer")!.count).toBe(8);
    expect(graph.connections.find(edge => edge.to === "mathematician")!.label).toBeNull();
  });
  it("keeps layout stable when incoming message edges are reordered", () => {
    const ids = ["anchor", "programmer", "mathematician"];
    expect(memberCommunicationGraph(ids, "anchor", example)).toEqual(memberCommunicationGraph(ids, "anchor", [...example].reverse()));
  });
  it.each([1, 2, 4, 5, 7])("keeps complete communication for %i members outside cards and badges", count => {
    const ids = Array.from({ length: count }, (_, i) => `member-${i}`);
    const messages = ids.flatMap((from, i) => ids.filter(to => to !== from).map(to => ({ from, to, count: i % 2 ? 123456 : 118 })));
    const graph = memberCommunicationGraph(ids, ids[0]!, messages);
    expect(graph.connections).toHaveLength(count * (count - 1));
    assertClear(graph);
  });
});
