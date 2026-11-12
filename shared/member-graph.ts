export const MEMBER_CARD_WIDTH = 224;
export const MEMBER_CARD_HEIGHT = 124;
type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type MessageEdge = { from: string; to: string; count: number };
export type GraphConnection = MessageEdge & {
  key: string;
  points: Point[];
  label: (Rect & { arrow: string; anchor: Point }) | null;
};
const margin = 24, rowGap = 128, trackGap = 48, portGap = 12, labelHeight = 28;

/** The wrapper reserves scaled bounds; offsets compensate for center-origin transforms. */
export function fitMemberGraph(graph: { width: number; height: number }, viewportWidth: number) {
  const scale = viewportWidth > 0 && graph.width > 0 ? Math.min(1, viewportWidth / graph.width) : 0;
  const width = graph.width * scale, height = graph.height * scale;
  return { scale, width, height, left: (width - graph.width) / 2, top: (height - graph.height) / 2 };
}

/** Layout is keyed by member identity, independent of role multiplicity and session IDs. */
export function memberGraph(ids: readonly string[], coordinatorId: string) {
  const width = MEMBER_CARD_WIDTH, height = MEMBER_CARD_HEIGHT, gap = 112;
  const peers = ids.filter(id => id !== coordinatorId);
  const columns = Math.max(1, Math.min(3, peers.length));
  const canvasWidth = columns * width + Math.max(0, columns - 1) * gap + margin * 2;
  const nodes = new Map<string, { x: number; y: number; width: number; height: number }>();
  nodes.set(coordinatorId, { x: (canvasWidth - width) / 2, y: margin, width, height });
  peers.forEach((id, index) => nodes.set(id, { x: margin + (index % columns) * (width + gap), y: margin + height + rowGap + Math.floor(index / columns) * (height + rowGap), width, height }));
  return { nodes, width: canvasWidth, height: peers.length ? margin * 2 + (Math.ceil(peers.length / columns) + 1) * (height + rowGap) - rowGap : height + margin * 2 };
}

const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
const center = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const badgeWidth = (count: number) => Math.max(48, String(count).length * 8 + 34);
function direction(a: Point, b: Point) {
  const sector = (Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) + 8) % 8;
  return ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"][sector]!;
}
/** Parallel lines are clipped separately; arrow tips stop outside the cards. */
function parallelLine(a: Rect, b: Rect, offset: number) {
  const start = center(a), end = center(b), length = Math.hypot(end.x - start.x, end.y - start.y);
  const u = { x: (end.x - start.x) / length, y: (end.y - start.y) / length }, n = { x: -u.y, y: u.x };
  const p = { x: start.x + n.x * offset, y: start.y + n.y * offset };
  const q = { x: end.x + n.x * offset, y: end.y + n.y * offset };
  const exit = (rect: Rect, point: Point, v: Point) => Math.min(
    v.x > 0 ? (rect.x + rect.width - point.x) / v.x : v.x < 0 ? (rect.x - point.x) / v.x : Infinity,
    v.y > 0 ? (rect.y + rect.height - point.y) / v.y : v.y < 0 ? (rect.y - point.y) / v.y : Infinity,
  );
  const s = exit(a, p, u) + portGap, t = exit(b, q, { x: -u.x, y: -u.y }) + portGap;
  return { points: [{ x: p.x + u.x * s, y: p.y + u.y * s }, { x: q.x - u.x * t, y: q.y - u.y * t }], normal: n };
}

/** Routes observed directions independently and allocates count badges without collisions. */
export function memberCommunicationGraph(ids: readonly string[], coordinatorId: string, messages: readonly MessageEdge[]) {
  const order = [coordinatorId, ...ids.filter(id => id !== coordinatorId)];
  const base = memberGraph(order, coordinatorId), columns = Math.max(1, Math.min(3, order.length - 1));
  const rowOf = (id: string) => id === coordinatorId ? 0 : 1 + Math.floor((order.indexOf(id) - 1) / columns);
  const counts = new Map(messages.filter(edge => edge.count > 0 && edge.from !== edge.to && order.includes(edge.from) && order.includes(edge.to)).map(edge => [JSON.stringify([edge.from, edge.to]), edge.count]));
  type Route = MessageEdge & { key: string; kind: "direct" | "row" | "outside"; side: "left" | "right"; lane: number; offset: number; a: string; b: string };
  const routes: Route[] = [];
  let pair = 0;
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++, pair++) {
    const a = order[i]!, b = order[j]!;
    const forward = counts.get(JSON.stringify([a, b])) ?? 0, reverse = counts.get(JSON.stringify([b, a])) ?? 0;
    const kind = i === 0 && rowOf(b) === 1 ? "direct" : rowOf(a) === rowOf(b) ? "row" : "outside";
    const directions = forward || reverse ? [[a, b, forward], [b, a, reverse]].filter(([, , count]) => Number(count) > 0) : i === 0 ? [[a, b, 0]] : [];
    for (const [from, to, count] of directions) routes.push({ from: String(from), to: String(to), count: Number(count), key: JSON.stringify([from, to]), kind,
      side: pair % 2 ? "left" : "right", lane: 0, offset: forward && reverse ? from === a ? -14 : 14 : 0, a, b });
  }
  const tracks = new Map<number, string[]>(), ports = new Map<string, string[]>();
  const add = <K>(map: Map<K, string[]>, key: K, id: string) => map.set(key, [...map.get(key) ?? [], id]);
  let left = 0, right = 0;
  for (const route of routes) if (route.kind !== "direct") {
    add(ports, route.from, route.key); add(ports, route.to, route.key);
    add(tracks, rowOf(route.from), `${route.key}:from`);
    if (route.kind === "outside") {
      add(tracks, rowOf(route.to), `${route.key}:to`);
      route.lane = route.side === "left" ? left++ : right++;
    }
  }
  const outsideGap = Math.max(72, ...routes.map(route => badgeWidth(route.count) + 24));
  const leftGutter = left * outsideGap, rightGutter = right * outsideGap;
  const rowCount = Math.max(...order.map(rowOf)) + 1, rowY: number[] = [margin];
  for (let row = 1; row < rowCount; row++) rowY[row] = rowY[row - 1]! + MEMBER_CARD_HEIGHT + Math.max(rowGap, 32 + (tracks.get(row - 1)?.length ?? 0) * trackGap);
  const nodes = new Map(order.map(id => [id, { ...base.nodes.get(id)!, x: base.nodes.get(id)!.x + leftGutter, y: rowY[rowOf(id)]! }]));
  let width = base.width + leftGutter + rightGutter;
  const lastRow = rowCount - 1, lastTracks = tracks.get(lastRow)?.length ?? 0;
  const height = rowY[lastRow]! + MEMBER_CARD_HEIGHT + (lastTracks ? 32 + (lastTracks - 1) * trackGap + labelHeight / 2 + margin : margin);
  const port = (id: string, key: string) => {
    const rect = nodes.get(id)!, list = ports.get(id)!;
    return { x: rect.x + rect.width * (list.indexOf(key) + 1) / (list.length + 1), y: rect.y + rect.height + portGap };
  };
  const trackY = (row: number, key: string) => rowY[row]! + MEMBER_CARD_HEIGHT + 32 + tracks.get(row)!.indexOf(key) * trackGap;
  const connections: GraphConnection[] = [], occupied: Rect[] = [];
  const pending: { connection: GraphConnection; route: Route; normal: Point }[] = [];
  for (const route of routes) {
    const connection: GraphConnection = { from: route.from, to: route.to, count: route.count, key: route.key, points: [], label: null };
    let anchor: Point | undefined, arrow = "";
    if (route.kind === "direct") {
      const line = parallelLine(nodes.get(route.a)!, nodes.get(route.b)!, route.offset);
      connection.points = route.from === route.a ? line.points : [...line.points].reverse();
      if (route.count) pending.push({ connection, route, normal: line.normal });
    } else {
      const start = port(route.from, route.key), end = port(route.to, route.key);
      const fromY = trackY(rowOf(route.from), `${route.key}:from`);
      if (route.kind === "row") {
        connection.points = [start, { x: start.x, y: fromY }, { x: end.x, y: fromY }, end];
        anchor = { x: (start.x + end.x) / 2, y: fromY };
        arrow = direction({ x: start.x, y: fromY }, { x: end.x, y: fromY });
      } else {
        const toY = trackY(rowOf(route.to), `${route.key}:to`);
        const x = route.side === "left" ? leftGutter - (route.lane + 0.5) * outsideGap : leftGutter + base.width + (route.lane + 0.5) * outsideGap;
        connection.points = [start, { x: start.x, y: fromY }, { x, y: fromY }, { x, y: toY }, { x: end.x, y: toY }, end];
        anchor = { x, y: (fromY + toY) / 2 }; arrow = direction({ x, y: fromY }, { x, y: toY });
      }
    }
    if (anchor && route.count) {
      connection.label = { x: anchor.x - badgeWidth(route.count) / 2, y: anchor.y - labelHeight / 2, width: badgeWidth(route.count), height: labelHeight, arrow, anchor };
      occupied.push(connection.label);
    }
    connections.push(connection);
  }
  for (const { connection, route, normal } of pending) {
    const [start, end] = connection.points as [Point, Point], w = badgeWidth(route.count);
    const sign = Math.sign(route.offset), support = (Math.abs(normal.x) * w + Math.abs(normal.y) * labelHeight) / 2 + 8;
    let chosen: GraphConnection["label"] = null;
    for (const extra of [0, 12, 24]) for (const fraction of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      if (chosen) continue;
      const anchor = { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
      const distance = sign ? support - Math.abs(route.offset) + extra : extra;
      const rect = { x: anchor.x + normal.x * sign * distance - w / 2, y: anchor.y + normal.y * sign * distance - labelHeight / 2, width: w, height: labelHeight };
      if (rect.x < 4 || rect.y < 4 || rect.x + w > width - 4 || rect.y + labelHeight > height - 4) continue;
      if ([...nodes.values()].some(node => overlaps(rect, node, 8)) || occupied.some(label => overlaps(rect, label, 16))) continue;
      chosen = { ...rect, arrow: direction(start, end), anchor };
    }
    if (!chosen) {
      const anchor = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      chosen = { x: width + 12, y: anchor.y - labelHeight / 2, width: w, height: labelHeight, arrow: direction(start, end), anchor };
      width += w + 24;
    }
    connection.label = chosen; occupied.push(chosen);
  }
  return { nodes, connections, width, height };
}
export function graphLine(from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number; height: number }) {
  const dx = to.x + to.width / 2 - from.x - from.width / 2;
  const dy = to.y + to.height / 2 - from.y - from.height / 2;
  if (!dx && !dy) return null;
  const cut = (node: typeof from) => Math.min(dx ? node.width / 2 / Math.abs(dx) : Infinity, dy ? node.height / 2 / Math.abs(dy) : Infinity);
  const start = cut(from), end = cut(to);
  const x1 = from.x + from.width / 2 + dx * start;
  const y1 = from.y + from.height / 2 + dy * start;
  const x2 = to.x + to.width / 2 - dx * end;
  const y2 = to.y + to.height / 2 - dy * end;
  return { x: x1, y: y1, endX: x2, endY: y2, length: Math.hypot(x2 - x1, y2 - y1), angle: Math.atan2(dy, dx) * 180 / Math.PI };
}
