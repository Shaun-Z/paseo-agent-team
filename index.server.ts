import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyResearch, exportResearch, loadResearch, readResearch, resetResearchMember } from "./server/research-team";
import { deleteTeam, projectTeamsList, reconnectTeam, restoreTeam } from "./server/team-directory";
import { promptFiles } from "./server/prompt-files";
import { browseHost } from "./server/host-files";
import { cleanupGitImports, compareResearchGit, fetchResearchGit, importResearchGit } from "./server/git-team";
import { researchGitCompareRpc, researchGitFetchRpc, researchGitImportRpc } from "./shared/research-rpc";
import { researchApplyRpc, researchBrowseHostRpc, researchExportRpc, researchLoadRpc, researchPromptFilesRpc, researchReadRpc, researchResetRpc, teamDeleteRpc, teamProjectsRpc, teamReconnectRpc, teamRestoreRpc } from "./shared/research-rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(researchReadRpc, readResearch);
  server.handle(researchApplyRpc, applyResearch);
  server.handle(researchResetRpc, resetResearchMember);
  server.handle(researchLoadRpc, loadResearch);
  server.handle(researchExportRpc, exportResearch);
  server.handle(researchBrowseHostRpc, browseHost);
  server.handle(researchPromptFilesRpc, promptFiles);
  server.handle(researchGitFetchRpc, fetchResearchGit);
  server.handle(researchGitCompareRpc, compareResearchGit);
  server.handle(researchGitImportRpc, importResearchGit);
  server.handle(teamProjectsRpc, projectTeamsList);
  server.handle(teamDeleteRpc, deleteTeam);
  server.handle(teamReconnectRpc, reconnectTeam);
  server.handle(teamRestoreRpc, restoreTeam);
  return cleanupGitImports;
}
