import type { Team } from "./team";

/** Paseo's provider snapshot entry (`paseo.providers.snapshot().entries`), as far as validation needs it. */
export interface ProviderEntry {
  provider: string;
  enabled: boolean;
  status: string;
  models?: readonly { id: string; label: string; isSelectable?: boolean }[];
  modes?: readonly { id: string; label?: string; isUnattended?: boolean; colorTier?: string }[];
}

export interface ProviderInfo {
  id: string;
  ready: boolean;
  status: string;
  models: { id: string; label: string }[];
}

export interface TeamError {
  /** "orchestrator" or the role name. */
  target: string;
  message: string;
}

/**
 * The mode new agents start in instead of the provider's default; first match wins: `auto-review`, `auto`, an id or label
 * with a word starting with `auto`, then `isUnattended`, then `dangerous` (claude and codex snapshots carry only `colorTier`).
 * `auto-review` precedes `auto` because Codex's `auto` id is Default Permissions, which prompts, while Claude's `auto`
 * and Codex's `auto-review` both auto-review approvals.
 */
export function agentModeOf(entries: readonly ProviderEntry[], provider: string): string | undefined {
  const modes = entries.find((entry) => entry.provider === provider)?.modes ?? [];
  return (
    modes.find((mode) => mode.id === "auto-review") ??
    modes.find((mode) => mode.id === "auto") ??
    modes.find((mode) => /(^|[^a-z])auto/i.test(mode.id) || /(^|[^a-z])auto/i.test(mode.label ?? "")) ??
    modes.find((mode) => mode.isUnattended === true) ??
    modes.find((mode) => mode.colorTier === "dangerous")
  )?.id;
}

/** Each role's agent mode, keyed by role name. */
export function roleModes(team: Team, entries: readonly ProviderEntry[]): Record<string, string | undefined> {
  return Object.fromEntries(team.roles.map((role) => [role.name, agentModeOf(entries, role.provider)]));
}

/** The enabled providers and their selectable models. */
export function catalogFrom(entries: readonly ProviderEntry[]): ProviderInfo[] {
  return entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      id: entry.provider,
      ready: entry.status === "ready",
      status: entry.status,
      models: (entry.models ?? []).filter((model) => model.isSelectable !== false).map(({ id, label }) => ({ id, label })),
    }));
}

function check(target: string, provider: string, model: string, catalog: readonly ProviderInfo[]): TeamError | null {
  const info = catalog.find((entry) => entry.id === provider);
  if (!info) return { target, message: `provider "${provider}" is not enabled on this host` };
  if (!info.ready) return { target, message: `provider "${provider}" is not ready (${info.status})` };
  if (!info.models.some((entry) => entry.id === model)) return { target, message: `model "${model}" is not available for ${provider}` };
  return null;
}

/** Checks every provider/model in the team against what this host can run. */
export function validateTeam(team: Team, catalog: readonly ProviderInfo[]): TeamError[] {
  const errors = [check("orchestrator", team.orchestrator.provider, team.orchestrator.model, catalog)];
  for (const role of team.roles) errors.push(check(role.name, role.provider, role.model, catalog));
  return errors.filter((error): error is TeamError => error !== null);
}
