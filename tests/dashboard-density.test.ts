import { describe, expect, it } from "vitest";
import { DASHBOARD_DENSITIES, DEFAULT_DENSITY, densityLayout } from "../shared/dashboard-density";

describe("dashboard density", () => {
  const brief = densityLayout("brief");
  const normal = densityLayout("normal");
  const detailed = densityLayout("detailed");

  it("defaults to normal", () => {
    expect(DEFAULT_DENSITY).toBe("normal");
  });

  it("offers exactly brief, normal and detailed", () => {
    expect([...DASHBOARD_DENSITIES]).toEqual(["brief", "normal", "detailed"]);
  });

  it("keeps brief pills at most 24px tall", () => {
    expect(brief.minHeight).toBeLessThanOrEqual(24);
  });

  it("makes normal cards 150px wide", () => {
    expect(normal.rootWidth.regular).toBe(150);
    expect(normal.childWidth.regular).toBe(150);
  });

  it("keeps detailed identical to the original card", () => {
    expect(detailed.rootWidth).toEqual({ compact: 205, regular: 240 });
    expect(detailed.childWidth).toEqual({ compact: 185, regular: 220 });
    expect(detailed.collapsedRootWidth).toBe(84);
    expect(detailed.minHeight).toBe(76);
    expect(detailed.glowRadius).toBe(10);
    expect(detailed.stem).toBe(20);
    expect(detailed.branch).toBe(24);
  });

  it("orders the glow radius brief < normal <= detailed", () => {
    expect(brief.glowRadius).toBeLessThan(normal.glowRadius);
    expect(normal.glowRadius).toBeLessThanOrEqual(detailed.glowRadius);
  });

  it.each([
    ["brief", brief],
    ["normal", normal],
  ] as const)("keeps the %s glow within half the node height", (_name, layout) => {
    expect(layout.glowRadius).toBeLessThanOrEqual(layout.minHeight / 2);
  });

  it("does not grow the signal dot or arrival flash from detailed to brief", () => {
    expect(brief.signalDotSize).toBeLessThanOrEqual(detailed.signalDotSize);
    expect(brief.arrivalFlash.scale).toBeLessThanOrEqual(detailed.arrivalFlash.scale);
    expect(brief.arrivalFlash.opacity).toBeLessThanOrEqual(detailed.arrivalFlash.opacity);
  });

  it("collapses sub-agents only in brief", () => {
    expect(DASHBOARD_DENSITIES.filter((density) => densityLayout(density).collapseSubagents)).toEqual(["brief"]);
  });
});
