import { BlockList, isIP } from 'node:net';
import { ProjectException } from '@nest-cloud/sdk';
import type { ServiceMonitorTarget } from './service-monitor.types';

export class ServiceMonitorTargets {
  private readonly hosts = new Set<string>();
  private readonly subnets = new BlockList();
  readonly fixed: ServiceMonitorTarget[];

  constructor(trustedHosts: string, staticTargets: string) {
    for (const item of this.entries(trustedHosts)) {
      const [address, prefix] = item.split('/');
      if (prefix === undefined) {
        this.hosts.add(ServiceMonitorTargets.normalizeHost(address));
        continue;
      }
      const family = isIP(address);
      if (!family || !/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) {
        throw new ProjectException('ServiceMonitorTrustedHosts 包含无效的网段');
      }
      this.subnets.addSubnet(address, Number(prefix), family === 4 ? 'ipv4' : 'ipv6');
    }

    this.fixed = this.entries(staticTargets).map((item) => {
      const delimiter = item.indexOf('=');
      const name = item.slice(0, delimiter).trim();
      const url = URL.parse(item.slice(delimiter + 1));
      if (
        delimiter < 1 ||
        !name ||
        !url ||
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        throw new ProjectException('ServiceMonitorStaticTargets 应使用 服务名=http://主机:端口');
      }
      return {
        id: `static:${name}:${url.origin}`,
        name,
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        scheme: url.protocol,
      };
    });
  }

  contains(host: string): boolean {
    try {
      const normalized = ServiceMonitorTargets.normalizeHost(host);
      const family = isIP(normalized);
      return (
        this.hosts.has(normalized) ||
        (family !== 0 && this.subnets.check(normalized, family === 4 ? 'ipv4' : 'ipv6'))
      );
    } catch {
      return false;
    }
  }

  static origin(target: ServiceMonitorTarget): URL {
    const host = this.normalizeHost(target.host);
    if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
      throw new ProjectException('无效的指标端口');
    }
    return new URL(`${target.scheme}//${isIP(host) === 6 ? `[${host}]` : host}:${target.port}`);
  }

  private entries(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private static normalizeHost(value: string): string {
    const host = value.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(host)) return host;
    const url = URL.parse(`http://${host}`);
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(host) || url?.hostname !== host) {
      throw new ProjectException('无效的指标主机名');
    }
    return host;
  }
}
