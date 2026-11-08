import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ResultatRecherche } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { CONSTRUCTEURS_CHEMIN_RESULTAT } from '@/composants/recherche/chemins-resultats';
import { PanneauResultatsRecherche } from '@/composants/recherche/PanneauResultatsRecherche';
import { useRechercheComptoir } from '@/hooks/recherche/useRechercheComptoir';
import { cn } from '@/lib/utils';

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
interface Props {
  /** Barre latérale repliée : la loupe seule (nom accessible conservé). */
  readonly replie?: boolean;
  /** Enregistre Ctrl/⌘+K. Faux pour l'instance du tiroir mobile, afin qu'une seule instance
   *  écoute le raccourci quand l'`aside` (masqué mais monté) et le tiroir coexistent. */
  readonly raccourciClavier?: boolean;
}

const ecouteursOuverture = new Set<() => void>();

/**
 * Point d'ouverture de la recherche globale pour les écrans (ex. le champ de l'accueil) : même
 * effet que Ctrl/⌘+K, sans rejouer d'événement clavier. Seule l'instance qui écoute le raccourci
 * (`raccourciClavier`) s'ouvre, donc jamais deux fenêtres.
 */
export function useOuvrirRechercheGlobale(): () => void {
  return ouvrirRechercheGlobale;
}

function ouvrirRechercheGlobale(): void {
  ecouteursOuverture.forEach((ouvrir) => ouvrir());
}

/** Indication du raccourci selon la plateforme (⌘K sur Apple, Ctrl K ailleurs). */
function indicationRaccourci(): string {
  const plateforme = typeof navigator === 'undefined' ? '' : navigator.platform;
  return /mac|iphone|ipad/i.test(plateforme) ? '⌘K' : 'Ctrl K';
}

export function RechercheGlobale({ replie = false, raccourciClavier = true }: Props) {
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
    if (!raccourciClavier) return undefined;
    function gererRaccourci(evenement: KeyboardEvent) {
      if (estRaccourciRecherche(evenement)) {
        evenement.preventDefault();
        setOuvert(true);
      }
    }
    const ouvrir = () => setOuvert(true);
    ecouteursOuverture.add(ouvrir);
    window.addEventListener('keydown', gererRaccourci);
    return () => {
      ecouteursOuverture.delete(ouvrir);
      window.removeEventListener('keydown', gererRaccourci);
    };
  }, [raccourciClavier]);

  // Vide la saisie à la fermeture : rouvrir (Ctrl+K ou loupe) repart toujours d'un panneau propre
  // plutôt que d'exposer une recherche périmée — le contexte perdu ici est celui du panneau
  // lui-même, jamais celui de l'écran sous-jacent (voir docstring ci-dessus).
  function fermer() {
    setOuvert(false);
    onSaisieChange('');
  }

  function selectionner(resultat: ResultatRecherche) {
    fermer();
    navigate(CONSTRUCTEURS_CHEMIN_RESULTAT[resultat.type](resultat.id, site));
  }

  const saisieNonVide = saisie.trim().length > 0;

  return (
    <>
      {/* Champ de recherche visuel (pas un vrai champ de saisie : un bouton qui ouvre le panneau),
          h-11 = 44 px. Replié : la loupe seule, infobulle « Rechercher (Ctrl K) ». */}
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label={t('commun:actions.rechercher')}
        aria-keyshortcuts="Control+K Meta+K"
        title={replie ? `${t('commun:actions.rechercher')} (${indicationRaccourci()})` : undefined}
        className={cn(
          'anneau-focus flex h-11 w-full items-center rounded-md border border-input bg-background texte-corps text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          replie ? 'justify-center px-2' : 'gap-3 px-3',
        )}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        {replie ? null : (
          <>
            <span className="flex-1 text-left">{t('commun:actions.rechercher')}</span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 texte-libelle font-normal text-muted-foreground">
              {indicationRaccourci()}
            </kbd>
          </>
        )}
      </button>

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
