export function maskValue(value: string, visible = 4): string {
  if (value.length <= visible) return "*".repeat(value.length);
  return value.slice(0, visible) + "*".repeat(Math.min(value.length - visible, 8));
}

export function truncateForDisplay(value: string, max = 12): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}
