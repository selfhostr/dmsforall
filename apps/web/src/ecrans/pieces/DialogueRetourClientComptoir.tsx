import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ResultatRechercheComptoirArticle } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRetourClientComptoir } from '@/hooks/pieces/useVenteComptoirPieces';

import { formaterQuantiteMillieme, saisieVersQuantiteMillieme } from './utils';

const QUANTITE_PAR_DEFAUT = '1';
/** Même seuil que `DialogueMouvementStock` (`motif.trim().length >= 3`), qui reflète
 *  `schemaMotif` (`packages/shared/src/contrats/atelier/primitives.ts`, `min(3)`) — un refus
 *  serveur sur un motif de 1-2 caractères serait un aller-retour évitable. */
const LONGUEUR_MOTIF_MIN = 3;

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly siteId: string;
  /** Ligne LIVE — même contrat que `DialogueVenteComptoir` (voir son en-tête). */
  readonly article: ResultatRechercheComptoirArticle | null;
}

/**
 * Retour client (`POST /articles/{id}/mouvements/retour-client`) — le client rapporte une pièce,
 * remise en stock physique du site. Jamais refusé pour stock insuffisant (une ENTRÉE ne l'est
 * jamais, `RP-17`) : ce dialogue n'a donc pas le double contrôle client/serveur de
 * `DialogueVenteComptoir`, seule la validation de saisie (quantité, motif) s'applique.
 */
export function DialogueRetourClientComptoir({ ouvert, onOuvertChange, siteId, article }: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs', 'validation']);
  const { enCours, erreur, retourner } = useRetourClientComptoir(article?.articleId ?? '');

  const [quantiteSaisie, setQuantiteSaisie] = useState(QUANTITE_PAR_DEFAUT);
  const [motif, setMotif] = useState('');
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    setQuantiteSaisie(QUANTITE_PAR_DEFAUT);
    setMotif('');
    setErreurValidation(null);
  }, [ouvert, article?.articleId]);

  useEffect(() => {
    if (ouvert && !article) onOuvertChange(false);
  }, [ouvert, article, onOuvertChange]);

  if (!article) return null;

  function soumettre() {
    setErreurValidation(null);
    const quantite = saisieVersQuantiteMillieme(quantiteSaisie);
    if (quantite === null) {
      setErreurValidation(t('validation:requis'));
      return;
    }
    if (motif.trim().length < LONGUEUR_MOTIF_MIN) {
      setErreurValidation(t('validation:requis'));
      return;
    }
    retourner(
      { siteId, quantiteMillieme: quantite, motif },
      { onSuccess: () => onOuvertChange(false) },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pieces:comptoirVente.retour.titre')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{article.designation}</span>
            <span className="font-mono texte-libelle text-muted-foreground">
              {article.referencePrincipale}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="retour-quantite">{t('pieces:comptoirVente.retour.quantite')}</Label>
            <Input
              id="retour-quantite"
              type="text"
              inputMode="decimal"
              autoFocus
              readOnly={enCours}
              value={quantiteSaisie}
              onChange={(evenement) => setQuantiteSaisie(evenement.target.value)}
            />
            <span className="texte-libelle text-muted-foreground">
              {t('pieces:comptoirVente.vente.disponible', {
                n: formaterQuantiteMillieme(article.quantiteDisponibleMillieme),
              })}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="retour-motif">{t('pieces:comptoirVente.retour.motif')} *</Label>
            <Input
              id="retour-motif"
              readOnly={enCours}
              value={motif}
              onChange={(evenement) => setMotif(evenement.target.value)}
            />
          </div>

          {erreurValidation ? (
            <p className="texte-libelle text-statut-attention" role="alert">
              {erreurValidation}
            </p>
          ) : null}
          {erreur ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreur(erreur, t)}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOuvertChange(false)}
            disabled={enCours}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={enCours} onClick={soumettre}>
            {enCours ? t('commun:chargement.enCours') : t('pieces:comptoirVente.retour.confirmer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
