import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { LigneReapprovisionnement } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { useReapprovisionnement } from '@/hooks/pieces/useReapprovisionnement';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

import { peutEcrireCommandeFournisseur } from './droits';
import type { EtatPreremplissageCommandeFournisseur } from './etat-preremplissage-commande';
import { SelecteurSiteRequis } from './SelecteurSiteRequis';
import { formaterQuantiteMillieme } from './utils';

/**
 * Réapprovisionnement (RP-12, priorité 4 du brief) — articles sous leur stock minimum, par site.
 * Propose, ne commande JAMAIS automatiquement (§7.5 du contrat) : aucune ligne n'est envoyée au
 * fournisseur sans un passage explicite par `EcranNouvelleCommandeFournisseur`, où le magasinier
 * garde la main sur fournisseur/quantités/prix avant de créer la commande. Ce que CET écran câble
 * (§ correctif) : une sélection de lignes + une action « Commander » qui OUVRE cet écran
 * pré-rempli (quantités suggérées) — jamais une création directe depuis ici. Réservé aux rôles
 * habilités à créer une commande fournisseur (`peutEcrireCommandeFournisseur`, même droit que
 * `EcranListeCommandesFournisseur`) : un rôle en lecture seule sur ce sous-domaine voit la liste
 * mais aucune case à cocher ni bouton, cet écran reste alors une pure consultation.
 */
export function EcranReapprovisionnement() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { data: session } = useSession();
  const peutCommander = peutEcrireCommandeFournisseur(session?.utilisateur.role);

  const {
    lignes,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useReapprovisionnement(site);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());

  function basculerSelection(articleId: string) {
    setSelection((valeur) => {
      const suivante = new Set(valeur);
      if (suivante.has(articleId)) {
        suivante.delete(articleId);
      } else {
        suivante.add(articleId);
      }
      return suivante;
    });
  }

  function commanderSelection() {
    if (!site || selection.size === 0) return;
    const lignesSelectionnees = lignes.filter((ligne) => selection.has(ligne.articleId));
    const etat: EtatPreremplissageCommandeFournisseur = {
      siteId: site,
      lignes: lignesSelectionnees.map((ligne) => ({
        articleId: ligne.articleId,
        numeroArticle: ligne.numeroArticle,
        designation: ligne.designation,
        quantiteSuggereeMillieme: ligne.quantiteCommandeStandardMillieme ?? ligne.ecartMillieme,
      })),
    };
    navigate(chemins.pieces.commandesFournisseur.nouvelle(), { state: etat });
  }

  const colonnes: ColonneComptoir<LigneReapprovisionnement>[] = [
    ...(peutCommander
      ? [
          {
            id: 'selection',
            libelle: (
              <span className="sr-only">
                {t('pieces:stock.reapprovisionnement.actions.commander')}
              </span>
            ),
            actions: true,
            className: 'w-10',
            rendu: (ligne: LigneReapprovisionnement) => (
              <Checkbox
                checked={selection.has(ligne.articleId)}
                onCheckedChange={() => basculerSelection(ligne.articleId)}
                aria-label={t('pieces:stock.reapprovisionnement.selection.aria', {
                  designation: ligne.designation,
                })}
              />
            ),
          } satisfies ColonneComptoir<LigneReapprovisionnement>,
        ]
      : []),
    {
      id: 'article',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.article'),
      rendu: (ligne) => (
        <div className="flex flex-col">
          <span className="font-medium">{ligne.designation}</span>
          <span className="texte-libelle text-muted-foreground">
            {t('pieces:articles.numero', { numero: ligne.numeroArticle })}
          </span>
        </div>
      ),
    },
    {
      id: 'disponible',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.disponible'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums">
          {formaterQuantiteMillieme(ligne.quantiteDisponibleMillieme)}
        </span>
      ),
    },
    {
      id: 'minimum',
      libelle: t('pieces:stock.reapprovisionnement.colonnes.minimum'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums">{formaterQuantiteMillieme(ligne.stockMinimumMillieme)}</span>
      ),
    },
    {
      id: 'ecart',
      libelle: t('pieces:stock.reapprovisionnement.ecart'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums text-destructive">
          {formaterQuantiteMillieme(ligne.ecartMillieme)}
        </span>
      ),
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
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('pieces:stock.reapprovisionnement.titre')}
        </h1>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('pieces:stock.reapprovisionnement.titre')}
        </h1>
        {peutCommander && selection.size > 0 ? (
          <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2">
            <span className="texte-corps text-foreground">
              {t('pieces:stock.reapprovisionnement.selection.nombreSelectionnes', {
                count: selection.size,
              })}
            </span>
            <Button type="button" onClick={commanderSelection}>
              {t('pieces:stock.reapprovisionnement.actions.commander')}
            </Button>
          </div>
        ) : null}
      </div>

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

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />
    </div>
  );
}
