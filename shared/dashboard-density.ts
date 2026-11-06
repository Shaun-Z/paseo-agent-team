/** Pure sizing and animation settings shared by dashboard renderers. */
export type DashboardDensity = "brief" | "normal" | "detailed";
export const DASHBOARD_DENSITIES = ["brief", "normal", "detailed"] as const;
export const DEFAULT_DENSITY: DashboardDensity = "normal";

export interface DashboardDensityLayout {
  rootWidth: { compact: number; regular: number };
  childWidth: { compact: number; regular: number };
  /** Brief pills use content width, bounded by minWidth and maxWidth. */
  autoWidth: boolean;
  minWidth: number;
  maxWidth: number;
  collapsedRootWidth: number;
  minHeight: number;
  padding: number;
  paddingVertical: number;
  collapsedPadding: number;
  gap: number;
  collapsedGap: number;
  logoSize: number;
  titleFontSize: number;
  captionFontSize: number;
  showCaption: boolean;
  showChips: boolean;
  showEffort: boolean;
  showMode: boolean;
  collapseSubagents: boolean;
  glowRadius: number;
  glowOpacity: number;
  /** Fraction of the signal cycle at which it reaches the card. */
  arrival: number;
  arrivalFlash: { scale: number; opacity: number };
  signalDotSize: number;
  dashLength: number;
  dashGap: number;
  stem: number;
  branch: number;
  borderRadius: number;
}

/** Returns a fresh plain object; callers cannot mutate another caller's layout. */
export function densityLayout(density: DashboardDensity): DashboardDensityLayout {
  switch (density) {
    case "brief":
      return {
        rootWidth: { compact: 130, regular: 140 },
        childWidth: { compact: 130, regular: 140 },
        autoWidth: true, minWidth: 64, maxWidth: 140,
        collapsedRootWidth: 64, minHeight: 24,
        padding: 4, paddingVertical: 3, collapsedPadding: 3, gap: 4, collapsedGap: 4,
        logoSize: 15, titleFontSize: 11, captionFontSize: 9,
        showCaption: false, showChips: false, showEffort: false, showMode: false,
        collapseSubagents: true,
        glowRadius: 4, glowOpacity: 0.06, arrival: 0.84,
        arrivalFlash: { scale: 1.01, opacity: 0.1 },
        signalDotSize: 4, dashLength: 3, dashGap: 2,
        stem: 8, branch: 12, borderRadius: 12,
      };
    case "normal":
      return {
        rootWidth: { compact: 140, regular: 150 },
        childWidth: { compact: 140, regular: 150 },
        autoWidth: false, minWidth: 140, maxWidth: 150,
        collapsedRootWidth: 64, minHeight: 40,
        padding: 6, paddingVertical: 6, collapsedPadding: 6, gap: 6, collapsedGap: 4,
        logoSize: 16, titleFontSize: 12, captionFontSize: 10,
        showCaption: false, showChips: false, showEffort: false, showMode: true,
        collapseSubagents: false,
        glowRadius: 7, glowOpacity: 0.09, arrival: 0.84,
        arrivalFlash: { scale: 1.02, opacity: 0.16 },
        signalDotSize: 5, dashLength: 4, dashGap: 2,
        stem: 12, branch: 16, borderRadius: 8,
      };
    case "detailed":
      return {
        rootWidth: { compact: 205, regular: 240 },
        childWidth: { compact: 185, regular: 220 },
        autoWidth: false, minWidth: 185, maxWidth: 240,
        collapsedRootWidth: 84, minHeight: 76,
        padding: 10, paddingVertical: 10, collapsedPadding: 8, gap: 9, collapsedGap: 6,
        logoSize: 26, titleFontSize: 13, captionFontSize: 9,
        showCaption: true, showChips: true, showEffort: true, showMode: true,
        collapseSubagents: false,
        glowRadius: 10, glowOpacity: 0.125, arrival: 0.84,
        arrivalFlash: { scale: 1.03, opacity: 0.225 },
        signalDotSize: 7, dashLength: 6, dashGap: 2,
        stem: 20, branch: 24, borderRadius: 12,
      };
  }
}
