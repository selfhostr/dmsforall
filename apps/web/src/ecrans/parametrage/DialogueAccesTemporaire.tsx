import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
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
import { Label } from '@/components/ui/label';

interface Props {
  readonly ouvert: boolean;
  readonly motDePasseTemporaire: string | null;
  readonly onFerme: () => void;
}

/**
 * Révèle UNE SEULE FOIS le mot de passe temporaire généré par le serveur (création d'un employé
 * ou réinitialisation d'accès) — la réponse HTTP ne le porte qu'à cet instant, rien ne le
 * réaffichera plus tard (jamais persisté en clair, ni côté serveur ni dans le cache TanStack
 * Query : voir `useCreerUtilisateur`/`useReinitialiserAccesUtilisateur`). Pas de bouton « fermer »
 * en croix dans l'en-tête (`DialogContent` par défaut) qu'on cliquerait par réflexe sans lire —
 * seule l'action explicite « J'ai noté le mot de passe » ferme ce dialogue.
 */
export function DialogueAccesTemporaire({ ouvert, motDePasseTemporaire, onFerme }: Props) {
  const { t } = useTranslation(['parametrage', 'commun']);
  const [copie, setCopie] = useState(false);

  async function copier() {
    if (!motDePasseTemporaire) return;
    try {
      await navigator.clipboard.writeText(motDePasseTemporaire);
      setCopie(true);
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé, permission refusée) : le mot de passe
      // reste lisible et copiable à la main, rien de bloquant.
    }
  }

  return (
    <Dialog open={ouvert}>
      <DialogContent
        className="[&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('parametrage:utilisateurs.acces.titre')}</DialogTitle>
          <DialogDescription>{t('parametrage:utilisateurs.acces.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acces-temporaire-mdp">
            {t('parametrage:utilisateurs.acces.champMotDePasse')}
          </Label>
          <div className="flex items-center gap-2">
            <input
              id="acces-temporaire-mdp"
              type="text"
              readOnly
              value={motDePasseTemporaire ?? ''}
              className="flex h-10 flex-1 rounded-md border border-input bg-muted px-3 texte-corps font-mono anneau-focus"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={() => void copier()}>
              {copie ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {t('commun:actions.copier')}
            </Button>
          </div>
          <p role="status" aria-live="polite" className="texte-libelle text-muted-foreground">
            {copie ? t('parametrage:utilisateurs.acces.copie') : null}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" onClick={onFerme}>
            {t('parametrage:utilisateurs.acces.fermer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
