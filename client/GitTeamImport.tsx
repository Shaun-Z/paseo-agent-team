import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mergeGitTeam } from "../shared/git-team";
import { ResearchTeamSchema, type ResearchTeam } from "../shared/research-team";
import { researchGitCompareRpc, researchGitFetchRpc, researchGitImportRpc } from "../shared/research-rpc";
import { messages } from "./i18n";
import { TeamAction } from "./TeamControls";

type Target = { workspaceId: string } | { projectId: string };
type Plan = Omit<RpcOutput<typeof researchGitCompareRpc>, "before" | "incoming"> & { before: ResearchTeam | null; incoming: ResearchTeam };
export function GitTeamImport({ target, workspaceName, theme, disabled, onImported, onBusyChange }: {
  target: Target; workspaceName?: string; theme: PluginWorkspacePanelProps["theme"]; disabled?: boolean;
  onImported(result: RpcOutput<typeof researchGitImportRpc>): Promise<unknown>; onBusyChange(busy: boolean): void;
}) {
  const { t } = useTranslation(messages), c = theme.colors;
  const fetchRepo = useRpc(researchGitFetchRpc), compare = useRpc(researchGitCompareRpc), importSelected = useRpc(researchGitImportRpc);
  const [open, setOpen] = useState(false), [repository, setRepository] = useState(""), [ref, setRef] = useState("HEAD"), [configFile, setConfigFile] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null), [selected, setSelected] = useState<string[]>([]), [expanded, setExpanded] = useState<string | null>(null);
  const lifecycle = { onMutate: () => onBusyChange(true), onSettled: () => onBusyChange(false) };
  const fetching = useMutation({ ...lifecycle, mutationFn: () => fetchRepo({ ...target, repository, ref }), onSuccess: result => { setPlan(null); setConfigFile(result.configFiles.length === 1 ? result.configFiles[0] : ""); } });
  const comparing = useMutation({ ...lifecycle, mutationFn: () => compare({ ...target, sourceId: fetching.data!.sourceId, configFile, ...("projectId" in target && workspaceName ? { workspaceName } : {}) }), onSuccess: result => {
    setPlan({ ...result, before: result.before ? ResearchTeamSchema.parse(result.before) : null, incoming: ResearchTeamSchema.parse(result.incoming) }); setSelected(result.before ? [] : result.changes.filter(change => change.status !== "removed").map(change => change.id)); setExpanded(null); importing.reset();
  } });
  const importing = useMutation({ ...lifecycle, mutationFn: () => importSelected({ ...target, planId: plan!.planId, selected }), onSuccess: onImported });
  const busy = fetching.isPending || comparing.isPending || importing.isPending;
  let valid = true;
  if (plan && selected.length) { try { mergeGitTeam(plan.before, plan.incoming, plan.changes, selected); } catch { valid = false; } }
  const close = () => { if (!busy) setOpen(false); };
  const input = { borderWidth: 1, borderColor: c.border, borderRadius: 9, padding: 10, color: c.foreground, backgroundColor: c.surface0, fontSize: 13 };
  const field = (label: string, value: string, change: (text: string) => void, placeholder?: string) => <View style={{ gap: 6 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change} editable={!busy} autoCapitalize="none" autoCorrect={false} placeholder={placeholder} placeholderTextColor={c.foregroundMuted} style={input} /></View>;
  const invalidateSource = () => { fetching.reset(); comparing.reset(); importing.reset(); setPlan(null); setConfigFile(""); };
  return <>
    <TeamAction label={t("research.git.title")} icon="GitBranch" iconOnly colors={c} disabled={disabled || busy} onPress={() => setOpen(true)} />
    <Modal title={t("research.git.title")} icon={<Icon name="GitBranch" size={20} color={c.foregroundMuted} />} open={open} onOpenChange={value => { if (!value) close(); }}>
      <Modal.Content scrollable={false} contentContainerStyle={{ flex: 1, minHeight: 0, padding: 18, gap: 12 }}>
        <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
          {!plan ? <>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.git.sourceHint")}</Text>
            {field(t("research.git.repository"), repository, text => { setRepository(text); invalidateSource(); }, "https://github.com/owner/repository")}
            {field(t("research.git.ref"), ref, text => { setRef(text); invalidateSource(); })}
            <TeamAction label={t("research.git.fetch")} icon="Download" primary colors={c} onPress={() => fetching.mutate()} disabled={busy || !repository.trim()} />
            {fetching.data && <>
              <Text selectable style={{ color: c.foregroundMuted, fontSize: 11 }}>{fetching.data.commit}</Text>
              {field(t("research.git.configFile"), configFile, text => { setConfigFile(text); comparing.reset(); })}
              {fetching.data.configFiles.map(file => <Pressable key={file} accessibilityRole="button" disabled={busy} onPress={() => { setConfigFile(file); comparing.reset(); }} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, backgroundColor: configFile === file ? c.surface2 : c.surface0 }}><Icon name="FileText" size={16} color={c.foregroundMuted} /><Text style={{ color: c.foreground, fontSize: 12, flex: 1 }}>{file}</Text>{configFile === file && <Icon name="Check" size={14} color={c.accent} />}</Pressable>)}
              <TeamAction label={t("research.git.compare")} icon="GitCompareArrows" colors={c} onPress={() => comparing.mutate()} disabled={busy || !configFile.trim()} />
            </>}
          </> : <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TeamAction label={t("research.git.back")} icon="ArrowLeft" iconOnly tooltipAlign="start" colors={c} disabled={busy} onPress={() => { setPlan(null); importing.reset(); }} />
              <View style={{ flex: 1, gap: 3 }}><Text selectable numberOfLines={1} style={{ color: c.foreground, fontSize: 12 }}>{repository}</Text><Text selectable style={{ color: c.foregroundMuted, fontSize: 11 }}>{plan.commit.slice(0, 12)} · {plan.configFile}</Text></View>
            </View>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t(plan.before ? "research.git.updateHint" : "research.git.createHint")}</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.git.sessionHint")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <Text style={{ color: c.foregroundMuted, flex: 1, fontSize: 12 }}>{t("research.git.selected", { count: selected.length, total: plan.changes.length })}</Text>
              <TeamAction label={t("research.git.selectAll")} icon="CheckCheck" iconOnly colors={c} disabled={busy} onPress={() => setSelected(plan.changes.map(change => change.id))} />
              <TeamAction label={t("research.git.selectNone")} icon="Square" iconOnly colors={c} disabled={busy} onPress={() => setSelected([])} />
            </View>
            {!plan.changes.length && <Text style={{ color: c.foregroundMuted }}>{t("research.git.noChanges")}</Text>}
            {plan.changes.map(change => {
              const checked = selected.includes(change.id), detail = expanded === change.id;
              const statusColor = change.status === "removed" ? c.statusDanger : change.status === "added" ? c.statusSuccess : c.statusWarning;
              return <View key={change.id} style={{ borderWidth: 1, borderColor: checked ? c.accent : c.border, borderRadius: 10, backgroundColor: c.surface0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 8 }}>
                  <Pressable accessibilityRole="checkbox" accessibilityLabel={`${t(`research.git.${change.kind}`)} ${change.key} ${change.field.join(".")}`} accessibilityState={{ checked }} disabled={busy} onPress={() => { setSelected(checked ? selected.filter(id => id !== change.id) : [...selected, change.id]); importing.reset(); }} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 4, flex: 1 }}>
                    <View style={{ width: 18, height: 18, borderWidth: 1, borderColor: checked ? c.accent : c.border, borderRadius: 5, backgroundColor: checked ? c.accent : c.surface1, alignItems: "center", justifyContent: "center" }}>{checked && <Icon name="Check" size={12} color={c.accentForeground} />}</View>
                    <View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.foreground, fontSize: 12 }}>{change.key}{change.field.length ? ` · ${change.field.join(".")}` : ""}</Text><Text style={{ color: statusColor, fontSize: 11 }}>{t(`research.git.${change.kind}`)} · {t(`research.git.${change.status}`)}</Text></View>
                  </Pressable>
                  <TeamAction label={t("research.git.details")} icon={detail ? "ChevronUp" : "ChevronDown"} iconOnly colors={c} onPress={() => setExpanded(detail ? null : change.id)} />
                </View>
                {detail && <View style={{ gap: 10, padding: 12, borderTopWidth: 1, borderColor: c.border }}>
                  <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.git.current")}</Text><Text selectable style={{ color: c.foreground, fontSize: 12 }}>{change.before ?? t("research.git.absent")}</Text>
                  <Text style={{ color: c.accent, fontSize: 11 }}>{t("research.git.incoming")}</Text><Text selectable style={{ color: c.foreground, fontSize: 12 }}>{change.after ?? t("research.git.absent")}</Text>
                </View>}
              </View>;
            })}
          </>}
          {busy && <Text style={{ color: c.foregroundMuted }}>{t("loading")}</Text>}
          {(fetching.error || comparing.error || importing.error) && <Text selectable style={{ color: c.statusDanger, fontSize: 12 }}>{String(fetching.error ?? comparing.error ?? importing.error)}</Text>}
          {!valid && <Text style={{ color: c.statusWarning, fontSize: 12 }}>{t("research.git.invalidSelection")}</Text>}
          {importing.data && <Text selectable style={{ color: c.statusSuccess, fontSize: 12 }}>{t("research.git.imported", { file: importing.data.file })}</Text>}
        </ScrollView>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, borderTopWidth: 1, borderColor: c.border, paddingTop: 10 }}>
          <TeamAction label={t("review.cancel")} icon="X" iconOnly colors={c} onPress={close} disabled={busy} />
          {plan && <TeamAction label={t("research.git.importSelected")} icon="Check" primary colors={c} onPress={() => importing.mutate()} disabled={busy || !selected.length || !valid} />}
        </View>
      </Modal.Content>
    </Modal>
  </>;
}
