import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** DASHBOARD_CLIENT_SOURCE lets a run point the checks at another copy of the file. */
const sourcePath = process.env.DASHBOARD_CLIENT_SOURCE ?? resolve(__dirname, "../client/AgentDashboard.tsx");

const OLD_FIXED_WIDTHS = /(?<![\d.])(185|205|220|240)(?![\d.])/;

function problems(source: string): string[] {
  const found: string[] = [];
  if (!source.includes("densityLayout(")) found.push("does not call densityLayout(");
  if (!/from\s+["']\.\.\/shared\/dashboard-density["']/.test(source)) found.push("does not import ../shared/dashboard-density");
  const width = OLD_FIXED_WIDTHS.exec(source);
  if (width) found.push(`contains the old fixed width ${width[1]}`);
  return found;
}

describe("AgentDashboard density wiring", () => {
  it("uses densityLayout and no longer hard-codes the old card widths", () => {
    expect(problems(readFileSync(sourcePath, "utf8"))).toEqual([]);
  });

  it("flags a client that stops calling densityLayout", () => {
    const source = readFileSync(sourcePath, "utf8").replaceAll("densityLayout(", "legacyLayout(");
    expect(problems(source)).toContain("does not call densityLayout(");
  });

  it("flags a client that brings back a fixed width", () => {
    expect(problems("densityLayout( from '../shared/dashboard-density'; const ROOT_WIDTH = 240;")).toEqual(["contains the old fixed width 240"]);
  });
});
