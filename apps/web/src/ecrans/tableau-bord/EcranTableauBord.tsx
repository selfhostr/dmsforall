import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { FiltreTableauBord } from '@dfa/shared';

import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';
import { useFinancierTableauBord } from '@/hooks/tableau-bord/useFinancierTableauBord';
import { useSession } from '@/hooks/useSession';

import { BlocActiviteTableauBord } from './BlocActiviteTableauBord';
import { BlocFinancierTableauBord } from './BlocFinancierTableauBord';
import { peutVoirFinancierTableauBord } from './droits';
import { SelecteurPeriodeTableauBord } from './SelecteurPeriodeTableauBord';
import { SelecteurSiteTableauBord } from './SelecteurSiteTableauBord';

/**
 * Tableau de bord du garage — vue « d'un coup d'œil », DEUX blocs adossés à DEUX endpoints
 * séparés (`GET /tableau-bord/activite`, `GET /tableau-bord/financier`) qui réussissent/échouent
 * indépendamment, d'où deux hooks distincts plutôt qu'un seul appel composite.
 *
 * SÉPARATION DES POUVOIRS (le point le plus important de cet écran) : le bloc financier est
 * RÉSERVÉ `direction`/`comptable` (RF-115, `admin` explicitement EXCLU — pas un bug, une décision
 * métier délibérée). Un rôle non autorisé ne doit JAMAIS voir ce bloc vide, grisé, en erreur, ni
 * même un skeleton qui charge indéfiniment : `<BlocFinancierTableauBord/>` n'est tout simplement
 * PAS monté pour lui (`peutVoirFinancierTableauBord(role) ? <.../> : null`), et
 * `useFinancierTableauBord` ne déclenche même pas la requête (`enabled` piloté par le même
 * calcul) — double défense en profondeur, la garde de route (`ROLES_TABLEAU_BORD_ACTIVITE`) ne
 * pouvant à elle seule exprimer ce second niveau de droit sur la même route.
 *
 * Site et période sont PARTAGÉS entre les deux blocs (une seule paire de sélecteurs en haut de
 * l'écran) — état local `du`/`au` initialement `undefined` : aucune valeur n'est envoyée au
 * premier rendu, le serveur applique alors son défaut (mois civil UTC courant) et le renvoie en
 * écho dans `periode`, affichée au-dessus des deux blocs pour qu'un utilisateur qui n'a rien
 * touché comprenne quelle période il regarde. `siteId` absent est un état légitime (agrège tous
 * les sites du tenant), synchronisé avec `?site=` comme le reste de l'app.
 */
export function EcranTableauBord() {
  const { t } = useTranslation('tableauBord');
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const siteId = searchParams.get('site') ?? undefined;

  const [du, setDu] = useState<string | undefined>(undefined);
  const [au, setAu] = useState<string | undefined>(undefined);

  function changerSite(nouveauSiteId: string | undefined) {
    const parametres = new URLSearchParams(searchParams);
    if (nouveauSiteId) {
      parametres.set('site', nouveauSiteId);
    } else {
      parametres.delete('site');
    }
    setSearchParams(parametres);
  }

  const filtre = useMemo<FiltreTableauBord>(() => ({ siteId, du, au }), [siteId, du, au]);

  const role = session?.utilisateur.role;
  const autoriseFinancier = peutVoirFinancierTableauBord(role);

  const resultatActivite = useActiviteTableauBord(filtre);
  const resultatFinancier = useFinancierTableauBord(filtre, autoriseFinancier);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('tableauBord:titre')}</h1>

      <div className="flex flex-wrap items-end gap-4">
        <SelecteurSiteTableauBord
          sites={session?.sites ?? []}
          siteId={siteId}
          onChange={changerSite}
        />
        <SelecteurPeriodeTableauBord
          du={du}
          au={au}
          onChangeDu={setDu}
          onChangeAu={setAu}
          periodeAppliquee={resultatActivite.data?.periode}
        />
      </div>

      <BlocActiviteTableauBord resultat={resultatActivite} />

      {autoriseFinancier ? <BlocFinancierTableauBord resultat={resultatFinancier} /> : null}
    </div>
  );
}
