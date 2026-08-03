import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseMouvementStock, SiteResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useMouvementsArticle } from '@/hooks/pieces/useMouvementsArticle';
import { formaterDateHeure } from '@/lib/formats';

import { DialogueMouvementStock } from './DialogueMouvementStock';
import { formaterQuantiteMillieme } from './utils';

interface Props {
  readonly articleId: string;
  readonly sites: readonly SiteResume[];
  readonly peutCreerMouvement: boolean;
  readonly siteParDefaut?: string;
}

function nomSite(sites: readonly SiteResume[], siteId: string | null): string {
  if (!siteId) return '—';
  return sites.find((site) => site.id === siteId)?.nom ?? siteId;
}

/**
 * Historique des mouvements de stock (RP-16 → RP-18) — `mouvement_stock` est IMMUABLE, cette table
 * n'affiche donc jamais d'action de modification/suppression sur une ligne, uniquement le bouton
 * d'ajout d'un nouveau mouvement (`DialogueMouvementStock`), gardé par `peutCreerMouvement`
 * (magasinier seul, §11).
 */
export function PanneauMouvementsArticle({ articleId, sites, peutCreerMouvement, siteParDefaut }: Props) {
  const { t } = useTranslation(['pieces', 'commun']);
  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const { mouvements, isPending, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useMouvementsArticle(articleId);

  const colonnes: ColonneComptoir<ReponseMouvementStock>[] = [
    { id: 'type', libelle: t('pieces:stock.mouvements.type'), rendu: (m) => t(`pieces:stock.mouvements.types.${m.type}`) },
    {
      id: 'quantite',
      libelle: t('pieces:stock.mouvements.quantite'),
      alignement: 'droite',
      rendu: (m) => <span className="tabular-nums">{formaterQuantiteMillieme(m.quantiteMillieme)}</span>,
    },
    {
      id: 'site',
      libelle: t('pieces:stock.site'),
      rendu: (m) =>
        m.type === 'transfert' ? `${nomSite(sites, m.siteSourceId)} → ${nomSite(sites, m.siteDestinationId)}` : nomSite(sites, m.siteId),
    },
    { id: 'motif', libelle: t('pieces:stock.mouvements.motif'), rendu: (m) => m.motif ?? '—' },
    { id: 'date', libelle: t('pieces:stock.mouvements.date'), alignement: 'droite', rendu: (m) => formaterDateHeure(m.creeLe) },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="texte-titre-section">{t('pieces:stock.mouvements.titre')}</CardTitle>
        {peutCreerMouvement ? (
          <Button type="button" variant="outline" onClick={() => setDialogueOuvert(true)}>
            {t('pieces:stock.mouvements.actions.nouveauMouvement')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isPending ? (
          <EtatChargement lignes={4} />
        ) : isError ? (
          <EtatErreur
            titre={t('pieces:stock.mouvements.erreur.titre')}
            description={messageErreur(error, t)}
            onReessayer={() => void refetch()}
          />
        ) : (
          <>
            <TableComptoir
              colonnes={colonnes}
              lignes={mouvements}
              cleLigne={(m) => m.id}
              contenuVide={<EtatVidePremierUsage titre={t('pieces:stock.mouvements.titre')} description={t('pieces:stock.mouvements.vide')} />}
            />
            <BoutonChargerPlus aChargerPlus={Boolean(hasNextPage)} enChargement={isFetchingNextPage} onChargerPlus={() => void fetchNextPage()} />
          </>
        )}
      </CardContent>

      {peutCreerMouvement ? (
        <DialogueMouvementStock
          ouvert={dialogueOuvert}
          onOuvertChange={setDialogueOuvert}
          articleId={articleId}
          sites={sites}
          siteParDefaut={siteParDefaut}
        />
      ) : null}
    </Card>
  );
}
