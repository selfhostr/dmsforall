import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { ReponseArticle } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActionPrimaire, type ActionSecondaireMenu } from '@/composants/layout/ActionPrimaire';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { formaterDate, formaterMontant, formaterPourmille } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeStatutArticle } from './BadgeStatutArticle';
import { texteOuVide } from './utils';

interface Props {
  readonly article: ReponseArticle;
  readonly peutEcrire: boolean;
  readonly onModifier: () => void;
  readonly onMarquerObsolete: () => void;
  readonly onDesactiver: () => void;
  readonly onReactiver: () => void;
}

/** En-tête de la fiche article — identité, statut, prix, et le menu d'actions de transition
 *  (RP-04, §6.1). Chaque action de transition n'est proposée QUE depuis l'état qui l'autorise
 *  (obsolète/désactiver depuis `actif`, réactiver depuis `obsolete`/`desactive`) — même discipline
 *  que `PanneauActionsOr` (atelier) : ne jamais proposer un bouton dont le clic échouerait à coup
 *  sûr côté serveur. */
export function EnTeteFicheArticle({
  article,
  peutEcrire,
  onModifier,
  onMarquerObsolete,
  onDesactiver,
  onReactiver,
}: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'navigation']);
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  // Lot C (`docs/plan-refonte-navigation.md`) — fil d'Ariane contextuel, à la place du fil de
  // menu générique. Une pièce n'a pas de « qui » naturel (contrairement à l'OR ou au dossier de
  // vente, rattachés à un client) : le seul ancêtre honnête est la liste dont elle vient.
  const segmentsFilAriane: readonly SegmentFilAriane[] = [
    {
      cle: 'pieces',
      libelle: t('navigation:liens.piecesArticles'),
      href: chemins.pieces.articles(site),
    },
  ];

  const actionsSecondaires: ActionSecondaireMenu[] =
    article.statut === 'actif'
      ? [
          {
            cle: 'marquerObsolete',
            libelle: t('pieces:articles.actions.marquerObsolete'),
            onSelect: onMarquerObsolete,
          },
          {
            cle: 'desactiver',
            libelle: t('pieces:articles.actions.desactiver'),
            onSelect: onDesactiver,
          },
        ]
      : [
          {
            cle: 'reactiver',
            libelle: t('pieces:articles.actions.reactiver'),
            onSelect: onReactiver,
          },
        ];

  return (
    // Bordure décorative retirée (DESIGN.md « bordure structurelle uniquement ») : ce bloc
    // délimitait un simple groupe de contenu (identité + statut + métadonnées), sans comportement
    // propre. Devient une vraie `Card` — surface seule (`bg-card`), même mécanisme d'élévation par
    // contraste que le reste du produit — plutôt qu'un `<div>` bordé à la main, jamais rendu par
    // ailleurs (référence : `apps/web/src/ecrans/atelier/EnTeteOrdreReparation.tsx`).
    <Card>
      <CardContent className="flex flex-col gap-groupe pt-carte">
        <FilAriane segments={segmentsFilAriane} pageCourante={article.designation} />

        <div className="flex flex-col gap-groupe sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-champ">
            <div className="flex flex-wrap items-center gap-2">
              {/* `<h2>`, jamais `<h1>` — `EcranFicheArticle` pose déjà l'unique `<h1>` de la page via
                  `GabaritEcran` (générique, masqué par doublon avec l'onglet « Articles »). Deux
                  `<h1>` en compétition sur la même page était un défaut d'accessibilité préexistant
                  à ce chantier, corrigé au passage. */}
              <h2 className="texte-titre-page">{article.designation}</h2>
              <BadgeStatutArticle statut={article.statut} />
            </div>
            <p className="texte-corps text-muted-foreground">
              {t('pieces:articles.numero', { numero: article.numeroArticle })}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-champ texte-corps sm:grid-cols-3">
              <div>
                <dt className="texte-libelle text-muted-foreground">
                  {t('pieces:articles.reference')}
                </dt>
                <dd className="font-mono">{article.referencePrincipale}</dd>
              </div>
              <div>
                <dt className="texte-libelle text-muted-foreground">
                  {t('pieces:articles.marque')}
                </dt>
                <dd>{texteOuVide(article.marque)}</dd>
              </div>
              <div>
                <dt className="texte-libelle text-muted-foreground">
                  {t('pieces:articles.categorie')}
                </dt>
                <dd>{t(`pieces:articles.categories.${article.categorie}`)}</dd>
              </div>
              <div>
                <dt className="texte-libelle text-muted-foreground">
                  {t('pieces:articles.prix.vente')}
                </dt>
                <dd className="tabular-nums font-medium">
                  {formaterMontant(article.prixVenteTtcCentimes)}
                </dd>
              </div>
              <div>
                <dt className="texte-libelle text-muted-foreground">{t('pieces:articles.tva')}</dt>
                <dd className="tabular-nums">{formaterPourmille(article.tauxTvaPourmille)}</dd>
              </div>
              {article.estEchangeStandard && article.montantConsigneTtcCentimes !== null ? (
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('pieces:articles.montantConsigne')}
                  </dt>
                  <dd className="tabular-nums">
                    {formaterMontant(article.montantConsigneTtcCentimes)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-1 texte-libelle text-muted-foreground">
              {t('pieces:articles.fiche.creeLe')} {formaterDate(article.creeLe)} ·{' '}
              {t('pieces:articles.fiche.modifieLe')} {formaterDate(article.modifieLe)}
            </p>
          </div>

          {peutEcrire ? (
            <ActionPrimaire
              actionsSecondaires={actionsSecondaires}
              libelleMenuSecondaire={t('pieces:articles.actions.autresActions')}
            >
              <Button type="button" variant="default" onClick={onModifier}>
                {t('commun:actions.modifier')}
              </Button>
            </ActionPrimaire>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
