import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** La question, au mode indicatif (ex. « Fusionner ces deux fiches client ? »). */
  readonly titre: string;
  /** La conséquence concrète, en une phrase (ex. « Les véhicules et OR de Jean Dupont seront
   *  rattachés à Jean-Pierre Dupont. »). */
  readonly description: string;
  /** Le verbe exact de l'action qui confirme (ex. « Fusionner »), jamais « OK » ni « Confirmer »
   *  (docs/design-comptoir.md §8). */
  readonly libelleConfirmation: string;
  readonly onConfirmer: () => void;
  /** Style destructif pour une confirmation dont la conséquence est elle-même une perte
   *  (ex. fusion irréversible). Par défaut `false` : la plupart des confirmations restent une
   *  action normale du produit, pas une suppression. */
  readonly destructif?: boolean;
  readonly enCours?: boolean;
  /** Message d'erreur de la tentative de confirmation précédente (ex. `messageErreurMutation(erreur,
   *  t)`), affiché À L'INTÉRIEUR de la modale — jamais dans l'écran en dessous, invisible sous
   *  l'overlay tant que la modale reste ouverte (issue #63, correctif de cause racine). Absent ou
   *  `null` par défaut : rétrocompatible avec les appelants qui n'ont pas encore de mutation
   *  susceptible d'échouer ici. Fournir cette prop ne referme PAS la modale automatiquement — reste
   *  à l'appelant de ne fermer que sur succès (ex. `mutate(x, { onSuccess: () => onOuvertChange(false) })`,
   *  jamais `onSettled`) : sinon un échec ferme la modale avant que ce message n'ait pu s'afficher. */
  readonly messageErreur?: string | null;
  /** Contenu complémentaire sous la description (ex. liens vers les éléments concernés). */
  readonly children?: ReactNode;
}

/**
 * Avertissement confirmable (invariant n°8, protocole de confirmation en deux temps, §4.4 du
 * contrat) — l'action **reste possible** après confirmation explicite d'un rôle habilité. Modal
 * (`Dialog`, jamais un `Sheet` : une confirmation est courte, pas un panneau de travail), accent
 * ambre (`--statut-attention`) au contraire de `RefusBloquant` (rouge, `--statut-danger`, encart
 * inline non modal) : les deux restent visuellement distincts à 100 % (§9.5 du document atelier,
 * docs/design-comptoir.md §8).
 */
export function AvertissementConfirmable({
  ouvert,
  onOuvertChange,
  titre,
  description,
  libelleConfirmation,
  onConfirmer,
  destructif = false,
  enCours = false,
  messageErreur = null,
  children,
}: Props) {
  const { t } = useTranslation('commun');

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <TriangleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-statut-attention" />
            <DialogTitle>{titre}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {messageErreur ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('commun:actions.annuler')}</Button>
          </DialogClose>
          <Button
            variant={destructif ? 'destructive' : 'default'}
            disabled={enCours}
            onClick={onConfirmer}
          >
            {libelleConfirmation}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
