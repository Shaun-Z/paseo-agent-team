/** Layout is keyed by member identity, independent of role multiplicity and session IDs. */
export function memberGraph(ids: readonly string[], coordinatorId: string) {
  const width = 224, height = 124, gap = 80, margin = 16, rowGap = 64;
  const peers = ids.filter(id => id !== coordinatorId);
  const columns = Math.max(1, Math.min(3, peers.length));
  const canvasWidth = columns * width + Math.max(0, columns - 1) * gap + margin * 2;
  const nodes = new Map<string, { x: number; y: number; width: number; height: number }>();
  nodes.set(coordinatorId, { x: (canvasWidth - width) / 2, y: margin, width, height });
  peers.forEach((id, index) => nodes.set(id, { x: margin + (index % columns) * (width + gap), y: margin + height + rowGap + Math.floor(index / columns) * (height + rowGap), width, height }));
  return { nodes, width: canvasWidth, height: peers.length ? margin * 2 + (Math.ceil(peers.length / columns) + 1) * (height + rowGap) - rowGap : height + margin * 2 };
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
