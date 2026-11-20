import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CONFIG_FILE_FORMATS } from '../../constants/config-file.constants';

class ConfigFileMetadataForm {
  @IsString()
  @IsOptional()
  @IsIn(CONFIG_FILE_FORMATS)
  format?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}

export class ConfigFileUpdateForm extends ConfigFileMetadataForm {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  content?: string;
}

export class ConfigFileForm extends ConfigFileMetadataForm {
  @IsInt()
  @Min(1)
  @IsOptional()
  id?: number;

  @IsString()
  @MaxLength(128)
  name: string;

  @IsString()
  content: string;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean = false;
}
