import { Controller, Get } from '@nestjs/common';
import { ResponseUtil } from '@nest-cloud/sdk';
import { ServiceMonitorService } from './service-monitor.service';

@Controller('registry')
export class ServiceMonitorController {
  constructor(private readonly monitor: ServiceMonitorService) {}

  @Get('monitor')
  async getMonitor() {
    return ResponseUtil.success(await this.monitor.snapshot());
  }
}
