import { applyResearch, readResearch, resetResearchMember } from "./server/research-team";
import { researchApplyRpc, researchReadRpc, researchResetRpc } from "./shared/research-rpc";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyTeam, cancelProposal, deleteTeam, improveInstructions, instructionsProposal, pendingProposal, projectTeamsList, proposeTeamEdit, proposeTeam, readTeam, reconnectTeam, restartOrchestrator, restoreTeam, teamEditProposal, teamProposal, teamRoster } from "./server/team";
import { teamApplyRpc, teamDeleteRpc, teamInstructionsImproveRpc, teamInstructionsProposalRpc, teamPendingProposalRpc, teamProjectsRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamReconnectRpc, teamRestartOrchestratorRpc, teamRestoreRpc, teamEditProposalRpc, teamEditProposeRpc, teamRosterRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(researchReadRpc, readResearch);
  server.handle(researchApplyRpc, applyResearch);
  server.handle(researchResetRpc, resetResearchMember);
  server.handle(teamProjectsRpc, projectTeamsList);
  server.handle(teamDeleteRpc, deleteTeam);
  server.handle(teamReconnectRpc, reconnectTeam);
  server.handle(teamReadRpc, readTeam);
  server.handle(teamProposeRpc, proposeTeam);
  server.handle(teamProposalRpc, teamProposal);
  server.handle(teamPendingProposalRpc, pendingProposal);
  server.handle(teamProposalCancelRpc, cancelProposal);
  server.handle(teamEditProposeRpc, proposeTeamEdit);
  server.handle(teamEditProposalRpc, teamEditProposal);
  server.handle(teamInstructionsImproveRpc, improveInstructions);
  server.handle(teamInstructionsProposalRpc, instructionsProposal);
  server.handle(teamApplyRpc, applyTeam);
  server.handle(teamRestoreRpc, restoreTeam);
  server.handle(teamRestartOrchestratorRpc, restartOrchestrator);
  server.handle(teamRosterRpc, teamRoster);
  return () => {};
}
