import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { LigneReapprovisionnement } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useReapprovisionnement } from '@/hooks/pieces/useReapprovisionnement';
import { chemins } from '@/routes/chemins';

import { SelecteurSiteRequis } from './SelecteurSiteRequis';
import { formaterQuantiteMillieme } from './utils';

/**
 * Réapprovisionnement (RP-12, priorité 4 du brief) — articles sous leur stock minimum, par site.
 * Propose, ne commande JAMAIS automatiquement (§7.5 du contrat) : aucune action « commander »
 * n'est câblée ici, la route `commandes-fournisseur` n'est pas parmi les 18 livrées ce lot — cet
 * écran reste une CONSULTATION, honnête sur ce qu'elle peut faire.
 */
export function EcranReapprovisionnement() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const { lignes, isPending, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useReapprovisionnement(site);

  const colonnes: ColonneComptoir<LigneReapprovisionnement>[] = [
    {
      id: 'article',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.article'),
      rendu: (ligne) => (
        <div className="flex flex-col">
          <span className="font-medium">{ligne.designation}</span>
          <span className="texte-libelle text-muted-foreground">{t('pieces:articles.numero', { numero: ligne.numeroArticle })}</span>
        </div>
      ),
    },
    {
      id: 'disponible',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.disponible'),
      alignement: 'droite',
      rendu: (ligne) => <span className="tabular-nums">{formaterQuantiteMillieme(ligne.quantiteDisponibleMillieme)}</span>,
    },
    {
      id: 'minimum',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.minimum'),
      alignement: 'droite',
      rendu: (ligne) => <span className="tabular-nums">{formaterQuantiteMillieme(ligne.stockMinimumMillieme)}</span>,
    },
    {
      id: 'ecart',
      libelle: t('pieces:stock.reapprovisionnement.ecart'),
      alignement: 'droite',
      rendu: (ligne) => <span className="tabular-nums text-destructive">{formaterQuantiteMillieme(ligne.ecartMillieme)}</span>,
    },
  ];

  if (!site) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
        <h1 className="sr-only">{t('pieces:stock.reapprovisionnement.titre')}</h1>
        <SelecteurSiteRequis onChoisir={(siteId) => setSearchParams({ site: siteId })} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:stock.reapprovisionnement.titre')}</h1>
        <EtatErreur
          titre={t('pieces:stock.reapprovisionnement.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:stock.reapprovisionnement.titre')}</h1>

      <TableComptoir
        colonnes={colonnes}
        lignes={lignes}
        cleLigne={(ligne) => `${ligne.articleId}-${ligne.siteId}`}
        enChargement={isPending}
        onOuvrirLigne={(ligne) => navigate(chemins.pieces.articleDetail(ligne.articleId, site))}
        contenuVide={
          <EtatVidePremierUsage
            titre={t('pieces:stock.reapprovisionnement.titre')}
            description={t('pieces:stock.reapprovisionnement.vide')}
          />
        }
      />

      <BoutonChargerPlus aChargerPlus={Boolean(hasNextPage)} enChargement={isFetchingNextPage} onChargerPlus={() => void fetchNextPage()} />
    </div>
  );
}
