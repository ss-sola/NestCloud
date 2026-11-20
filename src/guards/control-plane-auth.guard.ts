import { createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export class ControlPlaneAuthGuard implements CanActivate {
  private readonly tokenDigest: Buffer;

  constructor(token: string) {
    this.tokenDigest = ControlPlaneAuthGuard.digest(token);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = /^Bearer ([^\s,]+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token || !timingSafeEqual(this.tokenDigest, ControlPlaneAuthGuard.digest(token))) {
      throw new UnauthorizedException('控制面 Token 缺失或无效');
    }
    return true;
  }

  private static digest(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
  }
}
