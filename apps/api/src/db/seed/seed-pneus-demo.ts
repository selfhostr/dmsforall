/**
 * Dépôt de pneus de démonstration (module hangar à pneus) — complète `seed-dev.ts` avec un jeu de
 * pneus hiver en dépôt, rattaché à un véhicule-client existant, pour que l'écran « hangar à
 * pneus » ait quelque chose à montrer (`select count(*) from public.depot_pneus` rendait 0 après
 * `pnpm db:seed`, issue #20, commentaire de suivi).
 *
 * Même doctrine que les autres fichiers de ce dossier (voir la tête de `seed-atelier-demo.ts`,
 * non répétée ici) : jamais `NestFactory`, le VRAI service `ServiceDepotPneus` (`pneus/`) est
 * câblé à la main.
 */
import 'reflect-metadata';

import type { EntreeCreationDepotPneus } from '@dfa/shared';

import type { ConfigBase, ContexteTenant } from '../index';
import { ServiceIdempotenceImpl } from '../../common/idempotence';
import { Horloge } from '../../common/horloge/horloge';
import { ServiceDepotPneus } from '../../pneus/service-depot-pneus';
import { ServiceAccesBase } from '../acces-base.service';

export interface OptionsSeedPneus {
  readonly config: ConfigBase;
  readonly tenantId: string;
  readonly idsSitesParCode: ReadonlyMap<string, string>;
  readonly idsVehiculesParCle: ReadonlyMap<string, string>;
  readonly idsUtilisateursParRole: ReadonlyMap<string, string>;
  readonly journaliser?: (message: string) => void;
}

/** Clé d'idempotence FIXE (uuid v4 littéral) — même doctrine que les autres fichiers de ce
 *  dossier. */
const CLE_DEPOT_PNEUS_OCTAVIA = '0daaa2df-12de-4ba7-bb7e-7e1943bf8470';

export async function semerPneusDemo(options: OptionsSeedPneus): Promise<void> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  if (options.config.NODE_ENV === 'production') {
    throw new Error(
      `Le seed de démonstration pneus est interdit en production : il crée un dépôt de pneus factice.`,
    );
  }

  const idMartigny = options.idsSitesParCode.get('MARTIGNY');
  const idOctavia = options.idsVehiculesParCle.get('TMBJJ7NE1M0123457');
  const idReceptionnaire = options.idsUtilisateursParRole.get('receptionnaire');
  if (!idMartigny || !idOctavia || !idReceptionnaire) {
    throw new Error(
      `seed-pneus-demo : site MARTIGNY, véhicule Octavia ou compte réceptionnaire introuvable — vérifier l'ordre d'exécution de seed-dev.ts.`,
    );
  }

  const acces = new ServiceAccesBase({
    NODE_ENV: options.config.NODE_ENV,
    DATABASE_URL: options.config.DATABASE_URL,
    DATABASE_POOL_MAX: options.config.DATABASE_POOL_MAX,
    DATABASE_POOL_MIN: options.config.DATABASE_POOL_MIN,
    DATABASE_TIMEOUT_REQUETE_MS: options.config.DATABASE_TIMEOUT_REQUETE_MS,
    DATABASE_TIMEOUT_CONNEXION_MS: options.config.DATABASE_TIMEOUT_CONNEXION_MS,
    DATABASE_TIMEOUT_IDLE_MS: options.config.DATABASE_TIMEOUT_IDLE_MS,
  });

  try {
    const horloge = new Horloge();
    const idempotence = new ServiceIdempotenceImpl(acces, horloge);
    const depotPneus = new ServiceDepotPneus(acces, idempotence);

    const ctx: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      requeteId: null,
    };

    // Jeu de pneus hiver de Mme Dupont (Skoda Octavia), déposé au garage de MARTIGNY (même site
    // que son OR de démo, `seed-atelier-demo.ts`) — dimension reprise du véhicule si connue,
    // sinon celle saisie ici (RPP-01).
    const entreeDepot: EntreeCreationDepotPneus = {
      siteId: idMartigny,
      saison: 'hiver',
      codeCase: 'H-014',
      dimension: '205/55 R16 91H',
      etat: 'bon',
    };
    await depotPneus.creer(ctx, idOctavia, entreeDepot, CLE_DEPOT_PNEUS_OCTAVIA);
    journaliser(`  dépôt de pneus hiver — Octavia/Dupont, case H-014 (MARTIGNY)`);
  } finally {
    await acces.onModuleDestroy();
  }
}
