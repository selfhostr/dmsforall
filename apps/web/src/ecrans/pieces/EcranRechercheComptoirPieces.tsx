import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ResultatRechercheComptoirArticle } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useRechercheComptoirPieces } from '@/hooks/pieces/useRechercheComptoirPieces';
import { useSession } from '@/hooks/useSession';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { DialogueRetourClientComptoir } from './DialogueRetourClientComptoir';
import { DialogueVenteComptoir } from './DialogueVenteComptoir';
import { peutCreerMouvement } from './droits';
import { SelecteurSiteRequis } from './SelecteurSiteRequis';
import { formaterQuantiteMillieme, texteEmplacementComplet } from './utils';

/**
 * Recherche comptoir pièces (`GET /articles/recherche-comptoir` en recherche, `GET /articles` en
 * parcours) — LE geste n°1 du magasinier (brief) : un client au comptoir, une référence, « est-ce
 * que je l'ai, et à quel prix ». Un seul appel donne prix (TTC, RF-40), référence et disponibilité
 * au site.
 *
 * PARCOURABLE, pas seulement interrogeable (constat testeur : « une case vide, il faut taper une
 * référence que je ne connais pas ») : saisie vide -> liste du catalogue actif du site, triée par
 * désignation, chargeable page par page (`useRechercheComptoirPieces`, mode « parcours »). « Aucun
 * résultat » pour une recherche qui n'aboutit pas reste le cas NOMINAL, pas une erreur — traité
 * comme une réponse utile (`EtatVideRecherche`), jamais comme un échec.
 */
export function EcranRechercheComptoirPieces() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const { data: session } = useSession();
  const peutVendre = peutCreerMouvement(session?.actions);

  const {
    saisie,
    onSaisieChange,
    enParcours,
    enChargement,
    resultats,
    enErreur,
    erreur,
    relancer,
    aDavantage,
    chargementSuivant,
    chargerDavantage,
  } = useRechercheComptoirPieces(site);

  // Id de l'article ciblé par chaque dialogue — jamais l'objet lui-même : `article` est
  // retrouvé par id dans `resultats` À CHAQUE rendu (voir l'en-tête des deux dialogues), pour que
  // la quantité disponible affichée se corrige toute seule après un refus ou un succès (la
  // mutation invalide la recherche comptoir, `resultats` se rafraîchit, cet écran re-rend).
  const [venteOuverteId, setVenteOuverteId] = useState<string | null>(null);
  const [retourOuvertId, setRetourOuvertId] = useState<string | null>(null);
  const articleVente = resultats?.find((a) => a.articleId === venteOuverteId) ?? null;
  const articleRetour = resultats?.find((a) => a.articleId === retourOuvertId) ?? null;

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
      rendu: (article) => {
        const emplacementComplet = texteEmplacementComplet(t, article);
        return article.quantiteDisponibleMillieme > 0 ? (
          <div className="flex flex-col items-end">
            <span className="tabular-nums text-statut-succes">
              {t('pieces:rechercheComptoir.resultat.disponible', {
                n: formaterQuantiteMillieme(article.quantiteDisponibleMillieme),
              })}
            </span>
            {emplacementComplet !== null ? (
              <span className="texte-libelle text-muted-foreground">{emplacementComplet}</span>
            ) : null}
          </div>
        ) : (
          <span className="texte-libelle text-destructive">
            {t('pieces:rechercheComptoir.resultat.rupture')}
          </span>
        );
      },
    },
  ];

  // Masquée entièrement sans le droit (`pieces.mouvement.creer`, magasinier seul, §11) — pas
  // seulement désactivée : un rôle qui ne peut rien faire de cette colonne n'a aucune raison de
  // la voir (même doctrine que `PanneauMouvementsArticle`/`peutCreerMouvement`).
  if (peutVendre) {
    colonnes.push({
      id: 'actions',
      libelle: t('pieces:comptoirVente.actions.titre'),
      alignement: 'droite',
      actions: true,
      rendu: (article) => (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={article.quantiteDisponibleMillieme <= 0}
            onClick={() => setVenteOuverteId(article.articleId)}
          >
            {t('pieces:comptoirVente.actions.vendre')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRetourOuvertId(article.articleId)}
          >
            {t('pieces:comptoirVente.actions.retourClient')}
          </Button>
        </div>
      ),
    });
  }

  if (!site) {
    return (
      <GabaritEcran titre={t('pieces:rechercheComptoir.titre')}>
        <div className="mx-auto w-full max-w-lg">
          <SelecteurSiteRequis onChoisir={(siteId) => setSearchParams({ site: siteId })} />
        </div>
      </GabaritEcran>
    );
  }

  if (enErreur) {
    return (
      <GabaritEcran titre={t('pieces:rechercheComptoir.titre')}>
        <EtatErreur
          titre={t('pieces:rechercheComptoir.erreur.titre')}
          description={messageErreur(erreur, t)}
          onReessayer={relancer}
        />
      </GabaritEcran>
    );
  }

  const saisieNonVide = saisie.trim().length > 0;

  // Deux raisons distinctes pour une liste vide : le catalogue actif n'a AUCUN article (mode
  // parcours) contre « rien ne correspond à cette recherche » (mode recherche) — même distinction
  // que `EcranListeArticles` entre `EtatVidePremierUsage` et `EtatVideRecherche`, jamais le même
  // message pour les deux cas. Titres nommant l'ABSENCE, jamais « Recherche comptoir » (le h1 de
  // cet écran, masqué en `sr-only` par `GabaritEcran` car doublon de l'onglet « Comptoir ») — même
  // défaut que celui corrigé le 17.08.2026 sur `EcranListeFactures.tsx`.
  const contenuVide = enParcours ? (
    <EtatVidePremierUsage
      titre={t('pieces:rechercheComptoir.vide.catalogue.titre')}
      description={t('pieces:rechercheComptoir.vide.catalogue.description')}
    />
  ) : (
    <EtatVideRecherche
      titre={t('pieces:rechercheComptoir.vide.recherche.titre')}
      description={t('pieces:rechercheComptoir.vide.recherche.description')}
    />
  );

  return (
    // Pleine largeur (retour produit du 12.08.2026 : « le module comptoir ne prend pas du tout la
    // largeur de la page ») — `GabaritEcran` ne pose plus de `max-w-2xl`/`mx-auto` sur l'écran
    // entier ; seul l'état « choisir un site » ci-dessus, une carte de sélection volontairement
    // centrée et étroite, garde sa propre largeur limitée (`max-w-lg` posé localement dessus, pas
    // sur tout l'écran).
    //
    // Titre MASQUÉ automatiquement (retour produit du 17.08.2026, chantier « titres doublés » :
    // « dans Comptoir, c'est écrit "Recherche comptoir" et du coup ça fait un espace horrible »).
    // Ancienne doctrine (ci-dessus jusqu'à ce correctif) : « Recherche comptoir » n'était PAS
    // considéré comme un doublon de l'onglet « Comptoir » (le titre ajoutait « Recherche », absent
    // de l'onglet). @laupernoe a explicitement re-arbitré dans l'autre sens le 17.08.2026 — le titre
    // CONTIENT le libellé de l'onglet (« comptoir »), la détection de `GabaritEcran` le masque
    // (`sr-only`, jamais retiré du DOM) sans qu'il soit besoin de poser `titreVisible` ici.
    <GabaritEcran titre={t('pieces:rechercheComptoir.titre')}>
      {/* Rappel permanent (pas seulement dans le placeholder, coupé sur tablette) que la
          recherche accepte un bout de désignation, pas seulement une référence exacte. */}
      <p className="texte-libelle text-muted-foreground">{t('pieces:rechercheComptoir.aide')}</p>

      <BarreFiltres
        q={saisie}
        onChangeQ={onSaisieChange}
        placeholderRecherche={t('pieces:rechercheComptoir.champRecherche')}
        filtresActifs={saisieNonVide}
        onEffacerFiltres={() => onSaisieChange('')}
      />

      <TableComptoir
        colonnes={colonnes}
        lignes={resultats ?? []}
        cleLigne={(article) => article.articleId}
        enChargement={enChargement}
        onOuvrirLigne={(article) => navigate(chemins.pieces.articleDetail(article.articleId, site))}
        libelleLigne={(article) => t('commun:actions.ouvrirElement', { nom: article.designation })}
        contenuVide={contenuVide}
      />

      {enParcours ? (
        <BoutonChargerPlus
          aChargerPlus={aDavantage}
          enChargement={chargementSuivant}
          onChargerPlus={chargerDavantage}
        />
      ) : null}

      {peutVendre ? (
        <>
          <DialogueVenteComptoir
            ouvert={venteOuverteId !== null}
            onOuvertChange={(ouvert) => {
              if (!ouvert) setVenteOuverteId(null);
            }}
            siteId={site}
            article={articleVente}
          />
          <DialogueRetourClientComptoir
            ouvert={retourOuvertId !== null}
            onOuvertChange={(ouvert) => {
              if (!ouvert) setRetourOuvertId(null);
            }}
            siteId={site}
            article={articleRetour}
          />
        </>
      ) : null}
    </GabaritEcran>
  );
}
