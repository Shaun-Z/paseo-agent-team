import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useTabState, useTranslation } from "@getpaseo/plugin/client";
import { Icon, Loading } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { z } from "zod";
import { buildAgentForest, type AgentNode } from "../shared/agent-tree";
import { providerIcon } from "../shared/provider-icons";
import { teamRosterRpc } from "../shared/rpc";
import {
  applySubagentUpdate,
  mergeSubagents,
  subagentAgents,
  subagentsFromTimeline,
  type ProviderSubagent,
} from "../shared/subagents";
import { messages } from "./i18n";

const RED = "#ff5a5f";
const GLOW = "#ff9a9d";
const AMBER = "#ffb347";
const stateSchema = z.object({ showClosed: z.boolean() });
const DEFAULT_STATE = { showClosed: false };

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type TreeProps = {
  node: AgentNode;
  colors: Colors;
  compact: boolean;
  icons: Map<string, string | undefined>;
  flow: Animated.Value;
  glow: Animated.Value;
  packet: Animated.Value;
  phase?: Animated.AnimatedModulo<number>;
  open?: (id: string) => void;
  caption: (node: AgentNode) => string;
  waitingLabel: string;
};

function Logo({
  node,
  icons,
  colors,
  size,
}: {
  node: AgentNode;
  icons: TreeProps["icons"];
  colors: Colors;
  size: number;
}) {
  const icon = providerIcon(
    node.agent.provider,
    icons.get(node.agent.provider),
  );
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 3,
        backgroundColor: colors.surface2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {icon.kind === "svg" ? (
        <Icon
          icon={{ svg: icon.svg }}
          size={size - 10}
          color={colors.foreground}
        />
      ) : (
        <Text
          style={{
            color: colors.foreground,
            fontWeight: "700",
            fontSize: size / 2,
          }}
        >
          {icon.letter}
        </Text>
      )}
    </View>
  );
}

function Badge({
  node,
  colors,
  flow,
  waitingLabel,
}: Pick<TreeProps, "node" | "colors" | "flow" | "waitingLabel">) {
  if (node.waiting)
    return (
      <Text
        style={{ color: colors.foregroundMuted, fontSize: 9, fontWeight: "700" }}
      >
        {waitingLabel}
      </Text>
    );
  if (!node.badge) return null;
  if (node.badge === "running")
    return (
      <Animated.View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: AMBER,
          opacity: flow.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0.45, 1, 0.45],
          }),
        }}
      />
    );
  return (
    <View
      style={{
        width: 17,
        height: 17,
        borderRadius: 9,
        backgroundColor:
          node.badge === "attention" ? RED : colors.statusSuccess,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: colors.accentForeground,
          fontSize: 11,
          fontWeight: "800",
          lineHeight: 14,
        }}
      >
        {node.badge === "attention" ? "!" : "✓"}
      </Text>
    </View>
  );
}

function Card(props: TreeProps & { root?: boolean; collapseRoot?: boolean }) {
  const {
    node,
    colors,
    compact,
    open,
    caption,
    flow,
    glow,
    icons,
    root,
    collapseRoot,
    phase,
    waitingLabel,
  } = props;
  const collapsed = Boolean(root && collapseRoot);
  const content = collapsed ? (
    <>
      <Logo node={node} icons={icons} colors={colors} size={26} />
      {node.model ? (
        <Text
          numberOfLines={2}
          style={{
            color: colors.foregroundMuted,
            fontSize: 9,
            textAlign: "center",
            maxWidth: "100%",
          }}
        >
          {node.model}
        </Text>
      ) : null}
      <View style={{ position: "absolute", right: 6, top: 6 }}>
        <Badge
          node={node}
          colors={colors}
          flow={flow}
          waitingLabel={waitingLabel}
        />
      </View>
    </>
  ) : (
    <>
      <Logo node={node} icons={icons} colors={colors} size={26} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.foregroundMuted,
            fontSize: 9,
            fontWeight: "700",
            letterSpacing: 0.8,
            textTransform: "uppercase",
            paddingRight: 18,
          }}
        >
          {caption(node)}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}
        >
          {node.title}
        </Text>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 3,
          }}
        >
          {[node.model, node.effort, node.mode].map((chip, i) =>
            chip ? (
              <View
                key={i}
                style={{
                  backgroundColor: colors.surface2,
                  borderWidth: i === 2 ? 1 : 0,
                  borderColor: colors.accent,
                  borderRadius: 5,
                  paddingHorizontal: 5,
                  paddingVertical: 2,
                  maxWidth: "100%",
                  opacity: i === 1 && node.effortDefault ? 0.55 : 1,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: i === 2 ? colors.accent : colors.foregroundMuted,
                    fontSize: 9,
                  }}
                >
                {chip}
                </Text>
              </View>
            ) : null,
          )}
        </View>
      </View>
      <View style={{ position: "absolute", right: 9, top: 9 }}>
        <Badge
          node={node}
          colors={colors}
          flow={flow}
          waitingLabel={waitingLabel}
        />
      </View>
    </>
  );
  const style = {
    width: collapsed
      ? COLLAPSED_ROOT_WIDTH
      : compact
        ? root
          ? ROOT_WIDTH.compact
          : CHILD_WIDTH.compact
        : root
          ? ROOT_WIDTH.regular
          : CHILD_WIDTH.regular,
    minHeight: 76,
    padding: collapsed ? 8 : 10,
    flexDirection: collapsed ? ("column" as const) : ("row" as const),
    alignItems: collapsed ? ("center" as const) : undefined,
    justifyContent: collapsed ? ("center" as const) : undefined,
    gap: collapsed ? 6 : 9,
    borderWidth: 1,
    borderColor: node.live
      ? RED
      : node.delegating
        ? AMBER
        : root
          ? colors.accent
          : colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface1,
    shadowColor: RED,
    shadowOpacity: node.live ? 0.125 : 0,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    // A role with no session yet: dimmed, and nothing to open.
    opacity: node.waiting ? 0.45 : node.kind === "subagent" ? 0.85 : 1,
  };
  const card = open && !node.waiting && node.kind !== "subagent" ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={node.title}
      onPress={() => open(node.agent.id)}
      style={style}
    >
      {content}
    </Pressable>
  ) : (
    <View accessibilityLabel={node.title} style={style}>
      {content}
    </View>
  );
  if (!node.live) return card;
  const ping =
    phase?.interpolate({
      inputRange: [0, 0.84, 0.92, 1],
      outputRange: [1, 1, 1.03, 1],
    }) ?? 1;
  const flash =
    phase?.interpolate({
      inputRange: [0, 0.84, 0.92, 1],
      outputRange: [0, 0, 0.225, 0],
    }) ?? 0;
  return (
    <Animated.View style={{ transform: [{ scale: ping }] }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -1,
          bottom: -1,
          left: -1,
          right: -1,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: GLOW,
          backgroundColor: GLOW,
          shadowColor: GLOW,
          shadowOpacity: 0.225,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
          opacity: glow.interpolate({
            inputRange: [0, 1],
            outputRange: [0.04, 0.16],
          }),
          transform: [
            {
              scale: glow.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.02],
              }),
            },
          ],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -2,
          bottom: -2,
          left: -2,
          right: -2,
          borderRadius: 12,
          backgroundColor: GLOW,
          shadowColor: GLOW,
          shadowOpacity: 0.7,
          shadowRadius: 14,
          elevation: 8,
          opacity: flash,
        }}
      />
      {card}
    </Animated.View>
  );
}

function Dashes({
  flow,
  vertical = false,
  reverse = false,
}: {
  flow: Animated.Value;
  vertical?: boolean;
  reverse?: boolean;
}) {
  const [length, setLength] = useState(0);
  const count = Math.ceil(length / 12) + 2;
  const offset = flow.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? [12, 0] : [0, 12],
  });
  return (
    <View
      pointerEvents="none"
      onLayout={(event) =>
        setLength(
          vertical
            ? event.nativeEvent.layout.height
            : event.nativeEvent.layout.width,
        )
      }
      style={{ flex: 1, overflow: "hidden" }}
    >
      <Animated.View
        style={{
          position: "absolute",
          flexDirection: vertical ? "column" : "row",
          ...(vertical ? { top: -12 } : { left: -12 }),
          transform: [
            vertical ? { translateY: offset } : { translateX: offset },
          ],
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <View
            key={i}
            style={{
              width: vertical ? 2 : 6,
              height: vertical ? 6 : 2,
              marginBottom: vertical ? 6 : 0,
              marginRight: vertical ? 0 : 6,
              backgroundColor: RED,
            }}
          />
        ))}
      </Animated.View>
    </View>
  );
}

const ROOT_WIDTH = { compact: 205, regular: 240 };
const CHILD_WIDTH = { compact: 185, regular: 220 };
const COLLAPSED_ROOT_WIDTH = 84;
const TREE_PAD_X = 16;
const STEM = 20;
const BRANCH = 24;
const ARRIVAL = 0.84;

function treeDepth(node: AgentNode): number {
  if (!node.children.length) return 0;
  return 1 + Math.max(...node.children.map(treeDepth));
}

function expandedTreeWidth(node: AgentNode, compact: boolean): number {
  const rootWidth = compact ? ROOT_WIDTH.compact : ROOT_WIDTH.regular;
  const childWidth = compact ? CHILD_WIDTH.compact : CHILD_WIDTH.regular;
  return rootWidth + treeDepth(node) * (STEM + BRANCH + childWidth);
}

function CommandPacket({
  phase,
  junction,
  center,
  colors,
}: {
  phase: Animated.AnimatedModulo<number>;
  junction: number;
  center: number;
  colors: Colors;
}) {
  const distance = STEM + Math.abs(center - junction) + BRANCH;
  const first = (ARRIVAL * STEM) / distance;
  const second = (ARRIVAL * (STEM + Math.abs(center - junction))) / distance;
  const input =
    second > first ? [0, first, second, ARRIVAL, 1] : [0, first, ARRIVAL, 1];
  const x =
    second > first
      ? [0, STEM, STEM, STEM + BRANCH, STEM + BRANCH]
      : [0, STEM, STEM + BRANCH, STEM + BRANCH];
  const y =
    second > first
      ? [junction, junction, center, center, center]
      : [junction, junction, center, center];
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: -3,
        top: -3,
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: colors.foreground,
        shadowColor: RED,
        shadowOpacity: 1,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 0 },
        elevation: 5,
        opacity: phase.interpolate({
          inputRange: [0, 0.02, ARRIVAL, ARRIVAL + 0.01, 1],
          outputRange: [0, 1, 1, 0, 0],
        }),
        transform: [
          {
            translateX: phase.interpolate({
              inputRange: input,
              outputRange: x,
            }),
          },
          {
            translateY: phase.interpolate({
              inputRange: input,
              outputRange: y,
            }),
          },
        ],
      }}
    />
  );
}

function Connector({
  colors,
  flow,
  junction,
  children,
  centers,
  phases,
}: {
  colors: Colors;
  flow: Animated.Value;
  junction: number;
  children: AgentNode[];
  centers: Record<string, number>;
  phases: Record<string, Animated.AnimatedModulo<number>>;
}) {
  const positioned = children.filter(
    (child) => centers[child.agent.id] !== undefined,
  );
  if (!positioned.length) return null;
  const ys = positioned.map((child) => centers[child.agent.id]!);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: STEM + BRANCH,
      }}
    >
      {max > min && (
        <View
          style={{
            position: "absolute",
            left: STEM,
            top: min + 8,
            height: Math.max(0, max - min - 16),
            borderLeftWidth: 1,
            borderColor: colors.border,
          }}
        />
      )}
      {positioned.map((child) => {
        const center = centers[child.agent.id]!;
        const delta = center - junction;
        const straight = Math.abs(delta) < 1 || positioned.length === 1;
        const radius = Math.min(8, Math.abs(delta));
        const above = delta < 0;
        return (
          <View
            key={child.agent.id}
            style={{
              position: "absolute",
              left: STEM,
              top: 0,
              bottom: 0,
              width: BRANCH,
            }}
          >
            {straight ? (
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: center,
                  borderTopWidth: 1,
                  borderColor: colors.border,
                  borderStyle: child.waiting ? "dashed" : "solid",
                }}
              />
            ) : (
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: above ? center : center - radius,
                  height: radius,
                  borderLeftWidth: 1,
                  borderColor: colors.border,
                  borderStyle: child.waiting ? "dashed" : "solid",
                  ...(above
                    ? { borderTopWidth: 1, borderTopLeftRadius: radius }
                    : { borderBottomWidth: 1, borderBottomLeftRadius: radius }),
                }}
              />
            )}
            {child.live && (
              <>
                {Math.abs(delta) > 0 && (
                  <View
                    style={{
                      position: "absolute",
                      left: 0,
                      top: Math.min(center, junction),
                      height: Math.abs(delta),
                      width: 2,
                    }}
                  >
                    <Dashes flow={flow} vertical reverse={above} />
                  </View>
                )}
                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: center,
                    height: 2,
                  }}
                >
                  <Dashes flow={flow} />
                </View>
              </>
            )}
          </View>
        );
      })}
      {positioned.some((child) => child.live) && (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: junction,
            width: STEM,
            height: 2,
          }}
        >
          <Dashes flow={flow} />
        </View>
      )}
      {positioned
        .filter((child) => child.live)
        .map((child) => (
          <CommandPacket
            key={child.agent.id}
            phase={phases[child.agent.id]!}
            junction={junction}
            center={centers[child.agent.id]!}
            colors={colors}
          />
        ))}
    </View>
  );
}

function Tree(props: TreeProps & { root?: boolean; collapseRoot?: boolean }) {
  const { node, colors, flow, packet } = props;
  const [height, setHeight] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  useEffect(() => {
    const ids = new Set(node.children.map((child) => child.agent.id));
    setHeights((previous) => {
      const entries = Object.entries(previous).filter(([id]) => ids.has(id));
      return entries.length === Object.keys(previous).length
        ? previous
        : Object.fromEntries(entries);
    });
  }, [node.children]);
  const centers: Record<string, number> = {};
  let offset = 0;
  let measured = true;
  for (const child of node.children) {
    const rowHeight = heights[child.agent.id];
    if (rowHeight === undefined) measured = false;
    if (measured && rowHeight !== undefined) {
      centers[child.agent.id] = offset + rowHeight / 2;
      offset += rowHeight;
    }
  }
  const childKey = JSON.stringify(node.children.map((child) => child.agent.id));
  const phases = useMemo(() => {
    const ids: string[] = JSON.parse(childKey);
    return Object.fromEntries(
      ids.map((id, index) => [
        id,
        Animated.modulo(
          Animated.add(packet, index / Math.max(1, ids.length)),
          1,
        ),
      ]),
    );
  }, [childKey, packet]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Card {...props} />
      {node.children.length > 0 && (
        <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              width: STEM,
              height: 1,
              backgroundColor: colors.border,
            }}
          />
          <Connector
            colors={colors}
            flow={flow}
            junction={height / 2}
            children={node.children}
            centers={centers}
            phases={phases}
          />
          {node.children.map((child) => (
            <View
              key={child.agent.id}
              onLayout={(event) => {
                const rowHeight = event.nativeEvent.layout.height;
                setHeights((previous) =>
                  previous[child.agent.id] === rowHeight
                    ? previous
                    : { ...previous, [child.agent.id]: rowHeight },
                );
              }}
              style={{ paddingLeft: STEM + BRANCH, paddingVertical: 6 }}
            >
              <Tree
                {...props}
                root={false}
                collapseRoot={false}
                node={child}
                phase={phases[child.agent.id]}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function AnimationAnchor({ value }: { value: Animated.Value }) {
  const opacity = useMemo(
    () =>
      value.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0],
      }),
    [value],
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        opacity,
      }}
    />
  );
}

export function AgentDashboard(props: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const client = useQueryClient();
  const { t } = useTranslation(messages);
  const [state, setState] = useTabState(props.tab, stateSchema, DEFAULT_STATE);
  const [live, setLive] = useState<Record<string, ProviderSubagent>>({});
  const flow = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const packet = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(packet, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [packet]);
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [glow]);
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(flow, {
        toValue: 1,
        duration: 900,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [flow]);
  useEffect(() => {
    // Applying a team starts or messages an orchestrator, so the roster is re-read with the agents.
    const refreshAgents = () => {
      void client.invalidateQueries({ queryKey: ["dashboard", "agents"] });
      void client.invalidateQueries({ queryKey: ["dashboard", "roster"] });
    };
    const refreshWorkspaces = () =>
      void client.invalidateQueries({ queryKey: ["dashboard", "workspaces"] });
    const refreshProviders = () =>
      void client.invalidateQueries({ queryKey: ["dashboard", "providers"] });
    const off = [
      paseo.agents.subscribe(refreshAgents),
      paseo.workspaces.subscribe(refreshWorkspaces),
      paseo.projects.subscribe(refreshWorkspaces),
      paseo.providers.subscribe(refreshProviders),
    ];
    const events = paseo.observeEvents(["agent.provider_subagents.update"]);
    events.subscribe({
      snapshot() {},
      update(message) {
        if (message.type === "agent.provider_subagents.update")
          setLive((current) => applySubagentUpdate(current, message.payload));
      },
    });
    let active = true;
    const releases: Array<() => void> = [];
    void paseo.agents
      .list({ subscribe: {} })
      .then(({ subscription }) => {
        if (active)
          releases.push(() => {
            void subscription.release();
          });
        else void subscription.release();
      })
      .catch(() => {});
    void paseo.workspaces
      .list({ subscribe: {} })
      .then(({ subscription }) => {
        if (active)
          releases.push(() => {
            void subscription.release();
          });
        else void subscription.release();
      })
      .catch(() => {});
    return () => {
      active = false;
      void events.release();
      off.forEach((f) => f());
      releases.forEach((f) => f());
    };
  }, [paseo, client]);
  const agents = useQuery({
    queryKey: ["dashboard", "agents", state.showClosed],
    queryFn: () =>
      paseo.agents.list(
        state.showClosed ? { filter: { includeArchived: true } } : {},
      ),
  });
  const workspaces = useQuery({
    queryKey: ["dashboard", "workspaces"],
    queryFn: () => paseo.workspaces.list(),
  });
  const readRoster = useRpc(teamRosterRpc);
  const roster = useQuery({
    queryKey: ["dashboard", "roster", props.workspaceId],
    queryFn: () => readRoster({ workspaceId: props.workspaceId }),
  });
  const providers = useQuery({
    queryKey: ["dashboard", "providers"],
    queryFn: () => paseo.providers.snapshot(),
  });
  const defaultEfforts = useMemo(() => {
    const defaults: Record<string, string> = {};
    for (const entry of providers.data?.entries ?? []) {
      for (const model of entry.models ?? []) {
        if (model.defaultThinkingOptionId) {
          defaults[`${entry.provider}/${model.id}`] =
            model.defaultThinkingOptionId;
        }
      }
    }
    return defaults;
  }, [providers.data]);
  const workspaceIds = useMemo(() => {
    const entries = workspaces.data?.entries ?? [];
    const projectId = entries.find(
      (w) => w.id === props.workspaceId,
    )?.projectId;
    return projectId
      ? entries.filter((w) => w.projectId === projectId).map((w) => w.id)
      : [];
  }, [workspaces.data, props.workspaceId]);
  const unarchivedIds = useMemo(() => {
    const scope = new Set(workspaceIds);
    return (agents.data?.entries ?? [])
      .map((entry) => entry.agent)
      .filter((agent) => scope.has(agent.workspaceId ?? "") && !agent.archivedAt)
      .map((agent) => agent.id);
  }, [agents.data, workspaceIds]);
  const subagents = useQuery({
    queryKey: ["dashboard", "subagents", unarchivedIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        unarchivedIds.map(async (id) => {
          const page = await paseo.agents
            .ref(id)
            .timeline.refetch({ direction: "tail", limit: 200 });
          return subagentsFromTimeline(id, page.entries);
        }),
      );
      return results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
    },
  });
  const forest = useMemo(() => {
    const parentAgents =
      agents.data?.entries.map((entry) => entry.agent) ?? [];
    const merged = mergeSubagents(subagents.data ?? [], live);
    return buildAgentForest(
      [...parentAgents, ...subagentAgents(merged, parentAgents)],
      workspaceIds,
      { ...state, defaultEfforts, roster: roster.data?.teams },
    );
  }, [
    agents.data,
    subagents.data,
    live,
    workspaceIds,
    state,
    defaultEfforts,
    roster.data,
  ]);
  const icons = useMemo(
    () =>
      new Map(
        (providers.data?.entries ?? []).map((p) => [p.provider, p.iconSvg]),
      ),
    [providers.data],
  );
  const colors = props.theme.colors;
  const pad = props.layout.compact ? 16 : 24;
  const [panelWidth, setPanelWidth] = useState(0);
  const widestTree = useMemo(
    () =>
      forest.trees.reduce(
        (max, node) =>
          Math.max(max, expandedTreeWidth(node, props.layout.compact)),
        0,
      ),
    [forest.trees, props.layout.compact],
  );
  const collapseRoot =
    panelWidth > 0 && widestTree > panelWidth - (pad + TREE_PAD_X) * 2;
  const treeProps = {
    colors,
    compact: props.layout.compact,
    icons,
    flow,
    glow,
    packet,
    open: props.navigation
      ? (id: string) => props.navigation?.openAgent({ agentId: id })
      : undefined,
    caption: (node: AgentNode) =>
      node.role ||
      (node.kind === "orchestrator"
        ? t("orchestrator")
        : node.kind === "planner"
          ? t("planner")
          : node.kind === "subagent"
            ? node.agent.subagentType
              ? `${t("subagent")} · ${node.agent.subagentType}`
              : t("subagent")
            : node.agent.provider),
    waitingLabel: t("waiting"),
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <AnimationAnchor value={flow} />
      <AnimationAnchor value={glow} />
      <AnimationAnchor value={packet} />
      <View
        style={{
          paddingHorizontal: props.layout.compact ? 16 : 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderColor: colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text
          style={{ color: colors.foreground, fontSize: 18, fontWeight: "700" }}
        >
          {t("dashboardTitle")}
        </Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: state.showClosed }}
          onPress={() => setState({ showClosed: !state.showClosed })}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            {t("showClosed")}
          </Text>
          <View
            style={{
              width: 32,
              height: 18,
              borderRadius: 9,
              backgroundColor: state.showClosed
                ? colors.accent
                : colors.surface2,
              justifyContent: "center",
              paddingHorizontal: 2,
            }}
          >
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: state.showClosed
                  ? colors.accentForeground
                  : colors.foregroundMuted,
                alignSelf: state.showClosed ? "flex-end" : "flex-start",
              }}
            />
          </View>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        onLayout={(event) => setPanelWidth(event.nativeEvent.layout.width)}
      >
        <ScrollView
          style={{ flexGrow: 1, flexShrink: 0 }}
          contentContainerStyle={{
            padding: pad,
            gap: 24,
          }}
        >
          {agents.isLoading || workspaces.isLoading ? (
            <Loading />
          ) : agents.error || workspaces.error ? (
            <Text style={{ color: colors.statusDanger }}>
              {t("dashboardError")}
            </Text>
          ) : !forest.trees.length && !forest.solo.length ? (
            <Text style={{ color: colors.foregroundMuted }}>
              {t("emptyDashboard")}
            </Text>
          ) : (
            <>
              <View
                style={{
                  paddingHorizontal: TREE_PAD_X,
                  paddingVertical: 12,
                  gap: 26,
                  alignItems: "flex-start",
                }}
              >
                {forest.trees.map((node) => (
                  <Tree
                    key={node.agent.id}
                    {...treeProps}
                    node={node}
                    root
                    collapseRoot={collapseRoot}
                  />
                ))}
              </View>
              {forest.solo.length > 0 && (
                <View
                  style={{
                    gap: 12,
                    width:
                      panelWidth > 0
                        ? Math.max(0, panelWidth - pad * 2)
                        : undefined,
                  }}
                >
                  <Text
                    style={{
                      color: colors.foregroundMuted,
                      fontSize: 11,
                      fontWeight: "700",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    {t("soloAgents")}
                  </Text>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}
                  >
                    {forest.solo.map((node) => (
                      <Card key={node.agent.id} {...treeProps} node={node} />
                    ))}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </ScrollView>
    </View>
  );
}
