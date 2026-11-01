import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyTeam, cancelProposal, deleteTeam, pendingProposal, projectTeamsList, proposeRole, proposeTeam, readTeam, reconnectTeam, restartOrchestrator, roleProposal, teamProposal, teamRoster } from "./server/team";
import { teamApplyRpc, teamDeleteRpc, teamPendingProposalRpc, teamProjectsRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamReconnectRpc, teamRestartOrchestratorRpc, teamRoleProposalRpc, teamRoleProposeRpc, teamRosterRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(teamProjectsRpc, projectTeamsList);
  server.handle(teamDeleteRpc, deleteTeam);
  server.handle(teamReconnectRpc, reconnectTeam);
  server.handle(teamReadRpc, readTeam);
  server.handle(teamProposeRpc, proposeTeam);
  server.handle(teamProposalRpc, teamProposal);
  server.handle(teamPendingProposalRpc, pendingProposal);
  server.handle(teamProposalCancelRpc, cancelProposal);
  server.handle(teamRoleProposeRpc, proposeRole);
  server.handle(teamRoleProposalRpc, roleProposal);
  server.handle(teamApplyRpc, applyTeam);
  server.handle(teamRestartOrchestratorRpc, restartOrchestrator);
  server.handle(teamRosterRpc, teamRoster);
  return () => {};
}
