import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { BaseController, PageCommon, ResponseUtil } from '@nest-cloud/sdk';
import { ConfigFileService } from '../service/config-file.service';
import { ConfigFileForm, ConfigFileUpdateForm } from '../form/config-file.form';
import { ConfigFile } from '../entities/config-file.entity';

@Controller('config-files')
export class ConfigFileController extends BaseController<ConfigFile, ConfigFileService> {
  constructor(private readonly configFileService: ConfigFileService) {
    super(configFileService);
  }

  @Get('page')
  async page(
    @Query() page: PageCommon,
    @Query('published') published?: string,
    @Query('format') format?: string,
  ) {
    return ResponseUtil.success(
      await this.configFileService.paginateWithName(page, published, format),
    );
  }

  @Post()
  async create(@Body() data: ConfigFileForm) {
    return ResponseUtil.success(await this.configFileService.createOrUpdate(data));
  }

  /** 保留旧版部分更新路由；编辑已发布记录时返回对应草稿。 */
  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() data: ConfigFileUpdateForm) {
    return ResponseUtil.success(await this.configFileService.update(id, data));
  }

  @Post(':id/publish')
  async publish(@Param('id', ParseIntPipe) id: number) {
    return ResponseUtil.success(await this.configFileService.publish(id));
  }

  @Get('latest')
  async latest(@Query('name') name: string) {
    return ResponseUtil.success(await this.configFileService.findLatestConfig(name));
  }

  @Get('history')
  async history(@Query('name') name: string) {
    return ResponseUtil.success(await this.configFileService.getVersionHistory(name));
  }

  @Get('client/pull')
  async pull(@Query('serviceName') serviceName?: string, @Query('names') names?: string) {
    return ResponseUtil.success(
      await this.configFileService.pullPublishedConfigs({
        serviceName,
        names: names
          ?.split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    );
  }

  @Delete('')
  async delete(@Body() ids: number[]) {
    return ResponseUtil.success(await this.configFileService.removeItems(ids));
  }
}
