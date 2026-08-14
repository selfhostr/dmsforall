import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
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
  readonly titre: string;
  readonly description: string;
  readonly libelleConfirmer: string;
  readonly variantConfirmer?: 'default' | 'destructive';
  readonly enCours: boolean;
  readonly erreur: unknown;
  readonly onConfirmer: () => void;
  readonly onAnnuler: () => void;
}

/** Confirmation générique — désactiver/réactiver un employé, réinitialiser son accès. Ce produit
 *  n'a pas de primitive `AlertDialog` dédiée (`components/ui/`) : `Dialog` standard + un bouton de
 *  confirmation explicite jouent le même rôle, même patron que le reste de l'écran. */
export function DialogueConfirmationEmploye({
  ouvert,
  titre,
  description,
  libelleConfirmer,
  variantConfirmer = 'default',
  enCours,
  erreur,
  onConfirmer,
  onAnnuler,
}: Props) {
  const { t } = useTranslation(['commun', 'erreurs']);

  return (
    <Dialog open={ouvert} onOpenChange={(valeurOuverte) => !valeurOuverte && onAnnuler()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {erreur ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(erreur, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onAnnuler} disabled={enCours}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" variant={variantConfirmer} disabled={enCours} onClick={onConfirmer}>
            {enCours ? t('commun:chargement.enCours') : libelleConfirmer}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
