import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  readonly ouvert: boolean;
  /** Nombre de travaux « Proposée » (en attente d'accord du client). */
  readonly nombre: number;
  /** Titre du geste que l'utilisateur voulait faire (« Terminer », « Valider le contrôle »). */
  readonly libelleAction: string;
  /** `true` pour un rôle autorisé à annuler des lignes (sinon le choix « retirer » est absent). */
  readonly peutRetirer: boolean;
  readonly enCours: boolean;
  readonly messageErreur: string | null;
  readonly onLaisser: () => void;
  readonly onRetirer: () => void;
  readonly onAnnuler: () => void;
}

/**
 * Avertissement avant de terminer l'OR (ou de valider le contrôle) alors que des travaux restent
 * « Proposée » : ni réalisés ni refusés, sans accord du client. Trois issues nommées, jamais un
 * « OK » : les laisser en attente, les retirer de l'OR, ou annuler et revenir. N'affaiblit rien
 * côté API — le serveur reste l'arbitre de la transition.
 */
export function DialogueLignesEnAttente({
  ouvert,
  nombre,
  libelleAction,
  peutRetirer,
  enCours,
  messageErreur,
  onLaisser,
  onRetirer,
  onAnnuler,
}: Props) {
  const { t } = useTranslation(['or', 'commun']);

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => (valeur ? undefined : onAnnuler())}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <TriangleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-statut-attention" />
            <DialogTitle>{t('or:lignesEnAttente.titre', { count: nombre })}</DialogTitle>
          </div>
          <DialogDescription>
            {t('or:lignesEnAttente.description', { count: nombre, action: libelleAction })}
          </DialogDescription>
        </DialogHeader>

        {messageErreur ? (
          <p role="alert" className="texte-libelle text-destructive">
            {messageErreur}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={enCours} onClick={onAnnuler}>
            {t('or:lignesEnAttente.annuler')}
          </Button>
          {peutRetirer ? (
            <Button type="button" variant="outline" disabled={enCours} onClick={onRetirer}>
              {t('or:lignesEnAttente.retirer', { count: nombre })}
            </Button>
          ) : null}
          <Button type="button" disabled={enCours} onClick={onLaisser}>
            {t('or:lignesEnAttente.laisser', { count: nombre })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
