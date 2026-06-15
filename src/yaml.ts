function indentLine(level: number): string {
  return "  ".repeat(level);
}

function needsQuotes(s: string): boolean {
  if (s === "" || s === "true" || s === "false" || s === "null" || /^-?\d+(\.\d+)?$/.test(s)) {
    return true;
  }
  return /[:#\[\]{}&*!|>'"%@`,]/.test(s) || /^\s|\s$/.test(s);
}

function quoteString(s: string): string {
  if (s.includes("\n")) return null as never;
  if (!needsQuotes(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((v) => !isEmpty(v));
    return items;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = compact(v);
      if (!isEmpty(c)) out[k] = c;
    }
    return out;
  }
  return value;
}

function serializeScalar(value: string, level: number): string[] {
  if (!value.includes("\n")) {
    return [`${indentLine(level)}${quoteString(value)}`];
  }
  const lines = [`${indentLine(level)}|`];
  for (const line of value.split("\n")) {
    lines.push(`${indentLine(level + 1)}${line}`);
  }
  return lines;
}

function serialize(value: unknown, level = 0): string[] {
  if (value === null || value === undefined) return [];

  if (typeof value === "boolean" || typeof value === "number") {
    return [`${indentLine(level)}${String(value)}`];
  }

  if (typeof value === "string") {
    return serializeScalar(value, level);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const lines: string[] = [];
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length === 0) continue;
        const [firstKey, firstVal] = entries[0]!;
        const firstLines = serialize(firstVal, level + 1);
        if (firstLines.length === 0) continue;
        const head = firstLines[0]!.trimStart();
        lines.push(`${indentLine(level)}- ${firstKey}: ${head}`);
        for (const line of firstLines.slice(1)) {
          lines.push(line);
        }
        for (const [k, v] of entries.slice(1)) {
          const childVal = compact(v);
          if (isEmpty(childVal)) continue;
          if (Array.isArray(childVal) || (childVal !== null && typeof childVal === "object")) {
            lines.push(`${indentLine(level + 1)}${k}:`);
            lines.push(...serialize(childVal, level + 2));
            continue;
          }
          const scalar =
            typeof childVal === "string" ? quoteString(childVal) : String(childVal);
          lines.push(`${indentLine(level + 1)}${k}: ${scalar}`);
        }
      } else if (typeof item === "string" && item.includes("\n")) {
        lines.push(`${indentLine(level)}-`);
        for (const line of item.split("\n")) {
          lines.push(`${indentLine(level + 1)}${line}`);
        }
      } else {
        const scalar = serialize(item, level + 1);
        if (scalar.length === 0) continue;
        lines.push(`${indentLine(level)}- ${scalar[0]!.trimStart()}`);
        for (const line of scalar.slice(1)) lines.push(line);
      }
    }
    return lines;
  }

  const lines: string[] = [];
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const compacted = compact(val);
    if (isEmpty(compacted)) continue;

    if (Array.isArray(compacted)) {
      lines.push(`${indentLine(level)}${key}:`);
      lines.push(...serialize(compacted, level + 1));
      continue;
    }

    if (compacted !== null && typeof compacted === "object") {
      lines.push(`${indentLine(level)}${key}:`);
      lines.push(...serialize(compacted, level + 1));
      continue;
    }

    if (typeof compacted === "string" && compacted.includes("\n")) {
      lines.push(`${indentLine(level)}${key}: |`);
      for (const line of compacted.split("\n")) {
        lines.push(`${indentLine(level + 1)}${line}`);
      }
      continue;
    }

    const scalar =
      typeof compacted === "string"
        ? quoteString(compacted)
        : String(compacted);
    lines.push(`${indentLine(level)}${key}: ${scalar}`);
  }
  return lines;
}

export function yamlStringify(value: unknown): string {
  const compacted = compact(value);
  return serialize(compacted).join("\n");
}
