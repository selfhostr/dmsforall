import { Module } from '@nestjs/common';

import { JETON_FETCH_VERSION, ServiceVersion } from './service-version';
import { SystemeController } from './systeme.controller';

@Module({
  controllers: [SystemeController],
  providers: [ServiceVersion, { provide: JETON_FETCH_VERSION, useValue: fetch }],
})
export class SystemeModule {}
