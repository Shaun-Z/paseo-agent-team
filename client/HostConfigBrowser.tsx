import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { researchBrowseHostRpc } from "../shared/research-rpc";
import { messages } from "./i18n";
import { TeamAction, TeamFileRow } from "./TeamControls";

export function HostConfigBrowser({ workspaceId, mode, suggestedName, value, onSelect, disabled, colors: c }: {
  workspaceId: string; mode: "load" | "export"; suggestedName: string; value: string; onSelect(path: string): void; disabled: boolean;
  colors: PluginWorkspacePanelProps["theme"]["colors"];
}) {
  const { t } = useTranslation(messages), browse = useRpc(researchBrowseHostRpc);
  const [directory, setDirectory] = useState(""), [address, setAddress] = useState(""), [filter, setFilter] = useState("");
  const [name, setName] = useState(suggestedName.split(/[\\/]/).pop() || "team.yaml");
  const listing = useQuery({ queryKey: ["research-host-files", workspaceId, directory], queryFn: () => browse({ workspaceId, directory }), retry: false });
  const validName = /^[^/\\]+\.(json|ya?ml)$/i.test(name) && name.trim() === name;
  useEffect(() => { if (listing.data) setAddress(listing.data.directory); }, [listing.data?.directory]);
  useEffect(() => {
    onSelect(mode === "export" && listing.data && validName ? `${listing.data.directory.replace(/\/+$/, "")}/${name}` : "");
  }, [mode, listing.data?.directory, name, validName, onSelect]);
  const navigate = (path: string) => { setDirectory(path); setAddress(path); setFilter(""); };
  const input = { color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9, fontSize: 12, backgroundColor: c.surface0 };
  const entries = listing.data?.entries.filter(entry => entry.name.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return <View style={{ flex: 1, minHeight: 0, gap: 10 }}>
    {/* Raise whole toolbar rows: a button's zIndex cannot escape its row's stacking context. */}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, zIndex: 2 }}>
      <TeamAction label={t("research.picker.up")} icon="ArrowUp" iconOnly tooltipAlign="start" colors={c} disabled={disabled || listing.data?.parent == null} onPress={() => navigate(listing.data!.parent!)} />
      <TextInput accessibilityLabel={t("research.hostBrowser.directory")} editable={!disabled} value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} style={{ ...input, flex: 1, minWidth: 0 }} onSubmitEditing={() => navigate(address)} />
      <TeamAction label={t("research.hostBrowser.go")} icon="ArrowRight" iconOnly colors={c} disabled={disabled} onPress={() => { if (address === directory || address === listing.data?.directory) void listing.refetch(); else navigate(address); }} />
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, zIndex: 1 }}>
      <TeamAction label={t("research.hostBrowser.project")} icon="Folder" iconOnly tooltipAlign="start" colors={c} disabled={disabled} onPress={() => navigate("")} />
      <TeamAction label={t("research.hostBrowser.home")} icon="Home" iconOnly tooltipAlign="start" colors={c} disabled={disabled} onPress={() => navigate("~")} />
      <TeamAction label={t("research.picker.refresh")} icon="RotateCw" iconOnly tooltipAlign="start" colors={c} disabled={disabled || listing.isFetching} onPress={() => { void listing.refetch(); }} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 10, borderWidth: 1, borderColor: c.border, borderRadius: 9 }}><Icon name="Search" size={14} color={c.foregroundMuted} /><TextInput accessibilityLabel={t("research.picker.filter")} placeholder={t("research.picker.filter")} placeholderTextColor={c.foregroundMuted} value={filter} onChangeText={setFilter} editable={!disabled} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, minWidth: 0, color: c.foreground, padding: 9, fontSize: 12 }} /></View>
    </View>
    <ScrollView style={{ flex: 1, minHeight: 0, borderWidth: 1, borderColor: c.border, borderRadius: 10, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: 4, gap: 1 }}>
      {listing.isFetching && <Text style={{ color: c.foregroundMuted, padding: 8 }}>{t("loading")}</Text>}
      {listing.error && <Text selectable style={{ color: c.statusDanger, padding: 8 }}>{String(listing.error)}</Text>}
      {entries.map(entry => <TeamFileRow key={entry.path} name={entry.name} directory={entry.kind === "directory"} selected={entry.path === value} onPress={() => entry.kind === "directory" ? navigate(entry.path) : mode === "load" ? onSelect(entry.path) : setName(entry.name)} colors={c} disabled={disabled} />)}
      {listing.data && !entries.length && <Text style={{ color: c.foregroundMuted, padding: 8 }}>{t("research.picker.empty")}</Text>}
      {listing.data?.truncated && <Text style={{ color: c.foregroundMuted, padding: 8 }}>{t("research.picker.truncated")}</Text>}
    </ScrollView>
    {mode === "export" && <>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.hostBrowser.filename")}</Text>
      <TextInput accessibilityLabel={t("research.hostBrowser.filename")} editable={!disabled} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} style={input} />
      {!validName && <Text style={{ color: c.foregroundMuted }}>{t("research.hostBrowser.filenameHint")}</Text>}
    </>}
  </View>;
}
