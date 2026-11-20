import { SERVICE_BASE_URL_OPTIONS } from '@nest-cloud/sdk';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class RegisterInstanceForm {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsUrl(SERVICE_BASE_URL_OPTIONS)
  baseUrl?: string;

  @ValidateIf((form: RegisterInstanceForm) => !form.baseUrl || form.host !== undefined)
  @IsString()
  @IsNotEmpty()
  host?: string;

  @ValidateIf((form: RegisterInstanceForm) => !form.baseUrl || form.port !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  heartbeatInterval?: number;

  @IsOptional()
  @IsString()
  group?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
