import type { Team } from "./team";
import { agentModeOf, type AgentFeatures, type ProviderEntry } from "./validate";

/** The project's local Claude settings; Paseo starts Claude agents with user, project and local settings. */
export const CLAUDE_LOCAL_SETTINGS = ".claude/settings.local.json";

/** A narrow allow rule, which Claude's Auto mode honours instead of asking its reviewer. */
export const PASEO_RUN_RULE = "Bash(paseo run *)";
export const PASEO_CREATE_AGENT_RULE = "mcp__paseo__create_agent";

/** Auto accept approves every ACP permission without a reviewer, so Claude must allow starting it. */
export function needsCreateAgentPermission(team: Team, features: Record<string, AgentFeatures>): boolean {
  return team.orchestrator.provider === "claude" && team.roles.some((role) => features[role.name]?.auto_accept === true);
}

/**
 * Whether the team's Claude orchestrator has to start a role in the mode chosen for it that runs unattended (such as
 * Antigravity's only mode, `full-access`): Claude's Auto-mode reviewer can deny such a start.
 */
export function needsRunPermission(team: Team, entries: readonly ProviderEntry[]): boolean {
  if (team.orchestrator.provider !== "claude") return false;
  return team.roles.some((role) => {
    const id = agentModeOf(entries, role.provider);
    const mode = entries.find((entry) => entry.provider === role.provider)?.modes?.find((candidate) => candidate.id === id);
    return mode?.isUnattended === true || mode?.colorTier === "dangerous";
  });
}

/** The settings with the rule added to `permissions.allow`, or null when it is already there. */
export function withAllowRule(settings: Record<string, unknown>, rule: string): Record<string, unknown> | null {
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(permissions.allow) ? (permissions.allow as unknown[]) : [];
  if (allow.includes(rule)) return null;
  return { ...settings, permissions: { ...permissions, allow: [...allow, rule] } };
}
