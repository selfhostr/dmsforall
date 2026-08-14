import { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useModifierStockSite } from '@/hooks/pieces/useModifierStockSite';

/** Le casier (rayon/tiroir, 0056) à modifier — `null` = dialogue fermé, même patron que
 *  `DialogueLiberationReservation` (`reservationId: string | null`). `emplacement` (texte libre)
 *  est affiché en LECTURE SEULE ici, pour contexte : ce dialogue édite le COMPLÉMENT structuré,
 *  jamais le texte libre lui-même (aucun écran ne l'édite à ce jour, gap pré-existant signalé au
 *  rapport de livraison). */
export interface CasierAModifier {
  readonly articleId: string;
  readonly siteId: string;
  readonly nomSite: string;
  readonly rayon: string | null;
  readonly tiroir: string | null;
  readonly emplacement: string | null;
}

interface Props {
  readonly casier: CasierAModifier | null;
  readonly onFerme: () => void;
}

/**
 * `PATCH /articles/{id}/stock/{siteId}` limité à `rayon`/`tiroir` (0056) — la normalisation
 * (majuscules, sans espace) est GARANTIE côté contrat (`schemaCasier`,
 * `packages/shared/src/contrats/pieces/primitives.ts`), jamais reproduite ici : ce composant
 * envoie la saisie telle quelle, c'est le serveur qui la met en forme canonique avant écriture —
 * `resultat.rayon` après succès peut donc différer de la saisie brute (ex. « b3 » saisi, « B3 »
 * affiché après rafraîchissement), attendu et voulu.
 */
export function DialogueEmplacementStockArticle({ casier, onFerme }: Props) {
  const { t } = useTranslation(['pieces', 'commun']);
  const modifier = useModifierStockSite();
  const [rayon, setRayon] = useState('');
  const [tiroir, setTiroir] = useState('');

  useEffect(() => {
    if (casier) {
      setRayon(casier.rayon ?? '');
      setTiroir(casier.tiroir ?? '');
    }
  }, [casier]);

  function soumettre() {
    if (!casier) return;
    modifier.mutate(
      { articleId: casier.articleId, siteId: casier.siteId, entree: { rayon, tiroir } },
      { onSuccess: onFerme },
    );
  }

  return (
    <Dialog open={casier !== null} onOpenChange={(ouvert) => !ouvert && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('pieces:emplacement.dialogue.titre')}
            {casier ? ` — ${casier.nomSite}` : ''}
          </DialogTitle>
          <DialogDescription>{t('pieces:emplacement.dialogue.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="casier-rayon">{t('pieces:emplacement.dialogue.rayon')}</Label>
            <Input
              id="casier-rayon"
              readOnly={modifier.isPending}
              value={rayon}
              onChange={(evenement) => setRayon(evenement.target.value)}
              maxLength={20}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="casier-tiroir">{t('pieces:emplacement.dialogue.tiroir')}</Label>
            <Input
              id="casier-tiroir"
              readOnly={modifier.isPending}
              value={tiroir}
              onChange={(evenement) => setTiroir(evenement.target.value)}
              maxLength={20}
            />
          </div>
          <p className="texte-libelle text-muted-foreground">
            {t('pieces:emplacement.dialogue.aide')}
          </p>
          <p className="texte-libelle text-muted-foreground">
            {casier?.emplacement
              ? t('pieces:emplacement.dialogue.libreActuel', { emplacement: casier.emplacement })
              : t('pieces:emplacement.dialogue.libreAucun')}
          </p>
        </div>

        {modifier.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(modifier.error, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFerme} disabled={modifier.isPending}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={modifier.isPending} onClick={soumettre}>
            {modifier.isPending ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
