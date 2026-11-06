import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useTranslation } from "@getpaseo/plugin/client";
import { SidebarRow, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { messages } from "./i18n";
import { teamDeleteRpc, teamProjectsRpc, teamReconnectRpc, teamRestoreRpc } from "../shared/rpc";
import { Button, PROJECT_TEAMS_KEY, styles, TeamEditor } from "./TeamPanel";

export const SCREEN_ID = "team";

/** Every project and its teams, refetched when the host's projects change. */
function useProjectTeams() {
  const list = useRpc(teamProjectsRpc);
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  useEffect(() => paseo.projects.subscribe(() => void queryClient.invalidateQueries({ queryKey: PROJECT_TEAMS_KEY })), [paseo, queryClient]);
  return useQuery({ queryKey: PROJECT_TEAMS_KEY, queryFn: () => list({}) });
}

export function TeamSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const { t } = useTranslation(messages);
  return <SidebarRow icon="Users" label={t("commandTitle")} active={currentScreen?.screenId === SCREEN_ID} onPress={() => openScreen({ screenId: SCREEN_ID })} />;
}

/** Browse every project's agent teams, open an existing team's panel, or create a new team. */
export function TeamScreen({ theme, layout, navigation, openTeamPanel }: PluginScreenProps & { openTeamPanel?: (workspaceId: string) => void }) {
  const s = useMemo(() => styles(theme.colors, layout.compact), [theme, layout.compact]);
  const { t } = useTranslation(messages);
  const projects = useProjectTeams();
  const toast = useToast();
  const [projectId, setProjectId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const remove = useRpc(teamDeleteRpc);
  const reconnect = useRpc(teamReconnectRpc);
  const restore = useRpc(teamRestoreRpc);
  // The team row waiting for a second press, keyed by project and file.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const invalidateTeams = () => {
    void queryClient.invalidateQueries({ queryKey: PROJECT_TEAMS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["workspace-agents", "team"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "agents"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "roster"] });
  };
  const deleted = useMutation({
    mutationFn: (team: { projectId: string; file: string }) => remove(team),
    onSuccess: (result) => {
      if (result.failures.length) toast.error(t("screen.deleteFailed", { failure: result.failures.join("; ") }));
      if (result.fileFailures.length) toast.error(t("screen.deleteFileFailed", { failure: result.fileFailures.join("; ") }));
      setConfirming(null);
      invalidateTeams();
    },
    onError: (error) => toast.error(String(error)),
  });
  const reconnected = useMutation({
    mutationFn: (input: { projectId: string; file: string; workspaceId: string }) => reconnect(input),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.errors.join("; "));
        return;
      }
      setReconnecting(null);
      invalidateTeams();
    },
    onError: (error) => toast.error(String(error)),
  });

  const openApplied = (result: Extract<RpcOutput<typeof teamRestoreRpc>, { ok: true }>) => {
    if (result.cleanup.length) toast.error(t("result.cleanupFailed", { failure: result.cleanup.join("; ") }));
    navigation?.openWorkspace({ workspaceId: result.workspaces[0]!.id });
  };
  const restored = useMutation({
    mutationFn: (input: { projectId: string; file: string }) => restore(input),
    onSuccess: (result) => {
      if (!result.ok) return;
      setReconnecting(null);
      invalidateTeams();
      openApplied(result);
    },
  });
  const reconnectBusy = reconnected.isPending || restored.isPending;

  if (projectId) {
    return (
      <View style={s.screen}>
        <View style={[s.row, { padding: layout.compact ? 12 : 20, paddingBottom: 0 }]}>
          <Button s={s} secondary label={t("screen.back")} onPress={() => setProjectId(null)} />
        </View>
        <TeamEditor
          theme={theme}
          layout={layout}
          navigation={navigation}
          target={{ projectId }}
          onApplied={openApplied}
        />
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body}>
      <Text style={s.title}>{t("screen.title")}</Text>
      {projects.isLoading ? <Text style={s.muted}>{t("loading")}</Text> : null}
      {projects.error ? <Text style={s.danger}>{String(projects.error)}</Text> : null}
      {projects.data?.map((project) => {
        const occupiedWorkspaces = new Set(project.teams.map((team) => team.workspaceId).filter((id) => id != null));
        const reconnectWorkspaces = project.workspaces.filter((workspace) => !occupiedWorkspaces.has(workspace.id));
        return (
        <View key={project.id} style={s.card}>
          <Text style={s.text}>{project.name}</Text>
          <Text style={s.muted}>{project.root}</Text>
          {project.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>)}
          {!project.teams.length ? <Text style={s.muted}>{t("screen.noTeams")}</Text> : null}
          {project.teams.map((team) => (
            <View key={team.file} style={s.row}>
              <Text style={s.text}>{team.orchestratorWorkspace}</Text>
              {team.goal ? <Text style={s.muted}>{team.goal}</Text> : null}
              <Text style={s.muted}>{t("screen.roles", { count: team.roles })}</Text>
              {!team.workspaceId ? <Text style={s.muted}>{t("screen.workspaceMissing")}</Text> : null}
              <Button s={s} secondary label={t("screen.openTeam")} disabled={!team.workspaceId} onPress={() => team.workspaceId && openTeamPanel?.(team.workspaceId)} />
              {!team.workspaceId ? <Button s={s} secondary label={t("screen.reconnect")} disabled={reconnectBusy} onPress={() => { restored.reset(); setReconnecting(`${project.id}:${team.file}`); }} /> : null}
              <Button s={s} secondary label={t("screen.deleteTeam")} disabled={deleted.isPending} onPress={() => setConfirming(`${project.id}:${team.file}`)} />
              {!team.workspaceId && reconnecting === `${project.id}:${team.file}` ? (
                <View style={[s.card, { width: "100%" }]}>
                  <Text style={s.text}>{t("screen.reconnectPick")}</Text>
                  {!reconnectWorkspaces.length ? <Text style={s.muted}>{t("screen.noWorkspaceToPick")}</Text> : null}
                  <View style={s.row}>
                    {reconnectWorkspaces.map((workspace) => (
                      <Button key={workspace.id} s={s} label={workspace.title} disabled={reconnectBusy} onPress={() => reconnected.mutate({ projectId: project.id, file: team.file, workspaceId: workspace.id })} />
                    ))}
                    <Button s={s} secondary label={t("screen.startNewWorkspace")} disabled={reconnectBusy} onPress={() => restored.mutate({ projectId: project.id, file: team.file })} />
                    <Button s={s} secondary label={t("review.cancel")} disabled={reconnectBusy} onPress={() => setReconnecting(null)} />
                  </View>
                  {reconnectBusy ? <View style={s.row}><ActivityIndicator color={theme.colors.accent} /><Text style={s.muted}>{t(restored.isPending ? "result.applying" : "loading")}</Text></View> : null}
                  {restored.variables?.projectId === project.id && restored.variables.file === team.file ? <>
                    {restored.error ? <Text style={s.danger}>{String(restored.error)}</Text> : null}
                    {restored.data && !restored.data.ok ? restored.data.errors.map((error) => <Text key={error} style={s.danger}>{error}</Text>) : null}
                  </> : null}
                </View>
              ) : null}
              {confirming === `${project.id}:${team.file}` ? (
                <View style={[s.card, { width: "100%" }]}>
                  <Text style={s.text}>{t("screen.deleteConfirm", { file: team.file })}</Text>
                  <View style={s.row}>
                    <Button s={s} label={t("screen.deleteYes")} disabled={deleted.isPending} onPress={() => deleted.mutate({ projectId: project.id, file: team.file })} />
                    <Button s={s} secondary label={t("review.cancel")} disabled={deleted.isPending} onPress={() => setConfirming(null)} />
                  </View>
                </View>
              ) : null}
            </View>
          ))}
          <View style={s.row}>
            <Button s={s} label={t("screen.newTeam")} onPress={() => setProjectId(project.id)} />
          </View>
        </View>
        );
      })}
    </ScrollView>
  );
}
