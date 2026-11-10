import { ResearchTeamSchema } from "../../shared/research-team";
export const teamFixture = () => ResearchTeamSchema.parse({ version: 2, id: "research", workspace: "research", commonPromptFiles: ["prompts/common.md"], orchestratorMemberId: "lead", roles: [
  { id: "anchor", name: "Anchor", promptFiles: ["prompts/anchor.md"] },
  { id: "programmer", name: "Programmer", promptFiles: ["prompts/programmer.md"] },
], members: [
  { id: "lead", roleId: "anchor", launchSnapshot: { provider: "test", model: "m", modeId: "plan" } },
  { id: "coder-a", roleId: "programmer", launchSnapshot: { provider: "test", model: "m", modeId: "ask", thinkingOptionId: "high", featureValues: { feature: { enabled: false } } } },
  { id: "coder-b", roleId: "programmer", launchSnapshot: { provider: "other", model: "m" } },
] });
