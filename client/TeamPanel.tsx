import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { freeWorkspace, withFreeWorkspaces } from "../shared/apply-plan";
import { foldersText, newRole, parseFolders, uniqueName } from "../shared/draft";
import { messages } from "./i18n";
import { teamApplyRpc, teamPendingProposalRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamRestartOrchestratorRpc, teamRoleProposalRpc, teamRoleProposeRpc } from "../shared/rpc";
import { checkTeam, isSharedRole, type Role, type Team } from "../shared/team";
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
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, color: colors.foreground, backgroundColor: colors.surface0 },
    row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, alignItems: "center" as const },
    button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, backgroundColor: colors.accent },
    buttonText: { color: colors.accentForeground, fontWeight: "600" as const },
    secondary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
    chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    chipOn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accent },
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

function Chips({ s, options, value, onChange }: { s: Styles; options: readonly string[]; value: string; onChange(value: string): void }) {
  return (
    <View style={s.row}>
      {options.map((option) => (
        <Pressable key={option} accessibilityRole="button" accessibilityLabel={option} onPress={() => onChange(option)} style={option === value ? s.chipOn : s.chip}>
          <Text style={option === value ? s.buttonText : s.text}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Provider and model pickers limited to what this host can run. */
function ModelPicker({ s, catalog, provider, model, onChange }: { s: Styles; catalog: readonly ProviderInfo[]; provider: string; model: string; onChange(next: { provider: string; model: string }): void }) {
  const ready = catalog.filter((entry) => entry.ready);
  const models = ready.find((entry) => entry.id === provider)?.models.map((entry) => entry.id) ?? [];
  return (
    <View style={{ gap: 4 }}>
      <Chips s={s} options={ready.map((entry) => entry.id)} value={provider} onChange={(next) => onChange({ provider: next, model: ready.find((entry) => entry.id === next)?.models[0]?.id ?? "" })} />
      <Chips s={s} options={models} value={model} onChange={(next) => onChange({ provider, model: next })} />
    </View>
  );
}

function RoleEditor({ s, role, catalog, onChange, onRemove }: { s: Styles; role: Role; catalog: readonly ProviderInfo[]; onChange(role: Role): void; onRemove(): void }) {
  const { t } = useTranslation(messages);
  const [folders, setFolders] = useState(foldersText(role.folders));
  // Keyed by position, so resync when another role's removal hands this editor different folders.
  useEffect(() => {
    if (foldersText(parseFolders(folders)) !== foldersText(role.folders)) setFolders(foldersText(role.folders));
  }, [role.folders]);
  return (
    <View style={s.card}>
      <View style={s.row}>
        <TextInput style={[s.input, { flex: 1 }]} value={role.name} placeholder={t("role.name")} onChangeText={(name) => onChange({ ...role, name })} />
        <TextInput style={[s.input, { flex: 1 }]} value={role.workspace} placeholder={t("role.sharedWorkspace")} onChangeText={(workspace) => onChange({ ...role, workspace })} />
        <Button s={s} secondary label={t("role.remove")} onPress={onRemove} />
      </View>
      <ModelPicker s={s} catalog={catalog} provider={role.provider} model={role.model} onChange={(next) => onChange({ ...role, ...next })} />
      <TextInput
        style={s.input}
        value={folders}
        placeholder={t("role.folders")}
        onChangeText={(text) => {
          setFolders(text);
          onChange({ ...role, folders: parseFolders(text) });
        }}
      />
      <TextInput style={s.input} value={role.instructions} placeholder={t("role.instructions")} multiline onChangeText={(instructions) => onChange({ ...role, instructions })} />
    </View>
  );
}

/** Where the team goes: a workspace's project, or a project picked without a workspace. */
type Target = { workspaceId: string } | { projectId: string };

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
  const read = useRpc(teamReadRpc);
  const propose = useRpc(teamProposeRpc);
  const proposal = useRpc(teamProposalRpc);
  const apply = useRpc(teamApplyRpc);
  const restartOrchestrator = useRpc(teamRestartOrchestratorRpc);
  const proposeRole = useRpc(teamRoleProposeRpc);
  const roleProposal = useRpc(teamRoleProposalRpc);
  const pendingProposal = useRpc(teamPendingProposalRpc);
  const cancelProposal = useRpc(teamProposalCancelRpc);

  const current = useQuery({ queryKey: ["workspace-agents", "team", target], queryFn: () => read(target) });
  const [goal, setGoal] = useState("");
  const [plannerId, setPlannerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Team | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

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
    if (planning.data?.status === "done") setDraft(fresh(planning.data.team));
  }, [planning.data]);

  // One AI role request at a time; its result is appended to the draft and dropped if the draft was cancelled.
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePlannerId, setRolePlannerId] = useState<string | null>(null);
  const rolePlanning = useQuery({
    queryKey: ["workspace-agents", "role-proposal", rolePlannerId],
    queryFn: () => roleProposal({ agentId: rolePlannerId! }),
    enabled: rolePlannerId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 2000 : false),
  });
  useEffect(() => {
    if (rolePlanning.data?.status !== "done") return;
    const role = rolePlanning.data.role;
    const freeRole = (team: Team): Role => ({
      ...role,
      name: uniqueName(role.name, team.roles.map((other) => other.name)),
      workspace: isSharedRole(role) ? role.workspace : freeWorkspace(role.workspace, [...titles, team.orchestrator.workspace, ...team.roles.map((other) => other.workspace)]),
    });
    setDraft((current) => (current ? { ...current, roles: [...current.roles, freeRole(current)] } : current));
    setRoleDescription("");
    setRolePlannerId(null);
  }, [rolePlanning.data]);
  const startRole = useMutation({
    mutationFn: (team: Team) =>
      proposeRole({ ...target, description: roleDescription, team: { orchestratorWorkspace: team.orchestrator.workspace, roles: team.roles.map(({ name, workspace, folders }) => ({ name, workspace, folders })) } }),
    onSuccess: ({ agentId }) => setRolePlannerId(agentId),
  });
  const roleBusy = startRole.isPending || (rolePlannerId !== null && rolePlanning.data?.status !== "failed");

  const start = useMutation({ mutationFn: () => propose({ ...target, goal }), onSuccess: ({ agentId }) => setPlannerId(agentId) });
  const applied = useMutation({
    mutationFn: (team: Team) => apply({ ...target, team }),
    onSuccess: (result) => {
      void current.refetch();
      void queryClient.invalidateQueries({ queryKey: PROJECT_TEAMS_KEY });
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
  const updateRole = (index: number, role: Role) => draft && setDraft({ ...draft, roles: draft.roles.map((entry, at) => (at === index ? role : entry)) });

  if (current.isLoading) return <View style={[s.screen, s.body]}><Text style={s.muted}>{t("loading")}</Text></View>;
  if (current.error) return <View style={[s.screen, s.body]}><Text style={s.danger}>{String(current.error)}</Text></View>;
  const data = current.data!;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body}>
      <Text style={s.title}>{t("title", { project: data.project.name })}</Text>
      <Text style={s.muted}>{data.project.root}/{data.file ?? `${TEAMS_DIR}/`}</Text>

      {data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>)}
      {data.team && !draft ? (
        <View style={s.card}>
          <Text style={s.text}>{t("current.orchestrator", { workspace: data.team.orchestrator.workspace, model: `${data.team.orchestrator.provider}/${data.team.orchestrator.model}` })}</Text>
          {data.team.roles.map((role) => (
            <Text key={role.name} style={s.text}>• {role.name} → {isSharedRole(role) ? t("role.sharedWorkspace") : role.workspace} · {role.provider}/{role.model}{role.folders.length ? ` · ${role.folders.join(", ")}` : ""}</Text>
          ))}
          {data.validation.map((error) => <Text key={error.target + error.message} style={s.danger}>{error.target}: {error.message}</Text>)}
          <View style={s.row}>
            <Button s={s} label={t("current.edit")} onPress={() => setDraft(data.team)} />
            <Button s={s} secondary label={t("current.reapply")} disabled={applied.isPending || restarted.isPending} onPress={() => applied.mutate(data.team!)} />
            <Button s={s} secondary label={t("current.restart")} disabled={applied.isPending || restarted.isPending} onPress={() => setConfirmRestart(true)} />
          </View>
          <Text style={s.muted}>{t("current.restartHint")}</Text>
        </View>
      ) : null}

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

      {data.owner ? <Text style={s.muted}>{t("current.roleOf", data.owner)}</Text> : null}
      {data.owner ? null : !draft ? (
        <View style={s.card}>
          <Text style={s.text}>{t(here === null ? "create.intro" : "create.introHere")}</Text>
          <TextInput style={s.input} value={goal} placeholder={t("create.goalPlaceholder")} onChangeText={setGoal} />
          <View style={s.row}>
            <Button s={s} label={t("create.propose")} disabled={!goal.trim() || start.isPending || planning.data?.status === "running"} onPress={() => start.mutate()} />
            <Button s={s} secondary label={t("create.blank")} onPress={() => setDraft(fresh({ version: 1, goal, orchestrator: { workspace: "orchestrator", provider: "claude", model: catalog.find((entry) => entry.id === "claude")?.models[0]?.id ?? "" }, roles: [newRole(catalog, [])] }))} />
          </View>
          {plannerId && (!planning.data || planning.data.status === "running") ? <Text style={s.muted}>{t("create.planning")}</Text> : null}
          {planning.data?.status === "failed" ? planning.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
          {start.error ? <Text style={s.danger}>{String(start.error)}</Text> : null}
          {plannerId && navigation ? <Button s={s} secondary label={t("create.openPlanner")} onPress={() => navigation.openAgent({ agentId: plannerId })} /> : null}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={s.title}>{t("review.title")}</Text>
          <View style={s.card}>
            {here === null ? <>
              <Text style={s.text}>{t("review.orchestrator")}</Text>
              <TextInput style={s.input} value={draft.orchestrator.workspace} placeholder={t("role.workspace")} onChangeText={(workspace) => setDraft({ ...draft, orchestrator: { ...draft.orchestrator, workspace } })} />
            </> : <Text style={s.text}>{t("review.orchestratorHere", { workspace: here })}</Text>}
            <ModelPicker s={s} catalog={catalog} provider={draft.orchestrator.provider} model={draft.orchestrator.model} onChange={(next) => setDraft({ ...draft, orchestrator: { ...draft.orchestrator, ...next } })} />
          </View>
          {draft.roles.map((role, index) => (
            <RoleEditor key={index} s={s} role={role} catalog={catalog} onChange={(next) => updateRole(index, next)} onRemove={() => setDraft({ ...draft, roles: draft.roles.filter((_, at) => at !== index) })} />
          ))}
          <Button s={s} secondary label={t("review.addRole")} onPress={() => setDraft({ ...draft, roles: [...draft.roles, newRole(catalog, draft.roles.map((role) => role.name))] })} />
          <View style={s.card}>
            <TextInput style={s.input} value={roleDescription} placeholder={t("review.roleDescription")} multiline onChangeText={setRoleDescription} />
            <View style={s.row}>
              <Button s={s} secondary label={t("review.addRoleWithAi")} disabled={!roleDescription.trim() || roleBusy} onPress={() => startRole.mutate(draft)} />
              {rolePlannerId && navigation ? <Button s={s} secondary label={t("create.openPlanner")} onPress={() => navigation.openAgent({ agentId: rolePlannerId })} /> : null}
            </View>
            {roleBusy ? <Text style={s.muted}>{t("review.rolePlanning")}</Text> : null}
            {rolePlanning.data?.status === "failed" ? rolePlanning.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
            {startRole.error ? <Text style={s.danger}>{String(startRole.error)}</Text> : null}
          </View>
          {problems.map((problem) => <Text key={problem} style={s.danger}>{problem}</Text>)}
          <View style={s.row}>
            <Button s={s} label={t("review.apply")} disabled={problems.length > 0 || applied.isPending} onPress={() => applied.mutate(draft)} />
            <Button s={s} secondary label={t("review.cancel")} onPress={() => { if (plannerId) cancelled.mutate(); setDraft(null); setPlannerId(null); setRolePlannerId(null); }} />
          </View>
        </View>
      )}

      {cancelled.error ? <Text style={s.danger}>{String(cancelled.error)}</Text> : null}
      {applied.isPending ? <Text style={s.muted}>{t("result.applying")}</Text> : null}
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
