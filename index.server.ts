import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyResearch, readResearch, resetResearchMember } from "./server/research-team";
import { deleteTeam, projectTeamsList, reconnectTeam, restoreTeam } from "./server/team-directory";
import { researchApplyRpc, researchReadRpc, researchResetRpc, teamDeleteRpc, teamProjectsRpc, teamReconnectRpc, teamRestoreRpc } from "./shared/research-rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(researchReadRpc, readResearch);
  server.handle(researchApplyRpc, applyResearch);
  server.handle(researchResetRpc, resetResearchMember);
  server.handle(teamProjectsRpc, projectTeamsList);
  server.handle(teamDeleteRpc, deleteTeam);
  server.handle(teamReconnectRpc, reconnectTeam);
  server.handle(teamRestoreRpc, restoreTeam);
  return () => {};
}
