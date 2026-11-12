import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import type { GraphConnection } from "../shared/member-graph";

type Point = { x: number; y: number };
type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Props = { connections: readonly GraphConnection[]; colors: Colors; selected(edge: GraphConnection): boolean; focused: boolean };
function Segment({ from, to, color, weight = 2, opacity = 1 }: { from: Point; to: Point; color: string; weight?: number; opacity?: number }) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (!length) return null;
  return <View pointerEvents="none" style={{ position: "absolute", left: (from.x + to.x) / 2 - length / 2, top: (from.y + to.y) / 2 - weight / 2,
    width: length, height: weight, backgroundColor: color, opacity, transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }] }} />;
}
/** All lines precede arrowheads; count badges are rendered separately above cards. */
export function MemberConnectionPaths({ connections, colors, selected, focused }: Props) {
  return <>
    {connections.map(edge => {
      const dimmed = focused && !selected(edge);
      const color = edge.count ? dimmed ? colors.border : colors.foregroundMuted : colors.border;
      return <View key={edge.key} pointerEvents="none">
        {edge.points.slice(1).map((to, i) => <Segment key={i} from={edge.points[i]!} to={to} color={color} weight={edge.count ? 2 : 1} />)}
        {edge.label && <Segment from={edge.label.anchor} to={{ x: edge.label.x + edge.label.width / 2, y: edge.label.y + edge.label.height / 2 }} color={color} weight={1} />}
      </View>;
    })}
    {connections.filter(edge => edge.count > 0).map(edge => {
      const tip = edge.points.at(-1)!, before = edge.points.at(-2)!;
      const dx = tip.x - before.x, dy = tip.y - before.y, length = Math.hypot(dx, dy);
      const x = tip.x - dx / length * 6, y = tip.y - dy / length * 6;
      return <View key={`arrow:${edge.key}`} pointerEvents="none" style={{ position: "absolute", left: x - 6, top: y - 6, width: 0, height: 0,
        borderLeftWidth: 12, borderTopWidth: 6, borderBottomWidth: 6, borderLeftColor: colors.foreground, borderTopColor: "transparent", borderBottomColor: "transparent",
        opacity: focused && !selected(edge) ? 0.3 : 1, transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }] }} />;
    })}
  </>;
}
export function MemberConnectionCounts({ connections, colors, selected, focused, onSelect, label }: Props & { onSelect(edge: GraphConnection): void; label(edge: GraphConnection): string }) {
  return <>{connections.map(edge => edge.label && <Pressable key={edge.key} accessibilityRole="button" accessibilityLabel={label(edge)} hitSlop={8}
    onPress={() => onSelect(edge)} style={{ position: "absolute", left: edge.label.x, top: edge.label.y, width: edge.label.width, height: edge.label.height,
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: edge.label.height / 2, borderWidth: 1,
      borderColor: focused && selected(edge) ? colors.accent : colors.foregroundMuted, backgroundColor: colors.surface0, opacity: focused && !selected(edge) ? 0.45 : 1 }}>
    <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>{edge.label.arrow}</Text>
    <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 12, fontVariant: ["tabular-nums"] }}>{edge.count}</Text>
  </Pressable>)}</>;
}
