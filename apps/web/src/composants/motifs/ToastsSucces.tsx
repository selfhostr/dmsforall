import { CircleCheck, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { afficherToastFiletErreurMutation } from '@/composants/motifs/filet-erreur-mutation';
import i18n from '@/i18n';

import {
  DUREE_TOAST_SUCCES_MS,
  ecouterToastsSucces,
  fermerToastSucces,
  obtenirToastsSucces,
  type ToastSucces,
} from './toast-succes';

function ToastSuccesLigne({ toast }: { readonly toast: ToastSucces }) {
  const { t } = useTranslation('commun');
  const [suspendu, setSuspendu] = useState(false);
  const [annulationEnCours, setAnnulationEnCours] = useState(false);

  // Survol ou focus clavier à l'intérieur : le délai repart de zéro à la sortie.
  useEffect(() => {
    if (suspendu || annulationEnCours) return;
    const minuteur = setTimeout(() => fermerToastSucces(toast.id), DUREE_TOAST_SUCCES_MS);
    return () => clearTimeout(minuteur);
  }, [suspendu, annulationEnCours, toast.id]);

  const { annuler } = toast;

  async function annulerAction(): Promise<void> {
    if (!annuler) return;
    setAnnulationEnCours(true);
    try {
      await annuler();
      fermerToastSucces(toast.id);
    } catch (erreur) {
      fermerToastSucces(toast.id);
      afficherToastFiletErreurMutation(erreur, i18n.t);
    }
  }

  return (
    <div
      className="pointer-events-auto flex items-center gap-3 rounded-md border border-input bg-popover p-carte-compacte text-popover-foreground shadow-lg"
      onPointerEnter={() => setSuspendu(true)}
      onPointerLeave={() => setSuspendu(false)}
      onFocus={() => setSuspendu(true)}
      onBlur={() => setSuspendu(false)}
    >
      <CircleCheck aria-hidden className="h-5 w-5 shrink-0 text-statut-succes" />
      <p className="flex-1 texte-corps font-medium">{toast.message}</p>
      {annuler ? (
        <Button
          type="button"
          variant="outline"
          enChargement={annulationEnCours}
          onClick={() => void annulerAction()}
        >
          {t('commun:toasts.annuler')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-mr-2 shrink-0"
        aria-label={t('commun:actions.fermer')}
        onClick={() => fermerToastSucces(toast.id)}
      >
        <X aria-hidden className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * Conteneur des toasts de succès. Monté UNE SEULE FOIS dans `App.tsx`. `role="status"` +
 * `aria-live="polite"` : annoncé sans interrompre la lecture (un succès n'est pas une alerte).
 * En bas à gauche ; le filet d'erreur occupe le bas à droite. Sous 768 px, relevé au-dessus de la
 * barre de navigation basse.
 */
export function ToastsSucces() {
  const toasts = useSyncExternalStore(
    ecouterToastsSucces,
    obtenirToastsSucces,
    obtenirToastsSucces,
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-20 z-[100] flex flex-col gap-groupe md:inset-x-auto md:bottom-4 md:left-4 md:w-96"
    >
      {toasts.map((toast) => (
        <ToastSuccesLigne key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
