import type { DeriveKind } from "./types.ts";

export async function resolveDerive(kind: DeriveKind): Promise<string> {
  switch (kind) {
    case "public-ipv4":
      return await fetchPublicIpv4();
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown derive kind: ${_exhaustive}`);
    }
  }
}

async function fetchPublicIpv4(): Promise<string> {
  const endpoints = [
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return text;
    } catch {
      // try next endpoint
    }
  }

  throw new Error("Could not resolve public-ipv4");
}
