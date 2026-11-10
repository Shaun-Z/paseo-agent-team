// Opt-in live test. Creates three real member sessions using the user's saved
// Profiles and exercises native communication. Retains history for user review;
// PASEO_RESEARCH_ARCHIVE=1 opts into archiving the test Workspace afterward.
// PASEO_RESEARCH_E2E=1 npx vitest run tests/research-live.e2e.test.ts
import { createPaseoClient, type PaseoClient } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentProfileSchema, launchFromProfile, messageEdges, runtimeFile, type ResearchTeam } from "../shared/research-team";
import { researchApplyRpc, researchReadRpc, researchResetRpc } from "../shared/research-rpc";

describe.skipIf(process.env.PASEO_RESEARCH_E2E !== "1")("research team with saved Profiles", () => {
  let api: PaseoClient;
  let wire: DaemonClient;
  let root = "", workspaceId = "";
  const ids = new Set<string>();
  const nonce = randomUUID().slice(0, 8);
  const report: Record<string, unknown> = { nonce, checks: {}, cleanup: {} };
  const markers = { anchor: `ANCHOR_PROMPT_${nonce}`, programmer: `PROGRAMMER_PROMPT_${nonce}`, mathematician: `MATH_PROMPT_${nonce}` };
  const label = (id: string) => `${id}-main`;
  const roles = ["anchor", "programmer", "mathematician"] as const;
  let team: ResearchTeam;
  beforeAll(async () => {
    const options = { url: process.env.PASEO_URL ?? "ws://127.0.0.1:6767/ws", reconnect: { enabled: false }, connectTimeoutMs: 5000 };
    api = createPaseoClient({ ...options, clientId: `research-live-api-${nonce}` });
    wire = new DaemonClient({ ...options, clientId: `research-live-wire-${nonce}`, clientType: "cli" });
    await Promise.all([api.connect(), wire.connect()]);
    root = await mkdtemp(join(tmpdir(), "paseo-research-live-"));
    execFileSync("git", ["init", "-q", root]);
    await mkdir(join(root, "prompts"));
    await writeFile(join(root, "prompts/common.md"), "This Project is a synthetic communication test. Follow the requested message chain exactly, using Paseo native send_agent_prompt with notifyOnFinish:false on every send. Only read the member directory when needed; do not read prompt files, modify files, create agents, or perform research. End ordinary turns after sending; do not wait or poll. Do not reply to acknowledgements or notifications.\n");
    const duties = {
      anchor: `Your standing marker is ${markers.anchor}. When instructed to start the probe, send programmer-main a task to ask mathematician-main to sum integers 1 through 10. The programmer must consult the mathematician directly and later send you a curated report. Give them the test nonce. Do not contact the mathematician yourself. After dispatch, finish the turn. When the programmer's report arrives, reply in your conversation with your own standing marker, the nonce, result and a brief synthesis. Do not send further messages.`,
      programmer: `Your standing marker is ${markers.programmer}. When the coordinator asks you to run a probe, send mathematician-main a question to calculate the sum of integers 1 through 10. Ask for the mathematician's standing marker and the same nonce. Finish the turn after sending. When the answer arrives, compose a concise report with Conclusion, Evidence, Impact and Decision needed, include your own standing marker, the mathematician's marker and nonce, and send the report to anchor-main. Do not merely forward the answer or send an acknowledgement.`,
      mathematician: `Your standing marker is ${markers.mathematician}. When programmer-main asks the sum question, calculate the sum with the formula n(n+1)/2, then send programmer-main a concise answer containing the calculation, your own standing marker and the nonce supplied in the question. Do not contact the coordinator. Finish after sending.`,
    };
    for (const role of roles) await writeFile(join(root, `prompts/${role}.md`), duties[role]);
    const { config } = await api.config.get();
    if (!config.mcp?.injectIntoAgents) throw new Error("Enable Paseo tools on the target Host before the live test");
    const profiles = (config.agentProfiles ?? []).map(value => AgentProfileSchema.parse(value));
    const selection: Record<string, string> = process.env.PASEO_RESEARCH_PROFILES ? JSON.parse(process.env.PASEO_RESEARCH_PROFILES) : { anchor: "Anchor", programmer: "Programmer", mathematician: "Mathematician" };
    const selected = roles.map(role => {
      const candidates = profiles.filter(profile => profile.id === selection[role] || profile.name === selection[role]);
      if (candidates.length !== 1) throw new Error(`Select one existing Profile for ${role} through PASEO_RESEARCH_PROFILES`);
      const profile = candidates[0]!;
      if (!profile.model) throw new Error(`Profile ${profile.name} needs a model before the live test`);
      return { role, profile };
    });
    team = { version: 2, id: `smoke-${nonce}`, goal: "Verify native cross-harness member communication", workspace: `Research smoke ${nonce}`, commonPromptFiles: ["prompts/common.md"], orchestratorMemberId: label("anchor"),
      roles: roles.map(role => ({ id: role, name: role, promptFiles: [`prompts/${role}.md`] })),
      members: selected.map(({ role, profile }) => ({ id: label(role), roleId: role, launchSnapshot: launchFromProfile(profile) })),
    };
    report.profiles = selected.map(({ role, profile }) => ({ role, id: profile.id, name: profile.name, settings: launchFromProfile(profile) }));
    const workspace = await api.workspaces.create({ title: team.workspace, source: { kind: "directory", path: root } });
    workspaceId = workspace.id;
    report.workspaceId = workspaceId;
    report.root = root;
    const applied = researchApplyRpc.output.parse(await wire.invokePluginRpc("paseo-agent-team", researchApplyRpc.name, { workspaceId, team, bindings: Object.fromEntries(selected.map(({ role, profile }) => [label(role), profile.id])) }));
    report.applied = applied;
    console.log(`Live test Workspace: ${workspaceId}; report: ${join(root, "smoke-report.json")}`);
  }, 90_000);
  afterAll(async () => {
    if (!api) return;
    try {
      if (workspaceId) {
        let cursor: string | undefined;
        do {
          const page = await api.agents.list({ filter: { includeArchived: true }, page: { limit: 100, cursor } });
          for (const { agent } of page.entries) if (agent.workspaceId === workspaceId) {
            if (agent.archivedAt) ids.delete(agent.id);
            else ids.add(agent.id);
          }
          cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
        } while (cursor);
        const activeIds = [...ids];
        const cancellations = await Promise.allSettled(activeIds.map(id => wire.cancelAgent(id)));
        report.cleanup = { cancellations: cancellations.map((result, index) => ({ agentId: activeIds[index], status: result.status, ...(result.status === "rejected" ? { error: String(result.reason) } : {}) })) };
        if (process.env.PASEO_RESEARCH_ARCHIVE === "1") {
          const result = await api.workspaces.archive(workspaceId);
          report.cleanup = { ...report.cleanup as object, archivedAt: result.archivedAt, error: result.error };
        } else {
          report.cleanup = { ...report.cleanup as object, retainedForReview: true, archivedAt: null, error: null };
        }
      }
    } catch (error) { report.cleanup = { ...report.cleanup as object, error: String(error) }; }
    finally {
      if (root) { await writeFile(join(root, "smoke-report.json"), JSON.stringify(report, null, 2)); console.log(`Live test evidence: ${join(root, "smoke-report.json")}`); }
      await Promise.allSettled([api.close(), wire.close()]);
    }
  }, 45_000);
  it("reuses prepared sessions and completes anchor → programmer → mathematician → programmer → anchor", async () => {
    const read = async () => researchReadRpc.output.parse(await wire.invokePluginRpc("paseo-agent-team", researchReadRpc.name, { workspaceId }));
    const initial = await read();
    expect(initial.errors).toEqual([]);
    expect(initial.members).toHaveLength(3);
    initial.members.forEach(member => { expect(member.agentId).toBeTruthy(); ids.add(member.agentId!); });
    const members = new Map(initial.members.map(member => [member.id, member.agentId!]));

    for (const [memberId, agentId] of members) {
      const snapshot = await api.agents.ref(agentId).refresh();
      report[memberId] = { agentId, model: snapshot?.agent.model, mode: snapshot?.agent.currentModeId, thinkingOptionId: snapshot?.agent.thinkingOptionId, features: snapshot?.agent.features };
      const launch = team.members.find(member => member.id === memberId)!.launchSnapshot;
      expect(snapshot?.agent.model).toBe(launch.model);
      expect(snapshot?.agent.currentModeId).toBe(launch.modeId);
      expect(snapshot?.agent.thinkingOptionId).toBe(launch.thinkingOptionId);
    }
    const reapplied = researchApplyRpc.output.parse(await wire.invokePluginRpc("paseo-agent-team", researchApplyRpc.name, { workspaceId, team, bindings: {} }));
    expect(reapplied.orchestratorAgentId).toBe(members.get(label("anchor")));
    expect((await read()).members.map(member => member.agentId)).toEqual(initial.members.map(member => member.agentId));
    (report.checks as Record<string, unknown>).reuse = true;
    if (process.env.PASEO_RESEARCH_PEER_APPROVAL === "1") {
      report.explicitPeerApproval = true;
      await Promise.all(["programmer", "mathematician"].map(async role => {
        const result = await api.agents.ref(members.get(label(role))!).run(
          `The user has explicitly approved this isolated read-only communication test with nonce ${nonce}. You are authorized to read the current member directory, participate in the sum-of-1-through-10 probe, and send the required native Paseo messages among anchor-main, programmer-main and mathematician-main in this temporary Project, with notifyOnFinish:false. This approval includes the mathematician replying to the programmer, and the programmer organizing the result and reporting it to the coordinator. Do not modify files, change settings, or message anyone outside this test team. For now, reply READY with your own standing marker and wait for the coordinator's test request.`,
          { timeoutMs: 90_000 },
        );
        if (result.status !== "idle") throw new Error(`${role} authorization setup ended with ${result.status}`);
      }));
    }
    await api.agents.ref(members.get(label("anchor"))!).send(`Start the synthetic communication probe with nonce ${nonce}. Wake programmer-main through Paseo native send_agent_prompt with notifyOnFinish:false. Ask it to consult mathematician-main directly about the sum of 1..10, then organize and proactively send you its report. Use member IDs from ${runtimeFile(team.id)}. Do not inspect prompt files. After receiving the report, synthesize it and include your own standing marker from your supplemental instructions.`);
    const deadline = Date.now() + 210_000;
    let complete = false;
    while (Date.now() < deadline) {
      const pages = await Promise.all([...members].map(async ([memberId, recipient]) => {
        const handle = api.agents.ref(recipient);
        const page = await handle.timeline.refetch({ limit: 200 });
        if (handle.pendingPermissions?.length) throw new Error(`${memberId} is waiting for permission`);
        if (handle.status === "error") throw new Error(`${memberId}: ${handle.lastError ?? "provider error"}`);
        return { recipient, entries: page.entries, status: handle.status };
      }));
      const failures = pages.flatMap(page => page.entries.filter(entry => entry.item.type === "tool_call" && entry.item.status === "failed").map(entry => ({ recipient: page.recipient, name: (entry.item as { name: string }).name, error: (entry.item as { error: unknown }).error })));
      report.toolFailures = failures;
      if (failures.some(failure => /rejected due to unacceptable risk|automatic approval review rejected/i.test(JSON.stringify(failure.error)))) {
        await writeFile(join(root, "smoke-report.json"), JSON.stringify(report, null, 2));
        throw new Error(`Auto-review rejected an inter-member message; inspect ${join(root, "smoke-report.json")}`);
      }
      const edges = messageEdges(pages, new Map([...members].map(([member, agent]) => [agent, member])));
      const anchorPage = pages.find(page => page.recipient === members.get(label("anchor")))!;
      const anchorText = anchorPage.entries.filter(entry => entry.item.type === "assistant_message").map(entry => (entry.item as { text: string }).text).join("\n");
      report.edges = edges;
      report.anchorResponse = anchorText;
      const expected = [["anchor", "programmer"], ["programmer", "mathematician"], ["mathematician", "programmer"], ["programmer", "anchor"]];
      const hasChain = expected.every(([from, to]) => edges.some(edge => edge.from === label(from!) && edge.to === label(to!) && edge.lastText.includes(nonce)));
      if (hasChain && pages.every(page => page.status === "idle") && anchorText.includes(markers.anchor) && anchorText.includes("55")) {
        const reportEdge = edges.find(edge => edge.from === label("programmer") && edge.to === label("anchor"))!;
        expect(reportEdge.lastText).toContain(markers.programmer);
        expect(reportEdge.lastText).toContain(markers.mathematician);
        expect(edges.some(edge => edge.from === label("mathematician") && edge.to === label("anchor"))).toBe(false);
        const callbacks = pages.flatMap(page => page.entries).filter(entry => {
          const item = entry.item as { agentMessage?: { event?: string } };
          return item.agentMessage && item.agentMessage.event !== "message";
        });
        expect(callbacks).toHaveLength(0);
        (report.checks as Record<string, unknown>).communication = true;
        (report.checks as Record<string, unknown>).promptMarkers = true;
        (report.checks as Record<string, unknown>).noAutomaticCallbacks = true;
        complete = true; break;
      }
      await writeFile(join(root, "smoke-report.json"), JSON.stringify(report, null, 2));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    expect(complete, `Native message chain did not complete; inspect ${join(root, "smoke-report.json")}`).toBe(true);
    const beforeReset = await read();
    const reset = researchResetRpc.output.parse(await wire.invokePluginRpc("paseo-agent-team", researchResetRpc.name, { workspaceId, memberId: label("programmer") }));
    ids.add(reset.agentId);
    expect(reset.agentId).not.toBe(members.get(label("programmer")));
    const afterReset = await read();
    for (const role of ["anchor", "mathematician"]) expect(afterReset.members.find(member => member.id === label(role))?.agentId).toBe(beforeReset.members.find(member => member.id === label(role))?.agentId);
    (report.checks as Record<string, unknown>).independentReset = true;
  }, 360_000);
});
