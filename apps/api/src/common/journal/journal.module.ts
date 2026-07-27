import { Global, Module } from '@nestjs/common';
import { ServiceJournal } from './service-journal';

@Global()
@Module({
  providers: [ServiceJournal],
  exports: [ServiceJournal],
})
export class JournalModule {}
