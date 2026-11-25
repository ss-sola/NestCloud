export const SERVICE_MONITOR_DEFAULTS = {
  intervalMs: 10_000,
  minIntervalMs: 5_000,
  maxIntervalMs: 300_000,
  timeoutMs: 1_000,
  concurrency: 10,
  startSpacingMs: 25,
  maxResponseBytes: 4_096,
  staleAfterIntervals: 2,
  minCacheTtlMs: 60_000,
} as const;

export const SERVICE_MONITOR_HIGH_USAGE = {
  cpuPercent: 80,
  memoryPercent: 85,
  diskPercent: 85,
  durationMs: 60_000,
} as const;
