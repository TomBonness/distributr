import { createHash } from "node:crypto";

export function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** YYYY-MM-DD in UTC. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function epochSec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

export function clamp(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
