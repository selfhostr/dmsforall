import type { Langue } from './enums';

/** Corps de `GET /api/v1/tenant/courant`. */
export interface TenantCourant {
  readonly id: string;
  readonly slug: string;
  readonly raisonSociale: string;
  readonly langueDefaut: Langue;
}

/** Élément de `GET /api/v1/sites` et corps de `GET /api/v1/sites/{siteId}`. */
export interface SiteResume {
  readonly id: string;
  readonly code: string;
  readonly nom: string;
  readonly actif: boolean;
}
