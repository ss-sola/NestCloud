import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export enum InstanceAvailability {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export class InstanceAvailabilityForm {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsEnum(InstanceAvailability)
  state!: InstanceAvailability;
}
