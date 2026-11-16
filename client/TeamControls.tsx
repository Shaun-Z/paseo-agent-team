import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export type TeamColors = PluginWorkspacePanelProps["theme"]["colors"];

export function TeamAction({ label, icon, onPress, colors: c, disabled, primary, iconOnly, selected, danger, tooltipAlign = "end" }: {
  label: string; icon: string; onPress(): void; colors: TeamColors; disabled?: boolean;
  primary?: boolean; iconOnly?: boolean; selected?: boolean; danger?: boolean;
  tooltipAlign?: "start" | "end";
}) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const tip = iconOnly && (hovered || focused);
  const color = primary ? c.accentForeground : danger ? c.statusDanger : selected ? c.accent : c.foregroundMuted;
  return <View style={{ position: "relative", zIndex: tip ? 20 : 0, alignSelf: "flex-start" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected: !!selected }} disabled={disabled} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={() => { setHovered(false); setFocused(false); onPress(); }} hitSlop={4}
      style={({ pressed }) => ({ flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", minWidth: 36, minHeight: 36, paddingHorizontal: iconOnly ? 9 : 12, borderRadius: 9, borderWidth: 1, borderColor: focused ? c.accent : "transparent", backgroundColor: primary ? c.accent : hovered || pressed || selected ? c.surface2 : "transparent", opacity: disabled ? 0.35 : pressed ? 0.8 : 1 })}>
      <Icon name={icon} size={16} color={color} />
      {!iconOnly && <Text style={{ color, fontSize: 13, fontWeight: "600" }}>{label}</Text>}
    </Pressable>
    {tip && <View pointerEvents="none" style={{ position: "absolute", top: 40, ...(tooltipAlign === "start" ? { left: 0 } : { right: 0 }), minWidth: 90, maxWidth: 250, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6 }}><Text style={{ color: c.foreground, fontSize: 11 }}>{label}</Text></View>}
  </View>;
}

export function TeamFileRow({ name, directory, selected, checkbox, onPress, colors: c, disabled }: {
  name: string; directory?: boolean; selected?: boolean; checkbox?: boolean; onPress(): void; colors: TeamColors; disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return <Pressable accessibilityRole={checkbox && !directory ? "checkbox" : "button"} accessibilityLabel={name} accessibilityState={checkbox && !directory ? { checked: !!selected } : { selected: !!selected }} disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 38, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, backgroundColor: selected || hovered || pressed ? c.surface2 : "transparent", opacity: disabled ? 0.45 : 1 })}>
    <Icon name={directory ? "Folder" : "FileText"} size={16} color={directory || selected ? c.accent : c.foregroundMuted} />
    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: c.foreground, fontSize: 13 }}>{name}</Text>
    {(directory || selected) && <Icon name={directory ? "ChevronRight" : "Check"} size={14} color={selected ? c.accent : c.foregroundMuted} />}
  </Pressable>;
}
