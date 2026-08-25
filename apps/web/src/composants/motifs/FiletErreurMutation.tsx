import { CircleAlert, ServerCrash, ShieldAlert, WifiOff, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  ecouterFiletErreurMutation,
  fermerToastFiletErreurMutation,
  obtenirToastsFiletErreurMutation,
  type GraviteFiletErreur,
} from './filet-erreur-mutation';

const ICONE_PAR_GRAVITE: Readonly<Record<GraviteFiletErreur, typeof CircleAlert>> = {
  droit: ShieldAlert,
  conflit: CircleAlert,
  reseau: WifiOff,
  serveur: ServerCrash,
  generique: CircleAlert,
};

// Même vocabulaire de couleur que le reste de l'app (docs/design-comptoir.md §8) : rouge
// `--statut-danger` pour un refus qui bloque réellement (droit, serveur, cas générique) ; ambre
// `--avertissement-*` pour un conflit métier (souvent une action à rejouer autrement, pas une
// panne) ; bleu `--statut-info` pour une panne réseau (transitoire, jamais la faute de
// l'utilisateur).
const STYLE_PAR_GRAVITE: Readonly<Record<GraviteFiletErreur, string>> = {
  droit: 'border-statut-danger bg-statut-danger-fond text-foreground [&_svg]:text-statut-danger',
  conflit:
    'border-avertissement-bordure bg-avertissement-fond text-foreground [&_svg]:text-avertissement',
  reseau: 'border-statut-info bg-statut-info-fond text-foreground [&_svg]:text-statut-info',
  serveur: 'border-statut-danger bg-statut-danger-fond text-foreground [&_svg]:text-statut-danger',
  generique:
    'border-statut-danger bg-statut-danger-fond text-foreground [&_svg]:text-statut-danger',
};

/**
 * Filet de sécurité générique (issue #63) — dernier recours affiché quand AUCUN écran n'a rendu
 * quoi que ce soit pour l'échec d'une mutation (décision prise par
 * `@/api/gestion-echecs-mutation`, voir sa documentation pour le détail du mécanisme). Monté UNE
 * SEULE FOIS dans `App.tsx`, toujours présent, jamais à instancier par écran.
 *
 * `role="alert"` par toast : un garagiste utilisant un lecteur d'écran doit être averti au même
 * titre qu'un encart inline — c'est délibérément le MÊME contrat d'accessibilité que
 * `components/ui/alert.tsx`, pas un régime dégradé pour le filet.
 *
 * Pas de `createPortal` : `<FiletErreurMutation />` est monté directement sous
 * `QueryClientProvider` dans `App.tsx`, au même niveau que `<RouterProvider>` — donc déjà hors de
 * tout conteneur d'écran susceptible de le rogner (`overflow`) ou de casser son `position: fixed`
 * (`transform`). Un portail n'aurait rien changé ici, seulement ajouté une indirection.
 */
export function FiletErreurMutation() {
  const { t } = useTranslation(['erreurs', 'commun']);
  const toasts = useSyncExternalStore(
    ecouterFiletErreurMutation,
    obtenirToastsFiletErreurMutation,
    obtenirToastsFiletErreurMutation,
  );

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-groupe sm:inset-x-auto sm:right-4 sm:w-96"
      aria-live="assertive"
    >
      {toasts.map((toast) => {
        const Icone = ICONE_PAR_GRAVITE[toast.gravite];
        return (
          <div
            key={toast.id}
            role="alert"
            className={cn(
              'flex items-start gap-3 rounded-md border p-carte shadow-lg',
              STYLE_PAR_GRAVITE[toast.gravite],
            )}
          >
            <Icone aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 texte-corps">
              <p className="font-medium">{toast.titre}</p>
              <p className="text-muted-foreground">{toast.message}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-m-2 h-8 w-8 shrink-0"
              aria-label={t('commun:actions.fermer')}
              onClick={() => fermerToastFiletErreurMutation(toast.id)}
            >
              <X aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
