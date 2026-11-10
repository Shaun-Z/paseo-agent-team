import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { RpcOutput } from "@getpaseo/plugin";
import type { researchApplyRpc } from "../shared/research-rpc";
import { ResearchTeamPanel } from "./ResearchTeam";

export const PROJECT_TEAMS_KEY = ["workspace-agents", "projects"] as const;

type EditorProps = Pick<PluginScreenProps, "theme" | "layout" | "navigation"> & {
  target: { workspaceId: string } | { projectId: string };
  onApplied?(result: RpcOutput<typeof researchApplyRpc>): void;
  openDashboard?(): void;
};
export function TeamPanel({ workspaceId, ...props }: PluginWorkspacePanelProps & { openDashboard?(): void }) {
  return <TeamEditor {...props} target={{ workspaceId }} />;
}
export function TeamEditor(props: EditorProps) {
  return <ResearchTeamPanel {...props} />;
}
