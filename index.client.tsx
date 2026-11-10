import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentDashboard } from "./client/AgentDashboard";
import { messages } from "./client/i18n";
import { TeamPanel } from "./client/TeamPanel";
import { SCREEN_ID, TeamScreen, TeamSidebarItem } from "./client/TeamScreen";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({ id: "agent-dashboard", title: messages.message("dashboardTitle"), icon: "Network", locations: ["workspace", "explorer"], Component: props => <AgentDashboard {...props} openConfiguration={() => client.openPanel("team", { workspaceId: props.workspaceId })} /> });
  client.addWorkspacePanel({ id: "team", title: messages.message("panelTitle"), icon: "Users", locations: ["workspace"], Component: props => <TeamPanel {...props} openDashboard={() => client.openPanel("agent-dashboard", { workspaceId: props.workspaceId })} /> });
  client.addScreen({ id: SCREEN_ID, title: messages.message("commandTitle"), Component: (props) => <TeamScreen {...props} openTeamPanel={(workspaceId) => client.openPanel("team", { workspaceId })} /> });
  client.addSidebarHeaderItem({ id: "team", title: messages.message("commandTitle"), Component: TeamSidebarItem });
  client.addCommandCenterItem({
    id: "team",
    title: messages.message("commandTitle"),
    icon: "Users",
    keywords: ["team", "agents", "orchestrator", "팀", "에이전트", "チーム", "エージェント", "团队", "智能体"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("team");
    },
  });
  return () => {};
}
