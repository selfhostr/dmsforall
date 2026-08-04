import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ResultatRechercheComptoirArticle } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { useRechercheComptoirPieces } from '@/hooks/pieces/useRechercheComptoirPieces';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { SelecteurSiteRequis } from './SelecteurSiteRequis';
import { formaterQuantiteMillieme } from './utils';

/**
 * Recherche comptoir pièces (`GET /articles/recherche-comptoir`) — LE geste n°1 du magasinier
 * (brief) : un client au comptoir, une référence, « est-ce que je l'ai, et à quel prix ». Un seul
 * appel donne prix (TTC, RF-40), référence et disponibilité au site. « Aucun résultat » pour une
 * référence inexistante est le cas NOMINAL, pas une erreur — traité comme une réponse utile
 * (`EtatVideRecherche`), jamais comme un échec.
 */
export function EcranRechercheComptoirPieces() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const { saisie, onSaisieChange, enChargement, resultats, enErreur, erreur, relancer } =
    useRechercheComptoirPieces(site);

  const colonnes: ColonneComptoir<ResultatRechercheComptoirArticle>[] = [
    {
      id: 'article',
      libelle: t('pieces:articles.titre'),
      rendu: (article) => (
        <div className="flex flex-col">
          <span className="font-medium">{article.designation}</span>
          <span className="font-mono texte-libelle text-muted-foreground">
            {article.referencePrincipale}
          </span>
        </div>
      ),
    },
    {
      id: 'prix',
      libelle: t('pieces:articles.prix.ttc'),
      alignement: 'droite',
      rendu: (article) => (
        <div className="flex flex-col items-end">
          <span className="tabular-nums font-medium">
            {formaterMontant(article.prixVenteTtcCentimes)}
          </span>
          {article.estEchangeStandard && article.montantConsigneTtcCentimes !== null ? (
            <span className="texte-libelle text-muted-foreground">
              + {formaterMontant(article.montantConsigneTtcCentimes)}{' '}
              {t('pieces:articles.consigne')}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'disponibilite',
      libelle: t('pieces:stock.quantites.disponible'),
      alignement: 'droite',
      rendu: (article) =>
        article.quantiteDisponibleMillieme > 0 ? (
          <div className="flex flex-col items-end">
            <span className="tabular-nums text-statut-succes">
              {t('pieces:rechercheComptoir.resultat.disponible', {
                n: formaterQuantiteMillieme(article.quantiteDisponibleMillieme),
              })}
            </span>
            {article.emplacement ? (
              <span className="texte-libelle text-muted-foreground">
                {t('pieces:rechercheComptoir.resultat.emplacement', {
                  emplacement: article.emplacement,
                })}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="texte-libelle text-destructive">
            {t('pieces:rechercheComptoir.resultat.rupture')}
          </span>
        ),
    },
  ];

  if (!site) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
        <h1 className="sr-only">{t('pieces:rechercheComptoir.titre')}</h1>
        <SelecteurSiteRequis onChoisir={(siteId) => setSearchParams({ site: siteId })} />
      </div>
    );
  }

  if (enErreur) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('pieces:rechercheComptoir.titre')}
        </h1>
        <EtatErreur
          titre={t('pieces:rechercheComptoir.erreur.titre')}
          description={messageErreur(erreur, t)}
          onReessayer={relancer}
        />
      </div>
    );
  }

  const saisieNonVide = saisie.trim().length > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('pieces:rechercheComptoir.titre')}
      </h1>

      <BarreFiltres
        q={saisie}
        onChangeQ={onSaisieChange}
        placeholderRecherche={t('pieces:rechercheComptoir.champRecherche')}
        filtresActifs={saisieNonVide}
        onEffacerFiltres={() => onSaisieChange('')}
      />

      {!saisieNonVide ? (
        <EtatVide
          titre={t('pieces:rechercheComptoir.titre')}
          description={t('pieces:rechercheComptoir.aide')}
        />
      ) : (
        <TableComptoir
          colonnes={colonnes}
          lignes={resultats ?? []}
          cleLigne={(article) => article.articleId}
          enChargement={enChargement}
          onOuvrirLigne={(article) =>
            navigate(chemins.pieces.articleDetail(article.articleId, site))
          }
          contenuVide={
            <EtatVideRecherche
              titre={t('pieces:rechercheComptoir.titre')}
              description={t('pieces:rechercheComptoir.vide.recherche')}
            />
          }
        />
      )}
    </div>
  );
}
