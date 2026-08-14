import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { FiltreTableauBord } from '@dfa/shared';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';
import { chemins } from '@/routes/chemins';

import { CarteChiffreRequete } from './composants/CarteChiffreRequete';

interface Props {
  readonly site: string | undefined;
}

/**
 * Admin — 3 blocs, AUCUN montant (`docs/design-tableau-bord-par-role.md` §3.9, RF-115) : rôle
 * technique sans droit financier, « aucun plan métier propre » (`routes/atterrissage.ts`). Un pouls
 * système léger (quantités seulement) + des raccourcis vers ses tâches réelles — jamais un
 * pilotage financier caché.
 *
 * TEST DE NON-FUITE F8 (§3.9 du design, verrouillé par `EcranTableauBord.spec.tsx`) : cet écran ne
 * doit JAMAIS porter de carte grisée « Financier » ni de section vide à la place du bloc financier
 * des autres rôles — les trois blocs ci-dessous sont TOUT ce qu'`admin` voit, point final.
 *
 * « OR actuellement en atelier » — même défaut corrigé que côté `TableauBordDirection` (test
 * manuel du 14.08.2026) : snapshot `ordresReparationParStatut` (indépendant de la période, donc
 * du filtre `siteId` seul) plutôt que `ordresReparationOuvertsPeriode` (compte les OR OUVERTS
 * pendant la journée, pas ceux encore actifs) — voir la doc de tête de `TableauBordDirection.tsx`
 * pour le détail de la cause mesurée.
 */
export function TableauBordAdmin({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);

  const filtreSite = useMemo<FiltreTableauBord>(() => ({ siteId: site }), [site]);
  const activite = useActiviteTableauBord(filtreSite);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <CarteChiffreRequete
          titre={t('tableauBord:activite.enAtelier.libelle')}
          resultat={activite}
          libelleErreur={t('tableauBord:activite.erreur.titre')}
          valeur={(donnees) =>
            String(donnees.ordresReparationParStatut.reduce((total, e) => total + e.nombre, 0))
          }
          description={() => t('tableauBord:activite.enAtelier.description')}
        />
        <CarteChiffreRequete
          titre={t('tableauBord:activite.articlesSousSeuil.libelle')}
          resultat={activite}
          libelleErreur={t('tableauBord:activite.erreur.titre')}
          valeur={(donnees) => String(donnees.articlesSousSeuilReapprovisionnement)}
        />
      </div>

      {/* Le design (§3.9) propose aussi « créer un utilisateur » — AUCUNE route/écran de gestion
          des utilisateurs n'existe encore dans ce dépôt (vérifié : `routeur.tsx`/`chemins.ts`
          n'ont aucune entrée `utilisateurs`) ; omis plutôt qu'un lien mort. Les deux raccourcis
          ci-dessous pointent vers des écrans RÉELS. */}
      <Card>
        <CardHeader>
          <CardTitle>{t('tableauBord:admin.raccourcis.titre')}</CardTitle>
        </CardHeader>
        <nav
          aria-label={t('tableauBord:admin.raccourcis.titre')}
          className="flex flex-col gap-2 px-carte pb-carte"
        >
          <Link
            to={chemins.parametrage.sites(site)}
            className="texte-corps font-medium text-primary underline"
          >
            {t('tableauBord:admin.raccourcis.sites')}
          </Link>
          <Link
            to={chemins.parametrage.atelier(site)}
            className="texte-corps font-medium text-primary underline"
          >
            {t('tableauBord:admin.raccourcis.parametrageAtelier')}
          </Link>
        </nav>
      </Card>
    </div>
  );
}
