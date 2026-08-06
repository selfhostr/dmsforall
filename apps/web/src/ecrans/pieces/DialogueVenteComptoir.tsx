import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ResultatRechercheComptoirArticle } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { useVenteComptoir } from '@/hooks/pieces/useVenteComptoirPieces';
import { formaterMontant } from '@/lib/formats';

import { formaterQuantiteMillieme, saisieVersQuantiteMillieme } from './utils';

/** 1 unité — la vente d'une seule pièce est de très loin le cas majoritaire au comptoir : la
 *  quantité arrive déjà juste, il ne reste que le clic de confirmation. */
const QUANTITE_PAR_DEFAUT = '1';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly siteId: string;
  /**
   * Ligne de résultat LIVE — l'écran appelant la retrouve par id dans `resultats` à CHAQUE rendu,
   * jamais un instantané figé à l'ouverture du dialogue. C'est ce qui permet à
   * `quantiteDisponibleMillieme` de se corriger tout seul après un refus pour stock insuffisant :
   * l'invalidation posée par `useCreerMouvementSortieComptoir` (`onError` y compris) déclenche un
   * refetch de la recherche comptoir, l'écran appelant re-rend avec la ligne à jour, ce composant
   * la reçoit en prop sans rien faire de spécial.
   */
  readonly article: ResultatRechercheComptoirArticle | null;
}

/**
 * Sortie comptoir (`POST /articles/{id}/mouvements/sortie-comptoir`) — vend une pièce SANS
 * document de vente, en sort le stock, ne facture RIEN.
 *
 * ARBITRAGE (brief) : ce chemin reste volontairement ouvert (dépannage, geste commercial — voir
 * la note d'intégration en fin de `contrats/pieces/mouvement.ts`), mais ne doit pas devenir le
 * chemin par défaut par simple commodité d'écran. Deux choix delibérés pour orienter vers le
 * chemin FACTURÉ (une ligne `piece` de document de vente, qui sort le stock ET facture en un seul
 * geste) sans pour autant bloquer ce raccourci :
 *  1. Le libellé du bouton déclencheur (`comptoirVente.actions.vendre`, dans l'écran appelant) et
 *     le titre de ce dialogue nomment explicitement « sans facture » — jamais un « Vendre » nu
 *     qui laisserait croire à une vente normale.
 *  2. Un avis permanent (`Alert variant="avertissement"`, jamais masquable) rappelle QUAND
 *     l'utiliser et renvoie vers le document de vente pour le cas normal — ce dialogue ne propose
 *     aucun lien de navigation vers la facturation (hors périmètre de cet écran, et l'écran de
 *     documents de vente n'expose aujourd'hui aucun pré-remplissage par article/site à cibler).
 */
export function DialogueVenteComptoir({ ouvert, onOuvertChange, siteId, article }: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs', 'validation']);
  const { enCours, erreur, vendre } = useVenteComptoir(article?.articleId ?? '');

  const [quantiteSaisie, setQuantiteSaisie] = useState(QUANTITE_PAR_DEFAUT);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    setQuantiteSaisie(QUANTITE_PAR_DEFAUT);
    setErreurValidation(null);
  }, [ouvert, article?.articleId]);

  // L'article a disparu des résultats courants (recherche changée entre-temps) pendant que le
  // dialogue était ouvert : rien à vendre, on referme plutôt que d'afficher un formulaire orphelin.
  useEffect(() => {
    if (ouvert && !article) onOuvertChange(false);
  }, [ouvert, article, onOuvertChange]);

  if (!article) return null;

  const disponible = article.quantiteDisponibleMillieme;
  const stockInsuffisant =
    erreur instanceof ErreurApi && erreur.probleme.code === 'STOCK_INSUFFISANT';

  // DÉFAUT CORRIGÉ (rapport de test du 06.08.2026, n°3) : le montant affiché ne suivait pas la
  // quantité — c'était le PRIX UNITAIRE (`article.prixVenteTtcCentimes`), figé, sous un libellé
  // « TTC » qui laissait croire à un total. Recalculé ICI à chaque frappe (pas seulement à la
  // confirmation) : `quantiteInterpretee` réutilise `saisieVersQuantiteMillieme`, la même fonction
  // que `soumettre()`, pour qu'un magasinier voie EXACTEMENT le montant qui sera soumis. Centimes
  // entiers uniquement (RM-01) : `Math.round` sur `prix * quantiteMillieme / 1000`, jamais de
  // flottant intermédiaire conservé au-delà de ce calcul.
  const quantiteInterpretee = saisieVersQuantiteMillieme(quantiteSaisie);
  const totalTtcCentimes =
    quantiteInterpretee !== null
      ? Math.round((article.prixVenteTtcCentimes * quantiteInterpretee) / 1000)
      : null;

  function soumettre() {
    setErreurValidation(null);
    const quantite = saisieVersQuantiteMillieme(quantiteSaisie);
    if (quantite === null) {
      setErreurValidation(t('validation:requis'));
      return;
    }
    // Refus compréhensible AVANT tout aller-retour serveur, avec le chiffre exact — la très
    // grande majorité des refus stock insuffisant sont évitables ici : `disponible` vient de la
    // dernière recherche, presque toujours à jour.
    if (quantite > disponible) {
      setErreurValidation(
        t('pieces:comptoirVente.vente.erreur.stockInsuffisant', {
          n: formaterQuantiteMillieme(disponible),
        }),
      );
      return;
    }
    vendre({ siteId, quantiteMillieme: quantite }, { onSuccess: () => onOuvertChange(false) });
  }

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pieces:comptoirVente.vente.titre')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{article.designation}</span>
            <span className="font-mono texte-libelle text-muted-foreground">
              {article.referencePrincipale}
            </span>
          </div>

          <Alert variant="avertissement">
            <AlertDescription>{t('pieces:comptoirVente.vente.avisSansFacture')}</AlertDescription>
          </Alert>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vente-quantite">{t('pieces:comptoirVente.vente.quantite')}</Label>
            <Input
              id="vente-quantite"
              type="text"
              inputMode="decimal"
              autoFocus
              readOnly={enCours}
              value={quantiteSaisie}
              onChange={(evenement) => setQuantiteSaisie(evenement.target.value)}
            />
            <span className="texte-libelle text-muted-foreground">
              {t('pieces:comptoirVente.vente.disponible', {
                n: formaterQuantiteMillieme(disponible),
              })}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between texte-libelle text-muted-foreground">
              <span>{t('pieces:comptoirVente.vente.prixUnitaire')}</span>
              <span className="tabular-nums">{formaterMontant(article.prixVenteTtcCentimes)}</span>
            </div>
            <div className="flex items-center justify-between texte-corps">
              <span className="text-muted-foreground">
                {t('pieces:comptoirVente.vente.totalTtc')}
              </span>
              <span className="tabular-nums font-medium">
                {totalTtcCentimes !== null ? formaterMontant(totalTtcCentimes) : '—'}
              </span>
            </div>
          </div>

          {erreurValidation ? (
            <p className="texte-libelle text-statut-attention" role="alert">
              {erreurValidation}
            </p>
          ) : null}
          {erreur && stockInsuffisant ? (
            // Un refus stock insuffisant est une règle métier NORMALE, pas une panne — jamais le
            // ton/la couleur d'une erreur (`text-destructive`), même traitement que
            // l'`erreurValidation` locale juste au-dessus (même refus, chemin serveur plutôt que
            // pré-contrôle client).
            <p className="texte-libelle text-statut-attention" role="alert">
              {t('pieces:comptoirVente.vente.erreur.stockInsuffisant', {
                n: formaterQuantiteMillieme(disponible),
              })}
            </p>
          ) : null}
          {erreur && !stockInsuffisant ? (
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
            {enCours ? t('commun:chargement.enCours') : t('pieces:comptoirVente.vente.confirmer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
