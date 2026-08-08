import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ResultatRecherche, TypeResultatRecherche } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { PanneauResultatsRecherche } from '@/composants/recherche/PanneauResultatsRecherche';
import { useRechercheComptoir } from '@/hooks/recherche/useRechercheComptoir';
import { chemins } from '@/routes/chemins';

// Même limitation que `ecrans/recherche/EcranRecherche.tsx` (module hors périmètre ici, propriété
// d'un autre chantier) : `routes/chemins.ts` n'a pas encore d'entrée Atelier/Facturation pour les
// OR et les documents de vente. Mapping DÉLIBÉRÉMENT dupliqué plutôt que d'éditer un fichier hors
// périmètre — les deux copies pointent vers les mêmes routes littérales confirmées dans
// `routes/routeur.tsx` (`ordres-reparation/:id`, `factures/:id`). Un futur ajout de ces entrées à
// `chemins.ts` devrait faire disparaître les deux copies au profit d'un seul appel partagé — à
// signaler à qui reprend `ecrans/recherche/`, pas à corriger ici (périmètre disjoint).
function cheminOr(id: string, site: string | undefined): string {
  return site
    ? `/ordres-reparation/${id}?site=${encodeURIComponent(site)}`
    : `/ordres-reparation/${id}`;
}

function cheminFacture(id: string, site: string | undefined): string {
  return site ? `/factures/${id}?site=${encodeURIComponent(site)}` : `/factures/${id}`;
}

/**
 * Destination d'un résultat sélectionné, par nature — même contrat que `CONSTRUCTEURS_CHEMIN` dans
 * `EcranRecherche.tsx` : `Record` exhaustif sur `TypeResultatRecherche` pour qu'une nature future
 * (article/dépôt pneu/fournisseur — voir prérequis API du Lot A) casse la compilation ici plutôt
 * que de silencieusement ne rien faire au clic. Le site sélectionné (`?site=` de l'URL courante)
 * est propagé vers chaque destination, même règle que partout ailleurs dans l'app.
 */
const CONSTRUCTEURS_CHEMIN: Record<
  TypeResultatRecherche,
  (id: string, site: string | undefined) => string
> = {
  vehicule: (id, site) => chemins.vehicules.detail(id, site),
  client: (id, site) => chemins.clients.detail(id, site),
  ordre_reparation: (id, site) => cheminOr(id, site),
  document_vente: (id, site) => cheminFacture(id, site),
};

/** `Ctrl+K` (Windows/Linux) ou `Cmd+K` (macOS) — `preventDefault()` sur le `keydown` supprime le
 *  raccourci natif du navigateur (Chrome/Firefox réservent Ctrl+K pour la barre d'adresse) avant
 *  qu'il ne s'exécute, pratique standard des palettes de commande web. */
function estRaccourciRecherche(evenement: KeyboardEvent): boolean {
  return (evenement.ctrlKey || evenement.metaKey) && evenement.key.toLowerCase() === 'k';
}

/**
 * Lot A (`docs/plan-refonte-navigation.md` §4) — la recherche partout : champ permanent dans
 * l'en-tête + bouton loupe toujours visible (contrainte Q4, jamais supposer un clavier — postes
 * tactiles), `Ctrl+K` en plus. Ouvre `PanneauResultatsRecherche` (composant existant, non réécrit
 * ici) en surimpression de l'écran courant via `Dialog` : l'arbre React de l'écran sous-jacent
 * reste monté pendant toute l'ouverture, donc aucune perte de saisie en cours n'est possible par
 * construction — fermer (Échap, tap extérieur, sélection d'un résultat) ne fait que démonter le
 * panneau, jamais l'écran dessous.
 *
 * Toute la logique réseau/anti-rebond reste dans `useRechercheComptoir` (déjà utilisé par
 * `EcranRecherche.tsx`) : ce composant ne fait qu'orchestrer l'ouverture/fermeture et la
 * navigation au clic, exactement comme `EcranRecherche.tsx` le fait pour la route dédiée.
 */
export function RechercheGlobale() {
  const { t } = useTranslation(['recherche', 'commun', 'erreurs']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const [ouvert, setOuvert] = useState(false);
  const { saisie, onSaisieChange, enChargement, reponse, enErreur, erreur, relancer } =
    useRechercheComptoir();

  // Raccourci global : actif dès que l'en-tête applicatif est monté (tout écran authentifié), pas
  // seulement quand le panneau est déjà ouvert — c'est tout le point du Lot A (« depuis n'importe
  // quel écran »).
  useEffect(() => {
    function gererRaccourci(evenement: KeyboardEvent) {
      if (estRaccourciRecherche(evenement)) {
        evenement.preventDefault();
        setOuvert(true);
      }
    }
    window.addEventListener('keydown', gererRaccourci);
    return () => window.removeEventListener('keydown', gererRaccourci);
  }, []);

  // Vide la saisie à la fermeture : rouvrir (Ctrl+K ou loupe) repart toujours d'un panneau propre
  // plutôt que d'exposer une recherche périmée — le contexte perdu ici est celui du panneau
  // lui-même, jamais celui de l'écran sous-jacent (voir docstring ci-dessus).
  function fermer() {
    setOuvert(false);
    onSaisieChange('');
  }

  function selectionner(resultat: ResultatRecherche) {
    fermer();
    navigate(CONSTRUCTEURS_CHEMIN[resultat.type](resultat.id, site));
  }

  const saisieNonVide = saisie.trim().length > 0;

  return (
    <>
      {/* Champ permanent + équivalent tactile du raccourci en UN SEUL élément : un vrai <button>
          (jamais un <div onClick>), aria-label explicite, icône décorative aria-hidden, ≥44px de
          cible tactile (Button size="default" = h-11), focus-visible hérité de Button. Le texte
          affiché EST le placeholder de `recherche:placeholder`, qui contient déjà « (Ctrl+K) » —
          le raccourci est donc annoncé dans le champ sans clé i18n supplémentaire. Sur very narrow
          viewport le libellé se masque (`hidden sm:inline`) mais le bouton et son icône loupe
          restent affichés : la cible tactile n'est jamais retirée. */}
      <Button
        type="button"
        variant="outline"
        onClick={() => setOuvert(true)}
        aria-label={t('commun:actions.rechercher')}
        className="w-full max-w-md justify-start gap-2 text-muted-foreground font-normal"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate hidden sm:inline">{t('recherche:placeholder')}</span>
      </Button>

      <Dialog open={ouvert} onOpenChange={(valeur) => (valeur ? setOuvert(true) : fermer())}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          {/* Titre requis par Radix Dialog pour un nom accessible — jamais affiché (le champ de
              recherche lui-même porte déjà le libellé visible `Command label=` dans
              `PanneauResultatsRecherche`). */}
          <DialogTitle className="sr-only">{t('recherche:titre')}</DialogTitle>
          <div className="pt-10 px-2 pb-2">
            {enErreur ? (
              <EtatErreur
                titre={
                  erreur instanceof ErreurReseau
                    ? t('erreurs:reseau.titre')
                    : t('erreurs:inattendue.titre')
                }
                description={messageErreur(erreur, t)}
                onReessayer={relancer}
              />
            ) : (
              <>
                <PanneauResultatsRecherche
                  valeur={saisie}
                  onValeurChange={onSaisieChange}
                  reponse={reponse}
                  enChargement={enChargement}
                  onSelectionner={selectionner}
                  onEchap={fermer}
                />
                {!saisieNonVide ? (
                  <EtatVide titre={t('recherche:titre')} description={t('recherche:aide')} />
                ) : null}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
