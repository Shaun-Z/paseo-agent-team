/** Applies opacity to hex or comma-separated RGB colors; other formats pass through. */
export function withAlpha(color: string, alpha: number): string {
  if (Number.isNaN(alpha)) return color;
  alpha = Math.max(0, Math.min(1, alpha));
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (hex) {
    const value = hex[1]!.length === 3 ? [...hex[1]!].map((digit) => digit + digit).join("") : hex[1]!;
    const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(", ")}, ${alpha})`;
  }
  const rgb = /^(rgb|rgba)\(\s*(\d+(?:\.\d+)?|\.\d+)\s*,\s*(\d+(?:\.\d+)?|\.\d+)\s*,\s*(\d+(?:\.\d+)?|\.\d+)(?:\s*,\s*(\d+(?:\.\d+)?|\.\d+))?\s*\)$/i.exec(color.trim());
  if (!rgb || (rgb[1]!.toLowerCase() === "rgba") !== (rgb[5] !== undefined)) return color;
  const channels = rgb.slice(2, 5).map(Number);
  const opacity = rgb[5] === undefined ? 1 : Number(rgb[5]);
  if (channels.some((channel) => channel > 255) || opacity > 1) return color;
  return `rgba(${channels.join(", ")}, ${opacity * alpha})`;
}
