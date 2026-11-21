import { createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CONSOLE_API_PREFIX } from '../constants/control-plane-session.constants';

export type ControlPlaneSessionRequest = Request & {
  session: Request['session'] & { controlPlaneTokenDigest?: string };
  verifiedControlPlaneTokenDigest?: string;
};

export class ControlPlaneAuthGuard implements CanActivate {
  private readonly tokenDigest: Buffer;

  constructor(token: string) {
    this.tokenDigest = ControlPlaneAuthGuard.digest(token);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ControlPlaneSessionRequest>();
    const token = /^Bearer ([^\s,]+)$/i.exec(request.headers.authorization ?? '')?.[1];
    const digest = this.tokenDigest.toString('hex');
    if (token && timingSafeEqual(this.tokenDigest, ControlPlaneAuthGuard.digest(token))) {
      request.verifiedControlPlaneTokenDigest = digest;
      return true;
    }
    if (
      request.originalUrl.startsWith(CONSOLE_API_PREFIX) &&
      request.session?.controlPlaneTokenDigest === digest &&
      ControlPlaneAuthGuard.isSameOrigin(request)
    ) {
      return true;
    }
    throw new UnauthorizedException('控制面 Token 缺失或无效');
  }

  private static digest(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
  }

  private static isSameOrigin(request: Request): boolean {
    const fetchSite = request.get('sec-fetch-site');
    if (fetchSite) return fetchSite === 'same-origin';
    const source = request.get('origin') ?? request.get('referer');
    if (!source) return false;
    return URL.parse(source)?.origin === `${request.protocol}://${request.get('host')}`;
  }
}
