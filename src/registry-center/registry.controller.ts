import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ResponseUtil } from '@nest-cloud/sdk';
import { RegistryService } from './registry.service';
import { RegisterInstanceForm } from './form/register-instance.form';
import { RegistryRegistrationUtil } from './utils/registry-registration.util';

@Controller('registry') // 所有路由前缀为 /registry
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  // 服务注册
  @Post('register')
  async register(@Body() instance: RegisterInstanceForm) {
    return ResponseUtil.success(
      await this.registry.register(RegistryRegistrationUtil.fromForm(instance)),
    );
  }

  // 服务下线
  @Post('unregister/:id')
  async unregister(@Param('id') id: string) {
    return ResponseUtil.success(await this.registry.unregister(id));
  }

  // 心跳
  @Post('heartbeat/:id')
  async heartbeat(@Param('id') id: string) {
    return ResponseUtil.success(await this.registry.heartbeat(id));
  }

  // 服务发现
  @Get('discover/:serviceName')
  async discover(@Param('serviceName') name: string, @Query('group') group?: string) {
    return ResponseUtil.success(await this.registry.discover(name, group));
  }

  @Get('all')
  async getAll() {
    return ResponseUtil.success(await this.registry.getAll());
  }

  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.registry.getOverview());
  }

  @Get('services')
  async getServices(@Query('search') search?: string, @Query('group') group?: string) {
    return ResponseUtil.success(await this.registry.getServices({ search, group }));
  }

  @Get('audits')
  async getAudits(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return ResponseUtil.success(await this.registry.getAuditLogs(parsedLimit));
  }
}
