import { Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { CONSOLE_API_PREFIX } from '../../constants/control-plane-session.constants';
import type { ControlPlaneSessionRequest } from '../../guards/control-plane-auth.guard';

@Controller('control-plane')
export class ControlPlaneSessionController {
  @Post('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  async create(@Req() request: ControlPlaneSessionRequest): Promise<void> {
    const digest = request.verifiedControlPlaneTokenDigest;
    if (!digest) throw new UnauthorizedException('控制面 Token 缺失或无效');

    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    request.session.controlPlaneTokenDigest = digest;
    request.session.cookie.path = CONSOLE_API_PREFIX;
    request.session.cookie.maxAge = null;
    request.session.cookie.sameSite = 'strict';
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => (error ? reject(error) : resolve()));
    });
  }
}
