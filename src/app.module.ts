import { Module } from '@nestjs/common';
import { EnableTypeOrm } from '@nest-cloud/sdk';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@EnableTypeOrm()
@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '../public'), // 注意相对 __dirname，指向 public
      serveRoot: '/public',
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
