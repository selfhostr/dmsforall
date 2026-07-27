import { Module } from '@nestjs/common';
import { SiteController } from './site.controller';
import { TenantController } from './tenant.controller';
import { ServiceSite } from './service-site';
import { ServiceTenant } from './service-tenant';

/** Endpoints 4-5-6 du contrat étape 0 : tenant courant + sites (lecture seule). */
@Module({
  controllers: [TenantController, SiteController],
  providers: [ServiceTenant, ServiceSite],
})
export class SocleModule {}
