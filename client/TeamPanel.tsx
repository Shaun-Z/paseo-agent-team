import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { withFreeWorkspaces } from "../shared/apply-plan";
import { foldersText, newRole, parseFolders } from "../shared/draft";
import { EMPTY_HISTORY, record, undo, redo, type DraftHistory } from "../shared/draft-history";
import { messages } from "./i18n";
import { teamApplyRpc, teamInstructionsImproveRpc, teamInstructionsProposalRpc, teamPendingProposalRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamRestartOrchestratorRpc, teamEditProposalRpc, teamEditProposeRpc } from "../shared/rpc";
import { checkTeam, type Role, type Team } from "../shared/team";
import { applyTeamEdit, summarizeTeamEdit } from "../shared/team-edit";
import { providerIcon } from "../shared/provider-icons";
import { TEAMS_DIR, workspaceClashes } from "../shared/team-files";
import { validateTeam, type ProviderInfo } from "../shared/validate";

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

type SelectRequest = { label: string; options: readonly string[]; value: string; onChange(value: string): void };
const SelectContext = createContext<(request: SelectRequest) => void>(() => {});

function Select({ s, label, options, value, onChange }: { s: Styles; label: string; options: readonly string[]; value: string; onChange(value: string): void }) {
  const openSelect = useContext(SelectContext);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={() => openSelect({ label, options, value, onChange })}
      style={s.select}
    >
      <Text style={s.text}>{value || "—"}</Text>
      <Text style={s.muted}>▾</Text>
    </Pressable>
  );
}

/** Provider and model pickers limited to what this host can run. */
function ModelPicker({ s, catalog, provider, model, onChange }: { s: Styles; catalog: readonly ProviderInfo[]; provider: string; model: string; onChange(next: { provider: string; model: string }): void }) {
  const { t } = useTranslation(messages);
  const ready = catalog.filter((entry) => entry.ready);
  const models = ready.find((entry) => entry.id === provider)?.models.map((entry) => entry.id) ?? [];
  return (
    <View style={s.row}>
      <Text style={s.muted}>{t("role.providerAndModel")}</Text>
      <Select
        s={s}
        label={t("role.provider")}
        options={ready.map((entry) => entry.id)}
        value={provider}
        onChange={(next) => {
          if (next !== provider) onChange({ provider: next, model: ready.find((entry) => entry.id === next)?.models[0]?.id ?? "" });
        }}
      />
      <Select s={s} label={t("role.model")} options={models} value={model} onChange={(next) => onChange({ provider, model: next })} />
    </View>
  );
}

function RoleEditor({ s, role, catalog, onChange, onEditInstructions, onRemove }: { s: Styles; role: Role; catalog: readonly ProviderInfo[]; onChange(role: Role): void; onEditInstructions(): void; onRemove(): void }) {
  const { t } = useTranslation(messages);
  const [folders, setFolders] = useState(foldersText(role.folders));
  const [showFolders, setShowFolders] = useState(role.folders.length > 0);
  const currentName = useRef(role.name);
  // Keyed by position, so resync when another role's removal hands this editor a different role.
  useEffect(() => {
    const switched = role.name !== currentName.current;
    currentName.current = role.name;
    if (switched || foldersText(parseFolders(folders)) !== foldersText(role.folders)) {
      setFolders(foldersText(role.folders));
      setShowFolders(role.folders.length > 0);
    }
  }, [role.name, role.folders]);
  const foldersExpanded = showFolders || role.folders.length > 0;
  return (
    <View style={[s.card, s.roleCard]}>
      <View style={{ gap: 4 }}>
        <Text style={s.muted}>{t("role.name")}</Text>
        <View style={s.row}>
          <TextInput
            style={[s.input, { flex: 1, minWidth: 0 }]}
            value={role.name}
            placeholder={t("role.name")}
            onChangeText={(name) => {
              currentName.current = name;
              onChange({ ...role, name });
            }}
          />
          <Button s={s} secondary label={t("role.remove")} onPress={onRemove} />
        </View>
      </View>
      <ModelPicker s={s} catalog={catalog} provider={role.provider} model={role.model} onChange={(next) => onChange({ ...role, ...next })} />
      {foldersExpanded ? (
        <View style={{ gap: 4 }}>
          <Text style={s.muted}>{t("role.folders")}</Text>
          <TextInput
            style={s.input}
            value={folders}
            placeholder={t("role.folders")}
            onChangeText={(text) => {
              setFolders(text);
              onChange({ ...role, folders: parseFolders(text) });
            }}
          />
        </View>
      ) : (
        <View style={s.row}>
          <Button s={s} secondary label={t("role.setFolders")} onPress={() => setShowFolders(true)} />
        </View>
      )}
      <View style={{ gap: 4 }}>
        <Text style={s.muted}>{t("role.instructions")}</Text>
        {role.instructions.trim() ? (
          <Text numberOfLines={3} style={s.text}>{role.instructions.trim()}</Text>
        ) : (
          <Text style={s.muted}>{t("role.noInstructions")}</Text>
        )}
        <View style={s.row}>
          <Button s={s} secondary label={t("role.editInstructions")} onPress={onEditInstructions} />
        </View>
      </View>
    </View>
  );
}

/** Where the team goes: a workspace's project, or a project picked without a workspace. */
type Target = { workspaceId: string } | { projectId: string };

function InstructionsDialog({
  s,
  accentColor,
  target,
  team,
  role,
  onSave,
  onClose,
}: {
  s: Styles;
  accentColor: string;
  target: Target;
  team: Team | null;
  role: Role | null;
  onSave(instructions: string): void;
  onClose(): void;
}) {
  const { t } = useTranslation(messages);
  const improve = useRpc(teamInstructionsImproveRpc);
  const instructionsProposal = useRpc(teamInstructionsProposalRpc);
  const open = role !== null && team !== null;
  const [instructions, setInstructions] = useState("");
  const [request, setRequest] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [plannerId, setPlannerId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const requestCounter = useRef(0);

  const stopTracking = () => {
    requestCounter.current += 1;
    setStarting(false);
    setStartError(null);
    setPlannerId(null);
  };

  useEffect(() => {
    if (!open || !role) {
      stopTracking();
      return;
    }
    stopTracking();
    setInstructions(role.instructions);
    setRequest("");
    setSuggestion(null);
  }, [open]);

  const planning = useQuery({
    queryKey: ["workspace-agents", "instructions-proposal", plannerId],
    queryFn: () => instructionsProposal({ agentId: plannerId! }),
    enabled: plannerId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 2000 : false),
  });

  useEffect(() => {
    if (planning.data?.status !== "done") return;
    setSuggestion(planning.data.instructions);
    setPlannerId(null);
  }, [planning.data]);

  const startImprove = useMutation({
    onMutate: () => {
      const currentRequest = ++requestCounter.current;
      setStarting(true);
      setStartError(null);
      setPlannerId(null);
      setSuggestion(null);
      return { request: currentRequest };
    },
    mutationFn: ({ currentRole, currentTeam, currentInstructions, currentRequest }: { currentRole: Role; currentTeam: Team; currentInstructions: string; currentRequest: string }) =>
      improve({
        ...target,
        role: { name: currentRole.name, folders: currentRole.folders, instructions: currentInstructions },
        request: currentRequest,
        team: {
          goal: currentTeam.goal,
          orchestratorWorkspace: currentTeam.orchestrator.workspace,
          roles: currentTeam.roles.map(({ name, folders }) => ({ name, folders })),
        },
      }),
    onSuccess: ({ agentId }, _vars, context) => {
      if (requestCounter.current !== context.request) return;
      setStarting(false);
      setPlannerId(agentId);
    },
    onError: (error, _vars, context) => {
      if (requestCounter.current !== context?.request) return;
      setStarting(false);
      setStartError(String(error));
    },
  });

  const busy = starting || (plannerId !== null && planning.data?.status !== "failed");

  const close = () => {
    stopTracking();
    setSuggestion(null);
    setRequest("");
    onClose();
  };

  return (
    <Modal
      title={t("role.instructionsTitle", { role: role?.name.trim() || t("role.name") })}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <Modal.Content>
        {open && role && team ? (
          <>
            <TextInput
              style={[s.input, { minHeight: 120, textAlignVertical: "top" }]}
              value={instructions}
              placeholder={t("role.instructions")}
              multiline
              onChangeText={setInstructions}
            />
            {suggestion !== null ? (
              <View style={s.card}>
                <Text style={s.text}>{suggestion}</Text>
                <View style={s.row}>
                  <Button
                    s={s}
                    label={t("role.applySuggestion")}
                    onPress={() => {
                      setInstructions(suggestion);
                      setSuggestion(null);
                    }}
                  />
                  <Button s={s} secondary label={t("role.discardSuggestion")} onPress={() => setSuggestion(null)} />
                </View>
              </View>
            ) : null}
            <View style={s.card}>
              <TextInput
                style={s.input}
                value={request}
                placeholder={t("role.improveRequestPlaceholder")}
                multiline
                onChangeText={setRequest}
              />
              <View style={s.row}>
                <Button
                  s={s}
                  secondary
                  label={t("role.improveWithAi")}
                  disabled={busy}
                  onPress={() => startImprove.mutate({ currentRole: role, currentTeam: team, currentInstructions: instructions, currentRequest: request })}
                />
                {busy ? (
                  <>
                    <ActivityIndicator color={accentColor} />
                    <Text style={s.muted}>{t("role.instructionsPlanning")}</Text>
                  </>
                ) : null}
              </View>
              {planning.data?.status === "failed" ? planning.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
              {planning.error ? <Text style={s.danger}>{String(planning.error)}</Text> : null}
              {startError ? <Text style={s.danger}>{startError}</Text> : null}
            </View>
            <View style={s.row}>
              <Button s={s} secondary label={t("review.cancel")} onPress={close} />
              <Button
                s={s}
                label={t("role.saveInstructions")}
                onPress={() => {
                  onSave(instructions);
                  close();
                }}
              />
            </View>
          </>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function TeamModel({ provider, model, colors, icons }: { provider: string; model: string; colors: Colors; icons: Map<string, string | undefined> }) {
  const icon = providerIcon(provider, icons.get(provider));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, flexShrink: 1 }}>
      <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
        {icon.kind === "svg" ? <Icon icon={{ svg: icon.svg }} size={14} color={colors.foreground} /> : <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 12 }}>{icon.letter}</Text>}
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, flexShrink: 1 }}>{model}</Text>
    </View>
  );
}

function CurrentTeamTree({ team, s, colors, compact, icons }: { team: Team; s: Styles; colors: Colors; compact: boolean; icons: Map<string, string | undefined> }) {
  const { t } = useTranslation(messages);
  const [width, setWidth] = useState(0);
  const stacked = compact || width < 560;
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "stretch" : "center", gap: stacked ? 12 : 0 }}>
      <View style={[s.orchestratorCard, { gap: 8, minWidth: 0, ...(stacked ? {} : { width: 200 }) }]}>
        <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "700" }}>{t("review.orchestrator")}</Text>
        <Text style={[s.text, { fontWeight: "700" }]}>{team.orchestrator.workspace}</Text>
        <TeamModel {...team.orchestrator} colors={colors} icons={icons} />
      </View>
      {!stacked && team.roles.length > 0 ? <View style={{ width: 20, height: 2, backgroundColor: colors.border }} /> : null}
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0, marginLeft: stacked ? 12 : 0 }}>
        {team.roles.map((role, index) => (
          <View key={role.name} style={{ flexDirection: "row", alignItems: "stretch" }}>
            <View style={{ width: 18 }}>
              <View style={{ position: "absolute", left: 0, top: index === 0 ? "50%" : 0, bottom: index === team.roles.length - 1 ? "50%" : 0, width: 2, backgroundColor: colors.border }} />
              <View style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, backgroundColor: colors.border }} />
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingVertical: 5 }}>
              <View style={[s.card, { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, backgroundColor: colors.surface0 }]}>
                <Text style={[s.text, { fontWeight: "700", minWidth: 88, maxWidth: "100%", flexShrink: 1 }]}>{role.name}</Text>
                <TeamModel provider={role.provider} model={role.model} colors={colors} icons={icons} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, minWidth: 0, flexShrink: 1 }}>
                  {(role.folders.length ? role.folders.slice(0, 3) : [t("current.noFolderLimit")]).map((folder, at) => (
                    <View key={at} style={{ borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: colors.surface2, maxWidth: "100%" }}>
                      <Text style={s.muted}>{folder}</Text>
                    </View>
                  ))}
                  {role.folders.length > 3 ? <View style={{ borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: colors.surface2 }}><Text style={s.muted}>{t("current.moreFolders", { count: role.folders.length - 3 })}</Text></View> : null}
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

type Applied = Extract<RpcOutput<typeof teamApplyRpc>, { ok: true }>;

export const PROJECT_TEAMS_KEY = ["workspace-agents", "projects"] as const;

export function TeamPanel({ workspaceId, ...props }: PluginWorkspacePanelProps) {
  return <TeamEditor {...props} target={{ workspaceId }} />;
}

/** Propose, review and apply a team for the target's project. */
export function TeamEditor({ theme, layout, navigation, target, onApplied }: Pick<PluginScreenProps, "theme" | "layout" | "navigation"> & { target: Target; onApplied?(result: Applied): void }) {
  const s = useMemo(() => styles(theme.colors, layout.compact), [theme, layout.compact]);
  const { t } = useTranslation(messages);
  const queryClient = useQueryClient();
  const paseo = usePaseo();
  const providers = useQuery({ queryKey: ["dashboard", "providers"], queryFn: () => paseo.providers.snapshot() });
  const providerIcons = useMemo(() => new Map((providers.data?.entries ?? []).map((provider) => [provider.provider, provider.iconSvg])), [providers.data]);
  const read = useRpc(teamReadRpc);
  const propose = useRpc(teamProposeRpc);
  const proposal = useRpc(teamProposalRpc);
  const apply = useRpc(teamApplyRpc);
  const restartOrchestrator = useRpc(teamRestartOrchestratorRpc);
  const proposeTeamEdit = useRpc(teamEditProposeRpc);
  const teamEditProposal = useRpc(teamEditProposalRpc);
  const pendingProposal = useRpc(teamPendingProposalRpc);
  const cancelProposal = useRpc(teamProposalCancelRpc);

  const current = useQuery({ queryKey: ["workspace-agents", "team", target], queryFn: () => read(target) });
  const [goal, setGoal] = useState("");
  const [plannerId, setPlannerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Team | null>(null);
  const [history, setHistory] = useState<DraftHistory>(EMPTY_HISTORY);
  const [editNotice, setEditNotice] = useState<{
    summary: ReturnType<typeof summarizeTeamEdit>;
    validation: Extract<RpcOutput<typeof teamEditProposalRpc>, { status: "done" }>["validation"];
  } | null>(null);
  const appliedEditId = useRef<string | null>(null);
  const resetEditHistory = () => {
    setHistory(EMPTY_HISTORY);
    setEditNotice(null);
  };
  const [editingRoleIndex, setEditingRoleIndex] = useState<number | null>(null);
  const [roleGroupWidth, setRoleGroupWidth] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [picker, setPicker] = useState<SelectRequest | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const pickerRef = useRef<SelectRequest | null>(null);
  pickerRef.current = picker;
  const listRef = useRef<ScrollView>(null);
  const rowLayouts = useRef<Record<number, { y: number; height: number }>>({});
  const listHeight = useRef(0);
  const scrollY = useRef(0);
  const openSelect = (request: SelectRequest) => {
    setPickerQuery("");
    const index = request.options.indexOf(request.value);
    setHighlight(index >= 0 ? index : 0);
    rowLayouts.current = {};
    scrollY.current = 0;
    setPicker(request);
  };

  // The planner keeps running when this screen closes; reopening it picks the newest proposal back up.
  // Fetched fresh on every open (gcTime 0) and only once the team is read, since a proposal is fitted to it.
  const pendingKey = ["workspace-agents", "pending-proposal", target];
  const pending = useQuery({ queryKey: pendingKey, queryFn: () => pendingProposal(target), enabled: current.data !== undefined, gcTime: 0 });
  useEffect(() => {
    const agentId = pending.data?.agentId;
    if (agentId) setPlannerId((id) => id ?? agentId);
  }, [pending.data]);
  const cancelled = useMutation({ mutationFn: () => cancelProposal(target), onSuccess: () => queryClient.setQueryData(pendingKey, { agentId: null }) });

  const planning = useQuery({
    queryKey: ["workspace-agents", "proposal", plannerId],
    queryFn: () => proposal({ agentId: plannerId! }),
    enabled: plannerId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 2000 : false),
  });
  // From a workspace, the team's orchestrator always runs in that workspace.
  const here = current.data?.workspace ?? null;
  const atHere = (team: Team): Team => (here === null ? team : { ...team, orchestrator: { ...team.orchestrator, workspace: here } });
  // A new draft creates new workspaces instead of landing in the project's existing ones.
  const titles = current.data?.projectWorkspaces ?? [];
  const fresh = (team: Team): Team => withFreeWorkspaces(atHere(team), titles, { orchestrator: here === null });
  useEffect(() => {
    if (planning.data?.status === "done") { resetEditHistory(); cancelTeamEdit(); setDraft(fresh(planning.data.team)); }
  }, [planning.data]);

  // Keep AI edits separate from the draft until accepted; cancellation ignores late start responses.
  const [editRequest, setEditRequest] = useState("");
  const [editPlannerId, setEditPlannerId] = useState<string | null>(null);
  const [editStarting, setEditStarting] = useState(false);
  const [editStartError, setEditStartError] = useState<string | null>(null);
  const editRequestCounter = useRef(0);
  const cancelTeamEdit = () => {
    editRequestCounter.current += 1;
    setEditStarting(false);
    setEditStartError(null);
    setEditPlannerId(null);
    setEditNotice(null);
  };
  const editPlanning = useQuery({
    queryKey: ["workspace-agents", "team-edit-proposal", editPlannerId],
    queryFn: () => teamEditProposal({ agentId: editPlannerId! }),
    enabled: editPlannerId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 2000 : false),
  });
  const startTeamEdit = useMutation({
    onMutate: () => {
      const request = ++editRequestCounter.current;
      setEditPlannerId(null);
      setEditNotice(null);
      setEditStarting(true);
      setEditStartError(null);
      return { request };
    },
    mutationFn: (team: Team) =>
      proposeTeamEdit({ ...target, request: editRequest, team }),
    onSuccess: ({ agentId }, _team, context) => {
      if (editRequestCounter.current !== context.request) return;
      setEditStarting(false);
      setEditPlannerId(agentId);
    },
    onError: (error, _team, context) => {
      if (editRequestCounter.current !== context?.request) return;
      setEditStarting(false);
      setEditStartError(String(error));
    },
  });
  const editBusy = editStarting || (editPlannerId !== null && (!editPlanning.data || editPlanning.data.status === "running"));

  useEffect(() => {
    const result = editPlanning.data;
    if (!draft || !editPlannerId || result?.status !== "done" || appliedEditId.current === editPlannerId) return;
    appliedEditId.current = editPlannerId;
    const after = applyTeamEdit(draft, result.team);
    setHistory((current) => record(current, draft));
    setDraft(after);
    setEditNotice({ summary: summarizeTeamEdit(draft, after), validation: result.validation });
    setEditRequest("");
    setEditPlannerId(null);
  }, [draft, editPlannerId, editPlanning.data]);
  const editSummary = editNotice?.summary;

  const start = useMutation({ onMutate: () => { resetEditHistory(); cancelTeamEdit(); }, mutationFn: () => propose({ ...target, goal }), onSuccess: ({ agentId }) => setPlannerId(agentId) });
  const applied = useMutation({
    mutationFn: (team: Team) => apply({ ...target, team }),
    onSuccess: (result) => {
      void current.refetch();
      void queryClient.invalidateQueries({ queryKey: PROJECT_TEAMS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "roster"] });
      if (result.ok) onApplied?.(result);
    },
  });
  const restarted = useMutation({
    mutationFn: () => restartOrchestrator(target),
    onSuccess: () => {
      void current.refetch();
      void queryClient.invalidateQueries({ queryKey: PROJECT_TEAMS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "agents"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "roster"] });
    },
  });

  const catalog = current.data?.catalog ?? [];
  const checked = draft ? checkTeam(draft) : null;
  const problems = draft && checked?.ok ? [...validateTeam(checked.team, catalog), ...workspaceClashes(checked.team, current.data?.takenWorkspaces ?? [])].map((error) => `${error.target}: ${error.message}`) : (checked && !checked.ok ? checked.errors : []);
  const updateRole = (index: number, role: Role) => setDraft((current) => (current ? { ...current, roles: current.roles.map((entry, at) => (at === index ? role : entry)) } : current));
  const columns = roleGroupWidth < 640 ? 1 : roleGroupWidth < 1000 ? 2 : 3;
  const roleRows: { role: Role; index: number }[][] = [];
  if (draft) {
    for (let i = 0; i < draft.roles.length; i += columns) {
      roleRows.push(draft.roles.slice(i, i + columns).map((role, offset) => ({ role, index: i + offset })));
    }
  }
  const pickerNeedle = pickerQuery.trim().toLowerCase();
  const pickerOptions = picker ? (pickerNeedle ? picker.options.filter((option) => option.toLowerCase().includes(pickerNeedle)) : picker.options) : [];
  const highlightedIndex = pickerOptions.length > 0 ? Math.min(highlight, pickerOptions.length - 1) : -1;
  const pickOption = (option: string) => {
    const active = pickerRef.current;
    if (!active) return;
    pickerRef.current = null;
    setPicker(null);
    setPickerQuery("");
    active.onChange(option);
  };
  const pickHighlighted = () => {
    if (highlightedIndex >= 0 && highlightedIndex < pickerOptions.length) {
      pickOption(pickerOptions[highlightedIndex]!);
    }
  };
  useEffect(() => {
    if (!picker || highlightedIndex < 0) return;
    const row = rowLayouts.current[highlightedIndex] ?? { y: highlightedIndex * 40, height: 36 };
    const viewHeight = listHeight.current || 320;
    const top = scrollY.current;
    if (row.y < top) {
      scrollY.current = row.y;
      listRef.current?.scrollTo({ y: row.y, animated: false });
    } else if (row.y + row.height > top + viewHeight) {
      const nextY = row.y + row.height - viewHeight;
      scrollY.current = nextY;
      listRef.current?.scrollTo({ y: nextY, animated: false });
    }
  }, [highlightedIndex, picker, pickerQuery]);
  const teamBusy = plannerId !== null && (!planning.data || planning.data.status === "running");
  const progress = applied.isPending
    ? { status: t("result.applying"), error: null, onCancel: null }
    : editBusy
      ? { status: t("review.editPlanning"), error: editPlanning.error ? String(editPlanning.error) : null, onCancel: cancelTeamEdit }
      : teamBusy
        ? {
            status: t("create.planning"),
            error: planning.error ? String(planning.error) : null,
            onCancel: () => {
              cancelled.mutate();
              setPlannerId(null);
            },
          }
        : null;

  if (current.isLoading) return <View style={[s.screen, s.body]}><Text style={s.muted}>{t("loading")}</Text></View>;
  if (current.error) return <View style={[s.screen, s.body]}><Text style={s.danger}>{String(current.error)}</Text></View>;
  const data = current.data!;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body}>
      <Text style={s.title}>{t("title", { project: data.project.name })}</Text>
      <Text style={s.muted}>{data.project.root}/{data.file ?? `${TEAMS_DIR}/`}</Text>

      {data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>)}
      {data.team && !draft ? (
        <View style={[s.card, { maxWidth: 960, width: "100%", alignSelf: "flex-start" }]}>
          <View style={[s.row, { justifyContent: "flex-end" }]}>
            <Button s={s} label={t("current.edit")} onPress={() => { resetEditHistory(); cancelTeamEdit(); setDraft(data.team); }} />
            <Button s={s} secondary label={t("current.reapply")} disabled={applied.isPending || restarted.isPending} onPress={() => applied.mutate(data.team!)} />
            <Button s={s} secondary label={t("current.restart")} disabled={applied.isPending || restarted.isPending} onPress={() => setConfirmRestart(true)} />
          </View>
          <CurrentTeamTree team={data.team} s={s} colors={theme.colors} compact={layout.compact} icons={providerIcons} />
          {data.validation.map((error) => <Text key={error.target + error.message} style={s.danger}>{error.target}: {error.message}</Text>)}
          <Text style={s.muted}>{t("current.restartHint")}</Text>
        </View>
      ) : null}

      <Modal
        title={t("progress.title")}
        open={progress !== null}
        onOpenChange={(open) => {
          if (!open) progress?.onCancel?.();
        }}
      >
        <Modal.Content>
          <View style={s.row}>
            <ActivityIndicator color={theme.colors.accent} />
            {progress ? <Text style={s.text}>{progress.status}</Text> : null}
          </View>
          <Text style={s.muted}>{t("progress.keepOpen")}</Text>
          {progress?.error ? <Text style={s.danger}>{progress.error}</Text> : null}
          {progress?.onCancel ? (
            <View style={s.row}>
              <Button s={s} secondary label={t("review.cancel")} onPress={progress.onCancel} />
            </View>
          ) : null}
        </Modal.Content>
      </Modal>

      <Modal title={t("current.restartConfirmTitle")} open={confirmRestart} onOpenChange={setConfirmRestart}>
        <Modal.Content>
          <Text style={s.text}>{t("current.restartConfirmBody")}</Text>
          <View style={s.row}>
            <Button s={s} secondary label={t("review.cancel")} disabled={restarted.isPending} onPress={() => setConfirmRestart(false)} />
            <Button
              s={s}
              label={t("current.restartConfirm")}
              disabled={restarted.isPending}
              onPress={() => {
                setConfirmRestart(false);
                restarted.mutate();
              }}
            />
          </View>
        </Modal.Content>
      </Modal>

      <Modal
        title={picker?.label ?? ""}
        open={picker !== null}
        onOpenChange={(open) => {
          if (!open) {
            pickerRef.current = null;
            setPicker(null);
            setPickerQuery("");
          }
        }}
      >
        <Modal.Content>
          {picker ? (
            <>
              <TextInput
                style={s.input}
                value={pickerQuery}
                placeholder={t("role.searchPlaceholder")}
                autoFocus
                onChangeText={(text) => {
                  rowLayouts.current = {};
                  scrollY.current = 0;
                  setPickerQuery(text);
                  setHighlight(0);
                }}
                onKeyPress={(event) => {
                  const key = event.nativeEvent.key;
                  if (key === "ArrowDown") {
                    event.preventDefault?.();
                    if (pickerOptions.length > 0) {
                      setHighlight((current) => Math.min(pickerOptions.length - 1, Math.min(current, pickerOptions.length - 1) + 1));
                    }
                  } else if (key === "ArrowUp") {
                    event.preventDefault?.();
                    if (pickerOptions.length > 0) {
                      setHighlight((current) => Math.max(0, Math.min(current, pickerOptions.length - 1) - 1));
                    }
                  } else if (key === "Enter") {
                    event.preventDefault?.();
                    pickHighlighted();
                  }
                }}
                onSubmitEditing={pickHighlighted}
              />
              <ScrollView
                ref={listRef}
                style={{ maxHeight: 320 }}
                contentContainerStyle={{ gap: 4 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                scrollEventThrottle={16}
                onLayout={(event) => {
                  listHeight.current = event.nativeEvent.layout.height;
                }}
                onScroll={(event) => {
                  scrollY.current = event.nativeEvent.contentOffset.y;
                }}
              >
                {pickerOptions.length === 0 ? <Text style={s.muted}>{t(picker.options.length === 0 ? "role.noOptions" : "role.noMatches")}</Text> : null}
                {pickerOptions.map((option, index) => {
                  const selected = option === picker.value;
                  const focused = index === highlightedIndex;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityLabel={option}
                      accessibilityState={{ selected }}
                      onLayout={(event) => {
                        const { y, height } = event.nativeEvent.layout;
                        rowLayouts.current[index] = { y, height };
                      }}
                      onPress={() => pickOption(option)}
                      style={selected ? (focused ? s.optionOnActive : s.optionOn) : focused ? s.optionActive : s.option}
                    >
                      <Text style={selected ? s.buttonText : s.text}>{option}</Text>
                      {selected ? <Text style={s.buttonText}>✓</Text> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}
        </Modal.Content>
      </Modal>

      <InstructionsDialog
        s={s}
        accentColor={theme.colors.accent}
        target={target}
        team={draft}
        role={editingRoleIndex !== null && draft ? draft.roles[editingRoleIndex] ?? null : null}
        onSave={(instructions) => {
          if (editingRoleIndex !== null && draft?.roles[editingRoleIndex]) {
            updateRole(editingRoleIndex, { ...draft.roles[editingRoleIndex]!, instructions });
          }
        }}
        onClose={() => setEditingRoleIndex(null)}
      />

      {!draft ? !data.team && (
        <View style={s.card}>
          <Text style={s.text}>{t(here === null ? "create.intro" : "create.introHere")}</Text>
          <TextInput style={s.input} value={goal} placeholder={t("create.goalPlaceholder")} onChangeText={setGoal} />
          <View style={s.row}>
            <Button s={s} label={t("create.propose")} disabled={!goal.trim() || start.isPending || planning.data?.status === "running"} onPress={() => start.mutate()} />
            <Button s={s} secondary label={t("create.blank")} onPress={() => { resetEditHistory(); cancelTeamEdit(); setDraft(fresh({ version: 1, goal, orchestrator: { workspace: "orchestrator", provider: "claude", model: catalog.find((entry) => entry.id === "claude")?.models[0]?.id ?? "" }, roles: [newRole(catalog, [])] })); }} />
          </View>
          {planning.data?.status === "failed" ? planning.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
          {start.error ? <Text style={s.danger}>{String(start.error)}</Text> : null}
        </View>
      ) : (
        <SelectContext.Provider value={openSelect}>
          <View style={{ gap: 10 }}>
            <Text style={s.title}>{t("review.title")}</Text>
            <View style={s.orchestratorCard}>
              <Text style={s.orchestratorLabel}>{t("review.orchestrator")}</Text>
              {here === null ? (
                <TextInput style={s.input} value={draft.orchestrator.workspace} placeholder={t("role.workspace")} onChangeText={(workspace) => setDraft((current) => (current ? { ...current, orchestrator: { ...current.orchestrator, workspace } } : current))} />
              ) : (
                <Text style={s.text}>{t("review.orchestratorHere", { workspace: here })}</Text>
              )}
              <ModelPicker s={s} catalog={catalog} provider={draft.orchestrator.provider} model={draft.orchestrator.model} onChange={(next) => setDraft((current) => (current ? { ...current, orchestrator: { ...current.orchestrator, ...next } } : current))} />
            </View>
            <View style={s.roleGroupWrap}>
              <View style={s.roleConnector} />
              <View
                style={s.roleGroup}
                onLayout={(event) => {
                  const nextWidth = Math.round(event.nativeEvent.layout.width);
                  setRoleGroupWidth((current) => (current === nextWidth ? current : nextWidth));
                }}
              >
                {roleRows.map((row) => (
                  <View key={row[0]!.index} style={s.roleRow}>
                    {row.map(({ role, index }) => (
                      <RoleEditor key={index} s={s} role={role} catalog={catalog} onChange={(next) => updateRole(index, next)} onEditInstructions={() => setEditingRoleIndex(index)} onRemove={() => setDraft((current) => (current ? { ...current, roles: current.roles.filter((_, at) => at !== index) } : current))} />
                    ))}
                    {Array.from({ length: columns - row.length }, (_, spacer) => (
                      <View key={`spacer-${spacer}`} style={s.roleSpacer} />
                    ))}
                  </View>
                ))}
                <Button s={s} secondary label={t("review.addRole")} onPress={() => setDraft((current) => (current ? { ...current, roles: [...current.roles, newRole(catalog, current.roles.map((role) => role.name))] } : current))} />
                <View style={s.card}>
                  <TextInput style={s.input} value={editRequest} placeholder={t("review.teamEditRequest")} multiline onChangeText={setEditRequest} />
                  <View style={s.row}>
                    <Button s={s} secondary label={t("review.editTeamWithAi")} disabled={!editRequest.trim() || editBusy} onPress={() => startTeamEdit.mutate(draft)} />
                    <Button s={s} secondary label={t("review.undo")} disabled={!history.past.length || editBusy} onPress={() => { const result = undo(history, draft); if (result) { setHistory(result.history); setDraft(result.draft); setEditNotice(null); } }} />
                    <Button s={s} secondary label={t("review.redo")} disabled={!history.future.length || editBusy} onPress={() => { const result = redo(history, draft); if (result) { setHistory(result.history); setDraft(result.draft); setEditNotice(null); } }} />
                  </View>
                  {editPlanning.data?.status === "failed" ? editPlanning.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
                  {editPlanning.error ? <Text style={s.danger}>{String(editPlanning.error)}</Text> : null}
                  {editNotice && editSummary ? (
                    <View style={s.card}>
                      <Text style={s.text}>{t("review.editSummary")}</Text>
                      {editSummary.added.map((name) => <Text key={`added-${name}`} style={s.text}>{t("review.editAdded", { name })}</Text>)}
                      {editSummary.removed.map((name) => <Text key={`removed-${name}`} style={s.text}>{t("review.editRemoved", { name })}</Text>)}
                      {editSummary.changed.map(({ name, fields }) => <Text key={`changed-${name}`} style={s.text}>{t("review.editChanged", { name, fields: fields.map((field) => t(`role.${field}`)).join(", ") })}</Text>)}
                      {editSummary.orchestrator ? <Text style={s.text}>{t("review.editOrchestratorChanged")}</Text> : null}
                      {editSummary.goal ? <Text style={s.text}>{t("review.editGoalChanged")}</Text> : null}
                      {!editSummary.added.length && !editSummary.removed.length && !editSummary.changed.length && !editSummary.orchestrator && !editSummary.goal ? <Text style={s.muted}>{t("review.editNoChanges")}</Text> : null}
                      {editNotice.validation.map((error) => <Text key={error.target + error.message} style={s.danger}>{error.target}: {error.message}</Text>)}

                    </View>
                  ) : null}
                  {editStartError ? <Text style={s.danger}>{editStartError}</Text> : null}
                </View>
              </View>
            </View>
            {problems.map((problem) => <Text key={problem} style={s.danger}>{problem}</Text>)}
            <View style={s.row}>
              <Button s={s} label={t("review.apply")} disabled={problems.length > 0 || applied.isPending} onPress={() => applied.mutate(draft)} />
              <Button s={s} secondary label={t("review.cancel")} onPress={() => { if (plannerId) cancelled.mutate(); cancelTeamEdit(); resetEditHistory(); setEditRequest(""); setPicker(null); setEditingRoleIndex(null); setDraft(null); setPlannerId(null); }} />
            </View>
          </View>
        </SelectContext.Provider>
      )}

      {cancelled.error ? <Text style={s.danger}>{String(cancelled.error)}</Text> : null}
      {applied.error ? <Text style={s.danger}>{String(applied.error)}</Text> : null}
      {applied.data && !applied.data.ok ? applied.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
      {restarted.isPending ? <Text style={s.muted}>{t("current.restarting")}</Text> : null}
      {restarted.error ? <Text style={s.danger}>{String(restarted.error)}</Text> : null}
      {restarted.data && !restarted.data.ok ? restarted.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
      {applied.data?.ok ? (
        <View style={s.card}>
          <Text style={s.success}>{t("result.applied", { file: applied.data.file })}</Text>
          {applied.data.workspaces.map((workspace) => (
            <Text key={workspace.id} style={s.text}>• {t(workspace.created ? "result.created" : "result.reused", { target: workspace.target, workspace: workspace.workspace })}</Text>
          ))}
          {(applied.data as Applied).permission ? <Text style={s.muted}>{t("result.permission", { file: (applied.data as Applied).permission! })}</Text> : null}
          {(applied.data as Applied).cleanup.map((failure) => <Text key={failure} style={s.danger}>{t("result.cleanupFailed", { failure })}</Text>)}
          {navigation ? <Button s={s} label={t("result.openOrchestrator")} onPress={() => navigation.openAgent({ agentId: (applied.data as { orchestratorAgentId: string }).orchestratorAgentId })} /> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
