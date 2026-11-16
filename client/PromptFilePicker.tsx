import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { researchPromptFilesRpc } from "../shared/research-rpc";
import { messages } from "./i18n";
import { TeamAction, TeamFileRow } from "./TeamControls";

export function PromptFilePicker({ target, selected, onChange, colors: c, input }: {
  target: { workspaceId: string } | { projectId: string }; selected: string[]; onChange(files: string[]): void;
  colors: PluginWorkspacePanelProps["theme"]["colors"]; input?: ReactNode;
}) {
  const { t } = useTranslation(messages), browse = useRpc(researchPromptFilesRpc);
  const [help, setHelp] = useState(false);
  const [open, setOpen] = useState(false), [directory, setDirectory] = useState(""), [search, setSearch] = useState("");
  const listing = useQuery({ queryKey: ["research-prompt-files", target, directory], queryFn: () => browse({ ...target, directory }), enabled: open, retry: false });
  const navigate = (path: string) => { setDirectory(path); setSearch(""); };
  const entries = listing.data?.entries.filter(entry => entry.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, zIndex: 2 }}>{input}<TeamAction label={t("research.picker.choose")} icon="FolderOpen" iconOnly selected={open} colors={c} onPress={() => setOpen(value => !value)} /></View>
    {open && <View style={{ gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 8, backgroundColor: c.surface0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, zIndex: 1 }}>
        <TeamAction label={t("research.picker.up")} icon="ArrowUp" iconOnly tooltipAlign="start" colors={c} disabled={listing.data?.parent == null} onPress={() => navigate(listing.data!.parent!)} />
        <Text selectable numberOfLines={1} style={{ flex: 1, minWidth: 0, color: c.foregroundMuted, fontSize: 12 }}>{listing.data?.directory || "/"}</Text>
        <TeamAction label={t("research.picker.refresh")} icon="RotateCw" iconOnly colors={c} disabled={listing.isFetching} onPress={() => { void listing.refetch(); }} />
        <TeamAction label={t("research.ui.help")} icon="Info" iconOnly selected={help} colors={c} onPress={() => setHelp(value => !value)} />
      </View>
      {help && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.picker.hint")}</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingLeft: 10 }}><Icon name="Search" size={14} color={c.foregroundMuted} /><TextInput accessibilityLabel={t("research.picker.filter")} placeholder={t("research.picker.filter")} placeholderTextColor={c.foregroundMuted} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} style={{ color: c.foreground, flex: 1, minWidth: 0, padding: 8, fontSize: 12 }} /></View>
      <ScrollView nestedScrollEnabled style={{ height: 220, flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 1 }}>
        {listing.isFetching && <Text style={{ color: c.foregroundMuted }}>{t("loading")}</Text>}
        {listing.error && <Text style={{ color: c.statusDanger }}>{String(listing.error)}</Text>}
        {entries.map(entry => <TeamFileRow key={entry.path} name={entry.name} directory={entry.kind === "directory"} checkbox selected={selected.includes(entry.path)} colors={c} onPress={() => entry.kind === "directory" ? navigate(entry.path) : onChange(selected.includes(entry.path) ? selected.filter(path => path !== entry.path) : [...selected, entry.path])} />)}
        {listing.data && !entries.length && <Text style={{ color: c.foregroundMuted }}>{t("research.picker.empty")}</Text>}
        {listing.data?.truncated && <Text style={{ color: c.foregroundMuted }}>{t("research.picker.truncated")}</Text>}
      </ScrollView>
    </View>}
  </View>;
}
