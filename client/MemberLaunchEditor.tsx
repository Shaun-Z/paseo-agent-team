import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Member } from "../shared/research-team";
import { messages } from "./i18n";
import { TeamAction } from "./TeamControls";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Launch = Member["launchSnapshot"];
type Option = { id: string; label: string };

/** Typed values remain editable even when discovery is unavailable or a saved value is absent from the catalog. */
function LaunchField({ label, value, options, onChange, colors: c, optional, selectionOnly }: {
  label: string; value: string; options: Option[]; onChange(value: string): void; colors: Colors;
  optional?: boolean; selectionOnly?: boolean;
}) {
  const { t } = useTranslation(messages);
  const [open, setOpen] = useState(false), [search, setSearch] = useState("");
  const choices = options.filter(option => `${option.label} ${option.id}`.toLowerCase().includes(search.toLowerCase()));
  const placeholder = optional ? t("research.ui.providerDefault") : label;
  const choose = (id: string) => { onChange(id); setOpen(false); setSearch(""); };
  return <View style={{ flexGrow: 1, flexBasis: 220, minWidth: 0, gap: 6 }}>
    <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{label}</Text>
    <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.border, borderRadius: 9, backgroundColor: c.surface0 }}>
      {selectionOnly ? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={{ flex: 1, padding: 10 }}><Text style={{ color: value ? c.foreground : c.foregroundMuted, fontSize: 13 }}>{options.find(option => option.id === value)?.label ?? (value || placeholder)}</Text></Pressable>
        : <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.foregroundMuted} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, minWidth: 0, color: c.foreground, fontSize: 13, padding: 10 }} />}
      <TeamAction label={label} icon={open ? "ChevronUp" : "ChevronDown"} iconOnly selected={open} colors={c} onPress={() => { setOpen(value => !value); setSearch(""); }} />
    </View>
    {open && <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 9, padding: 5, gap: 4, backgroundColor: c.surface0 }}>
      {options.length > 8 && <TextInput accessibilityLabel={t("role.searchPlaceholder")} placeholder={t("role.searchPlaceholder")} placeholderTextColor={c.foregroundMuted} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} style={{ padding: 8, color: c.foreground, fontSize: 12 }} />}
      <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
        {optional && <Pressable accessibilityRole="button" onPress={() => choose("")} style={{ padding: 9 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.ui.providerDefault")}</Text></Pressable>}
        {choices.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: value === option.id }} onPress={() => choose(option.id)} style={{ padding: 9, borderRadius: 6, backgroundColor: value === option.id ? c.surface2 : "transparent", flexDirection: "row", gap: 8, alignItems: "center" }}><Text style={{ color: c.foreground, fontSize: 12, flex: 1 }}>{option.label}</Text>{value === option.id && <Icon name="Check" size={14} color={c.accent} />}</Pressable>)}
      </ScrollView>
    </View>}
  </View>;
}

export function MemberLaunchEditor({ value, onChange, cwd, colors: c }: {
  value: Launch; onChange(value: Launch): void; cwd: string; colors: Colors;
}) {
  const { t } = useTranslation(messages), paseo = usePaseo(), cache = useQueryClient();
  const [showFeatures, setShowFeatures] = useState(false);
  const catalog = useQuery({ queryKey: ["research-launch-providers", cwd], queryFn: () => paseo.providers.snapshot({ cwd }), staleTime: 30_000 });
  useEffect(() => paseo.providers.subscribe(() => { void cache.invalidateQueries({ queryKey: ["research-launch-providers", cwd] }); }), [paseo, cache, cwd]);
  const providers = catalog.data?.entries.filter(entry => entry.enabled) ?? [];
  const provider = providers.find(entry => entry.provider === value.provider);
  const models = provider?.models?.filter(model => model.isSelectable !== false) ?? [];
  const model = models.find(model => model.id === value.model);
  // Discovery supplies choices only. Never copy defaults or resolved feature values into the draft.
  const features = useQuery({ queryKey: ["research-launch-features", cwd, value],
    queryFn: () => paseo.providers.listFeatures({ ...value, provider: `${value.provider}/${value.model}`, cwd }),
    enabled: showFeatures && !!provider && !!model, retry: false, staleTime: 30_000 });
  const setField = (key: "provider" | "model" | "modeId" | "thinkingOptionId", text: string) => {
    const next = { ...value, [key]: text };
    if (!text && (key === "modeId" || key === "thinkingOptionId")) delete next[key];
    onChange(next);
  };
  const setFeature = (id: string, selected: unknown) => {
    const featureValues = { ...value.featureValues };
    if (selected === undefined) delete featureValues[id]; else featureValues[id] = selected;
    const next: Launch = { ...value, featureValues };
    if (!Object.keys(featureValues).length) delete next.featureValues;
    onChange(next);
  };
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <LaunchField label={t("role.provider")} value={value.provider} options={providers.map(entry => ({ id: entry.provider, label: entry.label ?? entry.provider }))} onChange={text => setField("provider", text)} colors={c} />
      <LaunchField label={t("role.model")} value={value.model} options={models} onChange={text => setField("model", text)} colors={c} />
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <LaunchField label={t("research.launch.mode")} value={value.modeId ?? ""} options={provider?.modes ?? []} optional onChange={text => setField("modeId", text)} colors={c} />
      <LaunchField label={t("research.ui.thinkingLevel")} value={value.thinkingOptionId ?? ""} options={model?.thinkingOptions ?? []} optional onChange={text => setField("thinkingOptionId", text)} colors={c} />
    </View>
    {catalog.error && <Text style={{ color: c.statusDanger, fontSize: 12 }}>{String(catalog.error)}</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showFeatures }} onPress={() => setShowFeatures(value => !value)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name={showFeatures ? "ChevronUp" : "ChevronDown"} size={14} color={c.foregroundMuted} /><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.launch.features")}</Text></Pressable>
    {showFeatures && <View style={{ gap: 10 }}>
      {features.isFetching && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("loading")}</Text>}
      {(features.error || features.data?.error) && <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Text style={{ color: c.statusDanger, fontSize: 12, flex: 1 }}>{String(features.error ?? features.data?.error)}</Text><TeamAction label={t("research.picker.refresh")} icon="RotateCw" iconOnly colors={c} onPress={() => { void features.refetch(); }} disabled={!provider || !model || features.isFetching} /></View>}
      {features.data?.features?.map(feature => <View key={feature.id} style={{ flexDirection: "row" }}>
        <LaunchField label={feature.label} value={value.featureValues?.[feature.id] == null ? "" : String(value.featureValues[feature.id])} optional selectionOnly
          options={feature.type === "toggle" ? [{ id: "true", label: t("research.launch.on") }, { id: "false", label: t("research.launch.off") }] : feature.options}
          onChange={selected => setFeature(feature.id, selected === "" ? undefined : feature.type === "toggle" ? selected === "true" : selected)} colors={c} />
      </View>)}
      {value.featureValues && <Text selectable style={{ color: c.foregroundMuted, fontSize: 11 }}>{JSON.stringify(value.featureValues, null, 2)}</Text>}
    </View>}
  </View>;
}
