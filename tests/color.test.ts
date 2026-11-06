import { describe, expect, it } from "vitest";
import { withAlpha } from "../shared/color";

describe("withAlpha", () => {
  it("converts short and long hex colors to rgba", () => {
    expect(withAlpha("#abc", 0.55)).toBe("rgba(170, 187, 204, 0.55)");
    expect(withAlpha("#AABBCC", 0.55)).toBe("rgba(170, 187, 204, 0.55)");
  });

  it("adds the alpha to an rgb color", () => {
    expect(withAlpha("rgb(10, 20, 30)", 0.5)).toBe("rgba(10, 20, 30, 0.5)");
  });

  it("multiplies an rgba color's own alpha", () => {
    expect(withAlpha("rgba(10, 20, 30, 0.5)", 0.5)).toBe("rgba(10, 20, 30, 0.25)");
  });

  it("clamps an alpha below 0 and above 1", () => {
    expect(withAlpha("#abc", -1)).toBe("rgba(170, 187, 204, 0)");
    expect(withAlpha("#abc", 2)).toBe("rgba(170, 187, 204, 1)");
    expect(withAlpha("rgb(10, 20, 30)", 5)).toBe("rgba(10, 20, 30, 1)");
  });

  it("returns the input for a NaN alpha", () => {
    expect(withAlpha("#abc", NaN)).toBe("#abc");
    expect(withAlpha("rgb(1, 2, 3)", NaN)).toBe("rgb(1, 2, 3)");
  });

  it("returns named and hsl colors unchanged", () => {
    expect(withAlpha("grey", 0.5)).toBe("grey");
    expect(withAlpha("hsl(120, 50%, 50%)", 0.5)).toBe("hsl(120, 50%, 50%)");
  });

  it("returns malformed colors unchanged", () => {
    for (const color of ["#abcd", "#ab", "#ggg", "rgb(300, 0, 0)", "rgba(1,2,3)", "rgb(1,2,3,0.5)", "rgba(1, 2, 3, 2)", "rgb(1, 2)", ""]) {
      expect(withAlpha(color, 0.5)).toBe(color);
    }
  });

  it("accepts surrounding whitespace", () => {
    expect(withAlpha("  #abc  ", 0.5)).toBe("rgba(170, 187, 204, 0.5)");
    expect(withAlpha(" rgb(10, 20, 30) ", 0.5)).toBe("rgba(10, 20, 30, 0.5)");
    expect(withAlpha("rgb( 10 ,20,  30 )", 0.5)).toBe("rgba(10, 20, 30, 0.5)");
  });
});
