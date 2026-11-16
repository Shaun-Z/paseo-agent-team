import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { researchExportRpc, researchLoadRpc } from "../shared/research-rpc";
import { messages } from "./i18n";
import { HostConfigBrowser } from "./HostConfigBrowser";
import { TeamAction } from "./TeamControls";

export function TeamConfigTransfer({ workspaceId, hasFile, fileName, disabled, theme, onLoaded, onBusyChange }: {
  workspaceId: string; hasFile: boolean; fileName: string; disabled?: boolean;
  theme: PluginWorkspacePanelProps["theme"]; onLoaded(): Promise<unknown>; onBusyChange(busy: boolean): void;
}) {
  const { t } = useTranslation(messages), c = theme.colors;
  const load = useRpc(researchLoadRpc), exportFile = useRpc(researchExportRpc);
  const [action, setAction] = useState<"load" | "export" | null>(null);
  const [path, setPath] = useState(""), [overwrite, setOverwrite] = useState(false), [help, setHelp] = useState(false);
  const transfer = useMutation({ onMutate: () => onBusyChange(true), onSettled: () => onBusyChange(false), mutationFn: async () => {
    if (action === "load") {
      const result = await load({ workspaceId, path });
      await onLoaded();
      return { action, file: result.file };
    }
    const result = await exportFile({ workspaceId, path, overwrite });
    return { action: "export", file: result.file };
  } });
  const selectPath = useCallback((value: string) => { setPath(value); transfer.reset(); }, [transfer.reset]);
  const busy = !!disabled || transfer.isPending;
  const choose = (next: "load" | "export") => { setAction(next); setPath(""); setOverwrite(false); setHelp(false); transfer.reset(); };
  const close = () => { if (!busy) { setAction(null); transfer.reset(); } };
  return <View style={{ flexDirection: "row", gap: 2 }}>
    <TeamAction label={t("research.transfer.load")} icon="FolderOpen" iconOnly colors={c} onPress={() => choose("load")} disabled={busy} />
    <TeamAction label={t("research.transfer.export")} icon="Download" iconOnly colors={c} onPress={() => choose("export")} disabled={busy || !hasFile} />
    <Modal title={t(action === "export" ? "research.transfer.export" : "research.transfer.load")} icon={<Icon name={action === "export" ? "Download" : "FolderOpen"} size={20} color={c.foregroundMuted} />} open={!!action} onOpenChange={open => { if (!open) close(); }}>
      <Modal.Content scrollable={false} contentContainerStyle={{ flex: 1, minHeight: 0, padding: 18, gap: 14 }}>
        {action && <>
          <HostConfigBrowser key={action} workspaceId={workspaceId} mode={action} suggestedName={fileName} value={path} onSelect={selectPath} disabled={busy} colors={c} />
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t(action === "load" ? "research.transfer.sourcePath" : "research.transfer.destinationPath")}</Text>
              <TeamAction label={t("research.ui.help")} icon="Info" iconOnly selected={help} colors={c} onPress={() => setHelp(value => !value)} />
            </View>
            <TextInput accessibilityLabel={t(action === "load" ? "research.transfer.sourcePath" : "research.transfer.destinationPath")} value={path} editable={!busy} onChangeText={selectPath} autoCapitalize="none" autoCorrect={false} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 9, padding: 10, color: c.foreground, backgroundColor: c.surface0, fontSize: 12 }} />
          </View>
          {help && <View style={{ gap: 8 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t(action === "load" ? "research.transfer.loadHint" : "research.transfer.exportHint")}</Text><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.transfer.pathHint")}</Text></View>}
          {action === "export" && <Pressable accessibilityRole="checkbox" accessibilityLabel={t("research.transfer.overwrite")} accessibilityState={{ checked: overwrite }} disabled={busy} onPress={() => { setOverwrite(value => !value); transfer.reset(); }} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: overwrite ? c.accent : c.border, backgroundColor: overwrite ? c.accent : c.surface0, alignItems: "center", justifyContent: "center" }}>{overwrite && <Icon name="Check" size={12} color={c.accentForeground} />}</View><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.transfer.overwrite")}</Text></Pressable>}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 6, borderTopWidth: 1, borderColor: c.border, paddingTop: 12 }}>
            <TeamAction label={t("review.cancel")} icon="X" iconOnly colors={c} onPress={close} disabled={busy} />
            <TeamAction label={t(action === "load" ? "research.transfer.loadReplace" : "research.transfer.export")} icon={action === "load" ? "Upload" : "Download"} primary colors={c} onPress={() => transfer.mutate()} disabled={busy || !path.trim()} />
          </View>
          {transfer.isPending && <Text style={{ color: c.foregroundMuted }}>{t("loading")}</Text>}
          {transfer.error && <Text selectable style={{ color: c.statusDanger, fontSize: 12 }}>{String(transfer.error)}</Text>}
          {transfer.data && <Text selectable style={{ color: c.statusSuccess, fontSize: 12 }}>{t(transfer.data.action === "load" ? "research.transfer.loaded" : "research.transfer.exported", { file: transfer.data.file })}</Text>}
        </>}
      </Modal.Content>
    </Modal>
  </View>;
}
