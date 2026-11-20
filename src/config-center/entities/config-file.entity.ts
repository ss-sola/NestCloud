import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity } from 'typeorm';

@Entity('sys_config_file')
export class ConfigFile extends BaseEntity {
  @Column({ length: 128 })
  name!: string;

  @Column({ default: 'yaml', length: 16 })
  format!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ nullable: true, length: 255 })
  description?: string;

  @Column({ default: '', length: 32 })
  md5!: string;

  @Column({ default: 0 })
  version!: number;

  @Column({ name: 'is_published', default: false })
  isPublished!: boolean;

  @Column({ name: 'published_at', nullable: true, type: 'timestamp' })
  publishedAt?: Date | null;
}
