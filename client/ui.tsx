import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Pressable, Text } from "react-native";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export function styles(colors: Colors, compact: boolean) {
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    body: { padding: compact ? 12 : 20, gap: 12 },
    title: { color: colors.foreground, fontSize: 16, fontWeight: "600" as const },
    text: { color: colors.foreground },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    danger: { color: colors.statusDanger, fontSize: 12 },
    success: { color: colors.statusSuccess },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, gap: 6, backgroundColor: colors.surface1 },
    orchestratorCard: {
      borderTopWidth: 1,
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderLeftWidth: 6,
      borderTopColor: colors.border,
      borderRightColor: colors.border,
      borderBottomColor: colors.border,
      borderLeftColor: colors.accent,
      borderRadius: 8,
      padding: 10,
      gap: 6,
      backgroundColor: colors.surface2,
    },
    orchestratorLabel: { color: colors.accent, fontSize: 11, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
    roleGroupWrap: { flexDirection: "row" as const, paddingLeft: 2, gap: 20 },
    roleConnector: { width: 2, borderRadius: 1, backgroundColor: colors.accent, opacity: 0.4 },
    roleGroup: { flex: 1, minWidth: 0, gap: 10 },
    roleRow: { flexDirection: "row" as const, alignItems: "stretch" as const, gap: 10 },
    roleCard: { flex: 1, minWidth: 0 },
    roleSpacer: { flex: 1, minWidth: 0 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, color: colors.foreground, backgroundColor: colors.surface0 },
    row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, alignItems: "center" as const },
    button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, backgroundColor: colors.accent },
    buttonText: { color: colors.accentForeground, fontWeight: "600" as const },
    secondary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
    select: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 },
    option: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 },
    optionActive: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface2 },
    optionOn: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accent },
    optionOnActive: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.foreground, backgroundColor: colors.accent },
  };
}

export type Styles = ReturnType<typeof styles>;

export function Button({ s, label, onPress, disabled, secondary }: { s: Styles; label: string; onPress(): void; disabled?: boolean; secondary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[secondary ? s.secondary : s.button, disabled ? { opacity: 0.5 } : null]}>
      <Text style={secondary ? s.text : s.buttonText}>{label}</Text>
    </Pressable>
  );
}
