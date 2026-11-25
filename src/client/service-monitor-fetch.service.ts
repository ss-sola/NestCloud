import { Injectable } from '@nestjs/common';
import {
  PROCESS_METRICS_PATH,
  ProcessMetricsAuth,
  type ProcessMetricsSnapshot,
} from '@nest-cloud/sdk';
import { SERVICE_MONITOR_DEFAULTS } from '../constants/service-monitor.constants';
import type { ServiceMonitorTarget } from '../registry-center/monitor/service-monitor.types';
import { ServiceMonitorTargets } from '../registry-center/monitor/service-monitor-targets';

@Injectable()
export class ServiceMonitorFetchService {
  async fetch(target: ServiceMonitorTarget, token: string, stop: AbortSignal) {
    const url = ServiceMonitorTargets.origin(target);
    url.pathname = PROCESS_METRICS_PATH;
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.any([stop, AbortSignal.timeout(SERVICE_MONITOR_DEFAULTS.timeoutMs)]),
      headers: { 'X-Service-Monitor-Signature': ProcessMetricsAuth.sign(token, url.host) },
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('指标接口响应失败');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > SERVICE_MONITOR_DEFAULTS.maxResponseBytes) throw new Error('指标响应过大');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return this.parse(Buffer.concat(chunks, size).toString('utf8'));
  }

  private parse(body: string): ProcessMetricsSnapshot {
    const metrics: ProcessMetricsSnapshot = JSON.parse(body);
    const nonNegative = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (
      !metrics ||
      typeof metrics.collectedAt !== 'string' ||
      !Number.isFinite(Date.parse(metrics.collectedAt)) ||
      (metrics.cpuPercent !== null && !nonNegative(metrics.cpuPercent)) ||
      (metrics.cpuWindowMs !== null && !nonNegative(metrics.cpuWindowMs)) ||
      (metrics.cpuLogicalCoreCount !== undefined &&
        (!Number.isInteger(metrics.cpuLogicalCoreCount) || metrics.cpuLogicalCoreCount < 1)) ||
      (metrics.systemTotalMemoryBytes !== undefined &&
        (!Number.isSafeInteger(metrics.systemTotalMemoryBytes) ||
          metrics.systemTotalMemoryBytes < 1)) ||
      ![
        metrics.rssBytes,
        metrics.heapUsedBytes,
        metrics.heapTotalBytes,
        metrics.uptimeSeconds,
      ].every(nonNegative)
    ) {
      throw new Error('指标响应格式错误');
    }
    const { diskTotalBytes, diskUsedBytes, systemUsedMemoryBytes, systemTotalMemoryBytes } =
      metrics;
    if (
      systemUsedMemoryBytes !== undefined &&
      (!Number.isSafeInteger(systemUsedMemoryBytes) ||
        systemUsedMemoryBytes < 0 ||
        (systemTotalMemoryBytes !== undefined && systemUsedMemoryBytes > systemTotalMemoryBytes))
    ) {
      throw new Error('系统内存指标格式错误');
    }
    if (
      (diskTotalBytes !== undefined || diskUsedBytes !== undefined) &&
      (diskTotalBytes === undefined ||
        diskUsedBytes === undefined ||
        !Number.isSafeInteger(diskTotalBytes) ||
        !Number.isSafeInteger(diskUsedBytes) ||
        diskTotalBytes < 1 ||
        diskUsedBytes < 0 ||
        diskUsedBytes > diskTotalBytes)
    ) {
      throw new Error('磁盘指标格式错误');
    }
    const {
      collectedAt,
      cpuPercent,
      cpuWindowMs,
      cpuLogicalCoreCount,
      rssBytes,
      heapUsedBytes,
      heapTotalBytes,
      uptimeSeconds,
    } = metrics;
    return {
      collectedAt,
      cpuPercent,
      cpuWindowMs,
      cpuLogicalCoreCount,
      systemTotalMemoryBytes,
      systemUsedMemoryBytes,
      diskTotalBytes,
      diskUsedBytes,
      rssBytes,
      heapUsedBytes,
      heapTotalBytes,
      uptimeSeconds,
    };
  }
}
