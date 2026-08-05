import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import type { ReponseDepotPneus } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useJeuxARelancer } from '@/hooks/pneus/useJeuxARelancer';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeSaisonPneu } from './composants/BadgeSaisonPneu';
import { DialogueChangerSaisonPneu } from './DialogueChangerSaisonPneu';
import { DialogueSortirDepotPneu } from './DialogueSortirDepotPneu';
import { peutGererDepotPneus } from './droits';

/**
 * Jeux à relancer (RPP-04, spec §6-7) — « place immobilisée et risque de litige », donc une liste
 * DÉDIÉE plutôt qu'un simple badge sur le plan (le plan les montre AUSSI, avec le même badge —
 * voir `EcranHangarPneus`/`BadgeStatutDepotPneu` — mais cette liste reste le point d'entrée pour
 * traiter le retard, tenant entier par défaut, pas seulement le site consulté au moment).
 * `GET /depots-pneus/a-relancer` (spec §5) : `siteId` optionnel, défaut tenant entier.
 */
export function EcranJeuxARelancer() {
  const { t } = useTranslation(['pneus', 'commun']);
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  const peutGerer = peutGererDepotPneus(role);
  const sites = (session?.sites ?? []).filter((s) => s.actif);

  const [depotChangementSaison, setDepotChangementSaison] = useState<ReponseDepotPneus | null>(
    null,
  );
  const [depotSortie, setDepotSortie] = useState<ReponseDepotPneus | null>(null);

  const {
    depots,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useJeuxARelancer({ siteId: site, tri: 'dernierMouvementLe:asc' });

  const colonnes: ColonneComptoir<ReponseDepotPneus>[] = [
    {
      id: 'repere',
      libelle: t('pneus:aRelancer.colonnes.repere'),
      rendu: (depot) => (
        <span className="font-mono">{depot.codeCase ?? t('pneus:jeu.sansRepere')}</span>
      ),
    },
    {
      id: 'saison',
      libelle: t('pneus:aRelancer.colonnes.saison'),
      rendu: (depot) => <BadgeSaisonPneu saison={depot.saison} />,
    },
    {
      id: 'dimension',
      libelle: t('pneus:aRelancer.colonnes.dimension'),
      rendu: (depot) => depot.dimension ?? t('pneus:jeu.sansDimension'),
    },
    {
      id: 'dernierMouvement',
      libelle: t('pneus:aRelancer.colonnes.dernierMouvement'),
      alignement: 'droite',
      rendu: (depot) => formaterDate(depot.dernierMouvementLe),
    },
    {
      id: 'vehicule',
      libelle: t('pneus:aRelancer.colonnes.vehicule'),
      rendu: (depot) => (
        <Link
          to={chemins.vehicules.detail(depot.vehiculeId, site)}
          className="texte-corps font-medium text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('pneus:jeu.actions.voirVehicule')}
        </Link>
      ),
    },
    ...(peutGerer
      ? [
          {
            id: 'actions',
            libelle: '',
            actions: true,
            rendu: (depot: ReponseDepotPneus) => (
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDepotChangementSaison(depot)}
                >
                  {t('pneus:jeu.actions.changerSaison')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDepotSortie(depot)}
                >
                  {t('pneus:jeu.actions.sortir')}
                </Button>
              </div>
            ),
          } satisfies ColonneComptoir<ReponseDepotPneus>,
        ]
      : []),
  ];

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pneus:aRelancer.titre')}</h1>
        <EtatErreur
          titre={t('pneus:aRelancer.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pneus:aRelancer.titre')}</h1>
        <p className="texte-corps text-muted-foreground">{t('pneus:aRelancer.description')}</p>
      </div>

      {sites.length > 0 ? (
        <div className="flex flex-col gap-1.5 max-w-xs">
          <Label htmlFor="pneus-a-relancer-site">{t('pneus:aRelancer.filtreSite')}</Label>
          <Select
            value={site ?? 'tous'}
            onValueChange={(valeur) => {
              // Copie les paramètres EXISTANTS plutôt que de les remplacer (même patron que
              // `EcranTableauBord.changerSite`) : `setSearchParams({ site })` écraserait tout
              // autre paramètre déjà présent dans l'URL.
              const parametres = new URLSearchParams(searchParams);
              if (valeur === 'tous') {
                parametres.delete('site');
              } else {
                parametres.set('site', valeur);
              }
              setSearchParams(parametres);
            }}
          >
            <SelectTrigger id="pneus-a-relancer-site">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('pneus:aRelancer.filtreSiteTous')}</SelectItem>
              {sites.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <TableComptoir
        colonnes={colonnes}
        lignes={depots}
        cleLigne={(depot) => depot.id}
        enChargement={isPending}
        contenuVide={
          <EtatVidePremierUsage
            titre={t('pneus:aRelancer.titre')}
            description={t('pneus:aRelancer.vide')}
          />
        }
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />

      <DialogueChangerSaisonPneu
        depot={depotChangementSaison}
        onFerme={() => setDepotChangementSaison(null)}
      />
      <DialogueSortirDepotPneu depot={depotSortie} onFerme={() => setDepotSortie(null)} />
    </div>
  );
}
