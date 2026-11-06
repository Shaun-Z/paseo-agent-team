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
import { withAlpha } from "../shared/color";
import { buildAgentForest, canDismiss, dismissibleIds, titleParts, type AgentNode } from "../shared/agent-tree";
import {
  DASHBOARD_DENSITIES,
  DEFAULT_DENSITY,
  densityLayout,
  type DashboardDensityLayout,
} from "../shared/dashboard-density";
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
const stateSchema = z.object({
  showClosed: z.boolean(),
  dismissed: z.array(z.string()).catch([]),
  density: z.enum(DASHBOARD_DENSITIES).catch(DEFAULT_DENSITY),
});
const DEFAULT_STATE = { showClosed: false, dismissed: [] as string[], density: DEFAULT_DENSITY };

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type TreeProps = {
  node: AgentNode;
  colors: Colors;
  compact: boolean;
  layout: DashboardDensityLayout;
  icons: Map<string, string | undefined>;
  flow: Animated.Value;
  glow: Animated.Value;
  packet: Animated.Value;
  phase?: Animated.AnimatedModulo<number>;
  open?: (id: string) => void;
  caption: (node: AgentNode) => string;
  waitingLabel: string;
  hideLabel: string;
  dismiss?: (id: string) => void;
  subagentLabel: (count: number) => string;
  expandedSubagents: Record<string, boolean>;
  toggleSubagents: (id: string) => void;
};

function shortModel(model: string): string {
  const base = (model.split("/").pop() ?? model).replace(/-\d{8}$/, "");
  return base.replace(/^claude-/, "");
}

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
  const svgSize = size >= 24 ? size - 10 : Math.max(9, size - 5);
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
          size={svgSize}
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
  layout,
}: Pick<TreeProps, "node" | "colors" | "flow" | "waitingLabel" | "layout">) {
  if (node.waiting)
    return (
      <Text
        style={{
          color: colors.foregroundMuted,
          fontSize: layout.captionFontSize,
          lineHeight: layout.autoWidth ? 12 : undefined,
          fontWeight: "700",
        }}
      >
        {waitingLabel}
      </Text>
    );
  if (!node.badge) return null;
  if (node.badge === "running") {
    const dotSize = layout.showChips ? 8 : layout.autoWidth ? 6 : 7;
    return (
      <Animated.View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: AMBER,
          opacity: flow.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0.45, 1, 0.45],
          }),
        }}
      />
    );
  }
  const badgeSize = layout.showChips ? 17 : layout.autoWidth ? 13 : 15;
  const badgeFontSize = layout.showChips ? 11 : layout.autoWidth ? 9 : 10;
  const badgeLineHeight = layout.showChips ? 14 : layout.autoWidth ? 11 : 12;
  return (
    <View
      style={{
        width: badgeSize,
        height: badgeSize,
        borderRadius: Math.ceil(badgeSize / 2),
        backgroundColor:
          node.badge === "attention" ? RED : colors.statusSuccess,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: colors.accentForeground,
          fontSize: badgeFontSize,
          fontWeight: "800",
          lineHeight: badgeLineHeight,
        }}
      >
        {node.badge === "attention" ? "!" : "✓"}
      </Text>
    </View>
  );
}

function Card(
  props: TreeProps & {
    root?: boolean;
    collapseRoot?: boolean;
    subagentCount?: number;
    subagentCountLabel?: string;
    subagentsExpanded?: boolean;
    onToggleSubagents?: () => void;
  },
) {
  const {
    node,
    colors,
    compact,
    layout,
    open,
    caption,
    flow,
    glow,
    icons,
    root,
    collapseRoot,
    phase,
    waitingLabel,
    subagentCount = 0,
    subagentCountLabel,
    subagentsExpanded = false,
    onToggleSubagents,
  } = props;
  const collapsed = Boolean(root && collapseRoot);
  const subagentPill =
    !collapsed && subagentCount > 0 && onToggleSubagents ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={subagentCountLabel}
        accessibilityState={{ expanded: subagentsExpanded }}
        onPress={onToggleSubagents}
        style={{
          backgroundColor: subagentsExpanded ? colors.accent : colors.surface2,
          borderRadius: 6,
          paddingHorizontal: 4,
          paddingVertical: 1,
          borderWidth: 1,
          borderColor: colors.accent,
        }}
      >
        <Text
          style={{
            color: subagentsExpanded ? colors.accentForeground : colors.accent,
            fontSize: layout.captionFontSize,
            lineHeight: 11,
            fontWeight: "700",
          }}
        >
          +{subagentCount}
        </Text>
      </Pressable>
    ) : null;

  const briefLabel = node.role || node.title;
  const title = titleParts(node.title);
  const titleContent = (fontSize: number) => <>{title.name}{title.id !== null ? <Text style={{ color: withAlpha(colors.foregroundMuted, 0.55), fontSize: Math.round(fontSize * 0.85) }}>{" " + title.id}</Text> : null}</>;
  const briefBadgeSpace = node.waiting
    ? 42
    : node.badge === "running"
      ? 10
      : node.badge
        ? 17
        : 0;
  const briefTitleMaxWidth =
    layout.maxWidth -
    (layout.padding + 2) * 2 -
    2 -
    layout.logoSize -
    layout.gap -
    briefBadgeSpace;
  const showBriefModel = Boolean(node.model && briefLabel.length < 11);

  const content = layout.autoWidth ? (
    collapsed ? (
      <>
        <Logo node={node} icons={icons} colors={colors} size={layout.logoSize} />
        <Badge
          node={node}
          colors={colors}
          flow={flow}
          waitingLabel={waitingLabel}
          layout={layout}
        />
      </>
    ) : (
      <>
        <Logo node={node} icons={icons} colors={colors} size={layout.logoSize} />
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 0,
            maxWidth: briefTitleMaxWidth,
            color: colors.foreground,
            fontSize: layout.titleFontSize,
            lineHeight: 14,
            fontWeight: "700",
          }}
        >
          {node.role ? briefLabel : titleContent(layout.titleFontSize)}
        </Text>
        {showBriefModel && node.model ? (
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: colors.foregroundMuted,
              fontSize: layout.captionFontSize,
              lineHeight: 12,
            }}
          >
            {shortModel(node.model)}
          </Text>
        ) : null}
        <View style={{ flexShrink: 0 }}>
          <Badge
            node={node}
            colors={colors}
            flow={flow}
            waitingLabel={waitingLabel}
            layout={layout}
          />
        </View>
      </>
    )
  ) : !layout.showChips ? (
    collapsed ? (
      <>
        <Logo node={node} icons={icons} colors={colors} size={layout.logoSize} />
        {node.model ? (
          <Text
            numberOfLines={1}
            style={{
              color: colors.foregroundMuted,
              fontSize: layout.captionFontSize,
              textAlign: "center",
              maxWidth: "100%",
            }}
          >
            {shortModel(node.model)}
          </Text>
        ) : null}
        <View style={{ position: "absolute", right: 4, top: 4 }}>
          <Badge
            node={node}
            colors={colors}
            flow={flow}
            waitingLabel={waitingLabel}
            layout={layout}
          />
        </View>
      </>
    ) : (
      <>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: layout.gap,
          }}
        >
          <Logo
            node={node}
            icons={icons}
            colors={colors}
            size={layout.logoSize}
          />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              minWidth: 0,
              color: colors.foreground,
              fontSize: layout.titleFontSize,
              fontWeight: "700",
            }}
          >
            {titleContent(layout.titleFontSize)}
          </Text>
          <Badge
            node={node}
            colors={colors}
            flow={flow}
            waitingLabel={waitingLabel}
            layout={layout}
          />
        </View>
        {[node.model, layout.showMode ? node.mode : null].some(Boolean) ? (
          <Text
            numberOfLines={1}
            style={{
              color: colors.foregroundMuted,
              fontSize: layout.captionFontSize,
            }}
          >
            {[node.model, layout.showMode ? node.mode : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
      </>
    )
  ) : collapsed ? (
    <>
      <Logo node={node} icons={icons} colors={colors} size={layout.logoSize} />
      {node.model ? (
        <Text
          numberOfLines={2}
          style={{
            color: colors.foregroundMuted,
            fontSize: layout.captionFontSize,
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
          layout={layout}
        />
      </View>
    </>
  ) : (
    <>
      <Logo node={node} icons={icons} colors={colors} size={layout.logoSize} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        {layout.showCaption ? (
          <Text
            numberOfLines={1}
            style={{
              color: colors.foregroundMuted,
              fontSize: layout.captionFontSize,
              fontWeight: "700",
              letterSpacing: 0.8,
              textTransform: "uppercase",
              paddingRight: 18,
            }}
          >
            {caption(node)}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          style={{
            color: colors.foreground,
            fontSize: layout.titleFontSize,
            fontWeight: "700",
          }}
        >
          {titleContent(layout.titleFontSize)}
        </Text>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 3,
          }}
        >
          {[
            node.model,
            layout.showEffort ? node.effort : null,
            layout.showMode ? node.mode : null,
          ].map((chip, i) =>
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
                    fontSize: layout.captionFontSize,
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
          layout={layout}
        />
      </View>
    </>
  );

  const fixedWidth = collapsed
    ? layout.collapsedRootWidth
    : compact
      ? root
        ? layout.rootWidth.compact
        : layout.childWidth.compact
      : root
        ? layout.rootWidth.regular
        : layout.childWidth.regular;

  const style = {
    ...(layout.autoWidth && !collapsed
      ? {
          minWidth: layout.minWidth,
          maxWidth: layout.maxWidth,
          paddingHorizontal: layout.padding + 2,
          paddingVertical: layout.paddingVertical,
        }
      : {
          width: fixedWidth,
          paddingHorizontal: collapsed
            ? layout.collapsedPadding
            : layout.padding,
          paddingVertical: collapsed
            ? layout.collapsedPadding
            : layout.paddingVertical,
        }),
    minHeight: layout.minHeight,
    flexDirection: layout.autoWidth
      ? ("row" as const)
      : collapsed
        ? ("column" as const)
        : layout.showChips
          ? ("row" as const)
          : ("column" as const),
    alignItems: layout.autoWidth
      ? ("center" as const)
      : collapsed
        ? ("center" as const)
        : undefined,
    justifyContent: collapsed
      ? ("center" as const)
      : !layout.autoWidth && !layout.showChips
        ? ("center" as const)
        : undefined,
    gap: collapsed
      ? layout.collapsedGap
      : !layout.autoWidth && !layout.showChips
        ? 3
        : layout.gap,
    borderWidth: 1,
    borderStyle:
      !layout.showChips && node.waiting ? ("dashed" as const) : undefined,
    borderColor: node.live
      ? RED
      : node.delegating
        ? AMBER
        : root
          ? colors.accent
          : colors.border,
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface1,
    shadowColor: RED,
    shadowOpacity: node.live ? layout.glowOpacity : 0,
    shadowRadius: layout.glowRadius,
    shadowOffset: { width: 0, height: 0 },
    // A role with no session yet: dimmed, and nothing to open.
    opacity: node.waiting ? 0.45 : node.kind === "subagent" ? 0.85 : 1,
  };
  const hideButton = props.dismiss && canDismiss(node) ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.hideLabel}
      onPress={(event) => { event.stopPropagation(); props.dismiss?.(node.agent.id); }}
      style={{ position: "absolute", top: -7, left: -7, width: 16, height: 16, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border }}
    >
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 14 }}>×</Text>
    </Pressable>
  ) : null;
  const card =
    open && !node.waiting && node.kind !== "subagent" ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={node.title}
        onPress={() => open(node.agent.id)}
        style={style}
      >
        {content}
        {hideButton}
      </Pressable>
    ) : (
      <View accessibilityLabel={node.title} style={style}>
        {content}
        {hideButton}
      </View>
    );
  if (!node.live) {
    return subagentPill ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {card}
        {subagentPill}
      </View>
    ) : (
      card
    );
  }
  const peak = (layout.arrival + 1) / 2;
  const ping =
    phase?.interpolate({
      inputRange: [0, layout.arrival, peak, 1],
      outputRange: [1, 1, layout.arrivalFlash.scale, 1],
    }) ?? 1;
  const flash =
    phase?.interpolate({
      inputRange: [0, layout.arrival, peak, 1],
      outputRange: [0, 0, layout.arrivalFlash.opacity, 0],
    }) ?? 0;
  const flashInset = layout.autoWidth ? -1 : -2;
  const liveCard = (
    <Animated.View style={{ transform: [{ scale: ping }] }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -1,
          bottom: -1,
          left: -1,
          right: -1,
          borderRadius: layout.borderRadius,
          borderWidth: 1,
          borderColor: GLOW,
          backgroundColor: GLOW,
          shadowColor: GLOW,
          shadowOpacity: layout.arrivalFlash.opacity,
          shadowRadius: Math.max(2, layout.glowRadius * 0.6),
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
          opacity: glow.interpolate({
            inputRange: [0, 1],
            outputRange: [layout.glowOpacity * 0.32, layout.glowOpacity * 1.28],
          }),
          transform: [
            {
              scale: glow.interpolate({
                inputRange: [0, 1],
                outputRange: [
                  1,
                  1 + (layout.arrivalFlash.scale - 1) * (2 / 3),
                ],
              }),
            },
          ],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: flashInset,
          bottom: flashInset,
          left: flashInset,
          right: flashInset,
          borderRadius: layout.borderRadius,
          backgroundColor: GLOW,
          shadowColor: GLOW,
          shadowOpacity: Math.min(1, layout.glowOpacity * 5.6),
          shadowRadius: layout.glowRadius * 1.4,
          elevation: 8,
          opacity: flash,
        }}
      />
      {card}
    </Animated.View>
  );
  return subagentPill ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {liveCard}
      {subagentPill}
    </View>
  ) : (
    liveCard
  );
}

function Dashes({
  flow,
  layout,
  vertical = false,
  reverse = false,
}: {
  flow: Animated.Value;
  layout: DashboardDensityLayout;
  vertical?: boolean;
  reverse?: boolean;
}) {
  const [length, setLength] = useState(0);
  const step = layout.dashLength + layout.dashGap;
  const count = Math.ceil(length / step) + 2;
  const offset = flow.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? [step, 0] : [0, step],
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
          ...(vertical ? { top: -step } : { left: -step }),
          transform: [
            vertical ? { translateY: offset } : { translateX: offset },
          ],
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <View
            key={i}
            style={{
              width: vertical ? 2 : layout.dashLength,
              height: vertical ? layout.dashLength : 2,
              marginBottom: vertical ? layout.dashGap : 0,
              marginRight: vertical ? 0 : layout.dashGap,
              backgroundColor: RED,
            }}
          />
        ))}
      </Animated.View>
    </View>
  );
}

const TREE_PAD_X = 16;

function treeDepth(
  node: AgentNode,
  collapseSubagents: boolean,
  expandedSubagents: Record<string, boolean>,
): number {
  const children =
    collapseSubagents && !expandedSubagents[node.agent.id]
      ? node.children.filter((child) => child.kind !== "subagent")
      : node.children;
  if (!children.length) return 0;
  return (
    1 +
    Math.max(
      ...children.map((child) =>
        treeDepth(child, collapseSubagents, expandedSubagents),
      ),
    )
  );
}

function expandedTreeWidth(
  node: AgentNode,
  compact: boolean,
  layout: DashboardDensityLayout,
  expandedSubagents: Record<string, boolean>,
): number {
  const rootWidth = compact
    ? layout.rootWidth.compact
    : layout.rootWidth.regular;
  const childWidth = compact
    ? layout.childWidth.compact
    : layout.childWidth.regular;
  return (
    rootWidth +
    treeDepth(node, layout.collapseSubagents, expandedSubagents) *
      (layout.stem + layout.branch + childWidth)
  );
}

function CommandPacket({
  phase,
  junction,
  center,
  colors,
  layout,
}: {
  phase: Animated.AnimatedModulo<number>;
  junction: number;
  center: number;
  colors: Colors;
  layout: DashboardDensityLayout;
}) {
  const { stem, branch, arrival, signalDotSize, glowRadius } = layout;
  const distance = stem + Math.abs(center - junction) + branch;
  const first = (arrival * stem) / distance;
  const second = (arrival * (stem + Math.abs(center - junction))) / distance;
  const input =
    second > first ? [0, first, second, arrival, 1] : [0, first, arrival, 1];
  const x =
    second > first
      ? [0, stem, stem, stem + branch, stem + branch]
      : [0, stem, stem + branch, stem + branch];
  const y =
    second > first
      ? [junction, junction, center, center, center]
      : [junction, junction, center, center];
  const half = Math.floor(signalDotSize / 2);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: -half,
        top: -half,
        width: signalDotSize,
        height: signalDotSize,
        borderRadius: Math.ceil(signalDotSize / 2),
        backgroundColor: colors.foreground,
        shadowColor: RED,
        shadowOpacity: 1,
        shadowRadius: Math.max(2, Math.round(glowRadius * 0.6)),
        shadowOffset: { width: 0, height: 0 },
        elevation: 5,
        opacity: phase.interpolate({
          inputRange: [0, 0.02, arrival, arrival + 0.01, 1],
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
  layout,
  junction,
  children,
  centers,
  phases,
}: {
  colors: Colors;
  flow: Animated.Value;
  layout: DashboardDensityLayout;
  junction: number;
  children: AgentNode[];
  centers: Record<string, number>;
  phases: Record<string, Animated.AnimatedModulo<number>>;
}) {
  const { stem, branch } = layout;
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
        width: stem + branch,
      }}
    >
      {max > min && (
        <View
          style={{
            position: "absolute",
            left: stem,
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
              left: stem,
              top: 0,
              bottom: 0,
              width: branch,
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
                    <Dashes flow={flow} layout={layout} vertical reverse={above} />
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
                  <Dashes flow={flow} layout={layout} />
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
            width: stem,
            height: 2,
          }}
        >
          <Dashes flow={flow} layout={layout} />
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
            layout={layout}
          />
        ))}
    </View>
  );
}

function Tree(props: TreeProps & { root?: boolean; collapseRoot?: boolean }) {
  const {
    node,
    colors,
    flow,
    packet,
    layout,
    subagentLabel,
    expandedSubagents,
    toggleSubagents,
  } = props;
  const subagents = useMemo(
    () => node.children.filter((child) => child.kind === "subagent"),
    [node.children],
  );
  const collapseSubagents = layout.collapseSubagents && subagents.length > 0;
  const subagentsExpanded = Boolean(expandedSubagents[node.agent.id]);
  const visibleChildren = useMemo(
    () =>
      collapseSubagents && !subagentsExpanded
        ? node.children.filter((child) => child.kind !== "subagent")
        : node.children,
    [collapseSubagents, subagentsExpanded, node.children],
  );
  const [height, setHeight] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  useEffect(() => {
    const ids = new Set(visibleChildren.map((child) => child.agent.id));
    setHeights((previous) => {
      const entries = Object.entries(previous).filter(([id]) => ids.has(id));
      return entries.length === Object.keys(previous).length
        ? previous
        : Object.fromEntries(entries);
    });
  }, [visibleChildren]);
  const centers: Record<string, number> = {};
  let offset = 0;
  let measured = true;
  for (const child of visibleChildren) {
    const rowHeight = heights[child.agent.id];
    if (rowHeight === undefined) measured = false;
    if (measured && rowHeight !== undefined) {
      centers[child.agent.id] = offset + rowHeight / 2;
      offset += rowHeight;
    }
  }
  const childKey = JSON.stringify(
    visibleChildren.map((child) => child.agent.id),
  );
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
  const rowPadY = layout.autoWidth ? 3 : layout.showChips ? 6 : 4;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Card
        {...props}
        subagentCount={collapseSubagents ? subagents.length : 0}
        subagentCountLabel={
          collapseSubagents ? subagentLabel(subagents.length) : undefined
        }
        subagentsExpanded={subagentsExpanded}
        onToggleSubagents={
          collapseSubagents ? () => toggleSubagents(node.agent.id) : undefined
        }
      />
      {visibleChildren.length > 0 && (
        <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              width: layout.stem,
              height: 1,
              backgroundColor: colors.border,
            }}
          />
          <Connector
            colors={colors}
            flow={flow}
            layout={layout}
            junction={height / 2}
            children={visibleChildren}
            centers={centers}
            phases={phases}
          />
          {visibleChildren.map((child) => (
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
              style={{
                paddingLeft: layout.stem + layout.branch,
                paddingVertical: rowPadY,
              }}
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
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const coalesce = (fn: () => void) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (timer !== null) return;
        timer = setTimeout(() => {
          timers.delete(timer!);
          timer = null;
          fn();
        }, 1000);
        timers.add(timer);
      };
    };
    const invalidate = (key: string) =>
      void client.invalidateQueries(
        { queryKey: ["dashboard", key] },
        { cancelRefetch: false },
      );
    const refreshAgents = coalesce(() => invalidate("agents"));
    const refreshWorkspaces = coalesce(() => {
      invalidate("workspaces");
      invalidate("roster");
    });
    const refreshProviders = coalesce(() => invalidate("providers"));
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
      timers.forEach(clearTimeout);
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
  const closedIds = dismissibleIds(forest);
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
  const [expandedSubagents, setExpandedSubagents] = useState<
    Record<string, boolean>
  >({});
  const toggleSubagents = (id: string) =>
    setExpandedSubagents((current) => ({ ...current, [id]: !current[id] }));
  const layout = useMemo(() => densityLayout(state.density), [state.density]);
  const widestTree = useMemo(
    () =>
      forest.trees.reduce(
        (max, node) =>
          Math.max(
            max,
            expandedTreeWidth(
              node,
              props.layout.compact,
              layout,
              expandedSubagents,
            ),
          ),
        0,
      ),
    [forest.trees, props.layout.compact, layout, expandedSubagents],
  );
  const collapseRoot =
    panelWidth > 0 && widestTree > panelWidth - (pad + TREE_PAD_X) * 2;
  const treeProps = {
    colors,
    compact: props.layout.compact,
    layout,
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
    hideLabel: t("hideAgent"),
    dismiss: state.showClosed ? (id: string) => setState({ ...state, dismissed: state.dismissed.includes(id) ? state.dismissed : [...state.dismissed, id] }) : undefined,
    subagentLabel: (count: number) => t("subagentCount", { count }),
    expandedSubagents,
    toggleSubagents,
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
          flexWrap: "wrap",
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
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            flexShrink: 1,
            marginLeft: "auto",
            maxWidth: "100%",
            gap: 12,
          }}
        >
          <View
            accessibilityLabel={t("density.label")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.surface1,
              borderRadius: 7,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 2,
              gap: 2,
            }}
          >
            {DASHBOARD_DENSITIES.map((option) => {
              const selected = state.density === option;
              const label = t(`density.${option}`);
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("density.label")}: ${label}`}
                  accessibilityState={{ selected }}
                  onPress={() => setState({ ...state, density: option })}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 5,
                    backgroundColor: selected ? colors.accent : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: selected
                        ? colors.accentForeground
                        : colors.foregroundMuted,
                      fontSize: 11,
                      fontWeight: selected ? "700" : "500",
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: state.showClosed }}
            onPress={() => setState({ ...state, showClosed: !state.showClosed })}
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
          {state.showClosed && state.dismissed.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setState({ ...state, dismissed: [] })} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("restoreHidden", { count: state.dismissed.length })}</Text>
            </Pressable>
          ) : null}
          {state.showClosed && closedIds.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setState({ ...state, dismissed: [...new Set([...state.dismissed, ...closedIds])] })}
              style={{ marginLeft: "auto", paddingHorizontal: 8, paddingVertical: 4 }}
            >
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("hideAllClosed", { count: closedIds.length })}</Text>
            </Pressable>
          ) : null}
        </View>
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
