import { Global, Module } from '@nestjs/common';
import { Horloge } from './horloge';

@Global()
@Module({
  providers: [Horloge],
  exports: [Horloge],
})
export class HorlogeModule {}
