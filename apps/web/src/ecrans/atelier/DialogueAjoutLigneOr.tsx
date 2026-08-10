import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import {
  ORIGINES_LIGNE_OR,
  TYPES_LIGNE_OR,
  schemaCreationLigneOr,
  type OrigineLigneOr,
  type PayeurLigneOr,
  type TypeLigneOr,
} from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { useCreerLigneOr } from '@/hooks/atelier/useActionsLigneOr';

import { messagesErreurMutation } from './messages-erreur-mutation';
import { CLES_TYPE } from './ListeLignesOrdreReparation';

interface Props {
  readonly orId: string;
}

const TYPES_MAIN_OEUVRE: ReadonlySet<TypeLigneOr> = new Set([
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
]);

/** "1.5" / "1,5" -> entier mis à l'échelle (`multiplicateur` = 1000 pour une quantité en
 *  millièmes, 100 pour un temps en centièmes d'heure) ; `null` si non interprétable OU non
 *  strictement positif — même doctrine que `ChampMontant.analyserCentimes` : jamais de valeur
 *  devinée pour une saisie invalide, l'appelant doit la refuser plutôt que la corriger en douce. */
function analyserDecimalPositif(saisie: string, multiplicateur: number): number | null {
  const normalisee = saisie.trim().replace(',', '.');
  if (normalisee === '') return null;
  if (!/^\d+(\.\d+)?$/.test(normalisee)) return null;
  const valeur = Number.parseFloat(normalisee);
  if (!Number.isFinite(valeur) || valeur <= 0) return null;
  return Math.round(valeur * multiplicateur);
}

interface EtatFormulaire {
  readonly type: TypeLigneOr;
  readonly origine: OrigineLigneOr;
  readonly designation: string;
  readonly referenceTexte: string;
  readonly quantiteSaisie: string;
  readonly tempsBaremeSaisie: string;
  readonly prixUnitaireCentimes: number | null;
  readonly payeur: PayeurLigneOr;
  readonly securite: boolean;
  readonly fournieParClient: boolean;
  readonly pieceARestituer: boolean;
}

const ETAT_INITIAL: EtatFormulaire = {
  type: 'main_oeuvre_bareme',
  origine: 'commandee',
  designation: '',
  referenceTexte: '',
  quantiteSaisie: '1',
  tempsBaremeSaisie: '',
  prixUnitaireCentimes: null,
  payeur: 'client',
  securite: false,
  fournieParClient: false,
  pieceARestituer: false,
};

/**
 * `POST /ordres-reparation/{orId}/lignes` (§7.8) — saisie manuelle d'une ligne de travail ou de
 * pièce. Monté UNIQUEMENT derrière `peutCreerLigneOr(role)` (`ecrans/atelier/droits.ts`) par
 * l'appelant (`EcranFicheOrdreReparation`) : ce composant ne revérifie donc pas le droit dans son
 * JSX — même doctrine que `PanneauActionsOr`, qui ne revérifie pas non plus `or.actionsDisponibles`
 * une fois le bouton affiché. Le serveur reste l'arbitre final (`@ExigerDroit('atelier.ligne.creer')`).
 *
 * PÉRIMÈTRE VOLONTAIREMENT RÉDUIT pour ce correctif (débloquer la chaîne OR -> facturation),
 * additif à étendre au fil de l'eau :
 *  - `payeur` limité à `client`/`garage` — `constructeur`/`assurance`/`tiers` exigent un
 *    sélecteur de tiers payeur (`payeurClientId`, AC-08/MD-62) qui n'existe encore dans aucun
 *    écran ;
 *  - aucun lien catalogue (`articleId`) — une ligne « pièce » saisie ici est LIBRE (désignation et
 *    prix tapés à la main, aucune réservation de stock) ; le catalogue vit derrière
 *    `POST …/lignes-depuis-prestation`, hors périmètre ;
 *  - aucune affectation de technicien à la création (`technicienId`).
 * Aucun de ces trois manques ne bloque la chaîne devis -> facture que ce correctif rouvre.
 */
export function DialogueAjoutLigneOr({ orId }: Props) {
  const { t } = useTranslation(['or', 'commun', 'validation']);
  const mutation = useCreerLigneOr(orId);
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState<EtatFormulaire>(ETAT_INITIAL);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  const estMainOeuvre = TYPES_MAIN_OEUVRE.has(etat.type);
  const erreurActive = mutation.error instanceof ErreurApi ? mutation.error : null;

  function fermer() {
    setOuvert(false);
    setEtat(ETAT_INITIAL);
    setErreurValidation(null);
    mutation.reset();
  }

  function majEtat(partiel: Partial<EtatFormulaire>) {
    setEtat((precedent) => ({ ...precedent, ...partiel }));
  }

  function soumettre() {
    if (etat.designation.trim() === '') {
      setErreurValidation(t('validation:requis'));
      return;
    }

    let quantiteMillieme = 1000;
    if (!estMainOeuvre) {
      const analysee = analyserDecimalPositif(etat.quantiteSaisie, 1000);
      if (analysee === null) {
        setErreurValidation(t('validation:requis'));
        return;
      }
      quantiteMillieme = analysee;
    }

    let tempsBaremeCentiemes: number | undefined;
    if (estMainOeuvre && etat.tempsBaremeSaisie.trim() !== '') {
      const analysee = analyserDecimalPositif(etat.tempsBaremeSaisie, 100);
      if (analysee === null) {
        setErreurValidation(t('validation:requis'));
        return;
      }
      tempsBaremeCentiemes = analysee;
    }

    // Type d'ENTRÉE (`z.input`), pas `EntreeCreationLigneOr` (`z.infer`, type de SORTIE) : `blocage`
    // porte un `.default('aucun')` dans `schemaCreationLigneOr` — absent ici, il est résolu par
    // `safeParse` juste en dessous, jamais deviné à la main dans ce composant.
    const entree: z.input<typeof schemaCreationLigneOr> = {
      type: etat.type,
      origine: etat.origine,
      designation: etat.designation.trim(),
      referenceTexte: etat.referenceTexte.trim() === '' ? undefined : etat.referenceTexte.trim(),
      quantiteMillieme,
      tempsBaremeCentiemes,
      prixUnitaireCentimes: estMainOeuvre ? undefined : (etat.prixUnitaireCentimes ?? undefined),
      rabaisPourmille: 0,
      payeur: etat.payeur,
      securite: etat.securite,
      fournieParClient: etat.type === 'piece' ? etat.fournieParClient : false,
      pieceARestituer: etat.type === 'piece' ? etat.pieceARestituer : false,
    };

    const resultat = schemaCreationLigneOr.safeParse(entree);
    if (!resultat.success) {
      setErreurValidation(t('validation:requis'));
      return;
    }
    setErreurValidation(null);
    mutation.mutate(
      { entree: resultat.data, idempotencyKey: genererCleIdempotence() },
      { onSuccess: () => fermer() },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => (valeur ? setOuvert(true) : fermer())}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t('or:lignes.ajouter')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('or:lignes.ajouter')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-ligne-type">{t('or:lignes.colonnes.type')}</Label>
              <Select
                value={etat.type}
                onValueChange={(valeur) => majEtat({ type: valeur as TypeLigneOr })}
              >
                <SelectTrigger id="or-ligne-type" aria-label={t('or:lignes.colonnes.type')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES_LIGNE_OR.map((valeur) => (
                    <SelectItem key={valeur} value={valeur}>
                      {t(`or:lignes.types.${CLES_TYPE[valeur]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-ligne-origine">{t('or:lignes.colonnes.origine')}</Label>
              <Select
                value={etat.origine}
                onValueChange={(valeur) => majEtat({ origine: valeur as OrigineLigneOr })}
              >
                <SelectTrigger id="or-ligne-origine" aria-label={t('or:lignes.colonnes.origine')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIGINES_LIGNE_OR.map((valeur) => (
                    <SelectItem key={valeur} value={valeur}>
                      {t(`or:lignes.origines.${valeur}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="or-ligne-designation">{t('or:lignes.colonnes.designation')} *</Label>
            <Input
              id="or-ligne-designation"
              value={etat.designation}
              maxLength={200}
              onChange={(evenement) => majEtat({ designation: evenement.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="or-ligne-reference">{t('or:lignes.champs.referenceTexte')}</Label>
            <Input
              id="or-ligne-reference"
              value={etat.referenceTexte}
              maxLength={80}
              onChange={(evenement) => majEtat({ referenceTexte: evenement.target.value })}
            />
          </div>

          {estMainOeuvre ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-ligne-temps">{t('or:lignes.colonnes.tempsBareme')}</Label>
              <Input
                id="or-ligne-temps"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={etat.tempsBaremeSaisie}
                onChange={(evenement) => majEtat({ tempsBaremeSaisie: evenement.target.value })}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-ligne-quantite">{t('or:lignes.colonnes.quantite')}</Label>
                <Input
                  id="or-ligne-quantite"
                  type="text"
                  inputMode="decimal"
                  value={etat.quantiteSaisie}
                  onChange={(evenement) => majEtat({ quantiteSaisie: evenement.target.value })}
                />
              </div>
              <ChampMontant
                id="or-ligne-prix"
                valeurCentimes={etat.prixUnitaireCentimes}
                onChangeCentimes={(centimes) => majEtat({ prixUnitaireCentimes: centimes })}
                label={t('or:lignes.colonnes.prixUnitaire')}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="or-ligne-payeur">{t('or:lignes.colonnes.payeur')}</Label>
            <Select
              value={etat.payeur}
              onValueChange={(valeur) => majEtat({ payeur: valeur as PayeurLigneOr })}
            >
              <SelectTrigger id="or-ligne-payeur" aria-label={t('or:lignes.colonnes.payeur')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">{t('or:lignes.payeurs.client')}</SelectItem>
                <SelectItem value="garage">{t('or:lignes.payeurs.garage')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label htmlFor="or-ligne-securite" className="flex items-center gap-2 texte-corps">
            <Checkbox
              id="or-ligne-securite"
              checked={etat.securite}
              onCheckedChange={(coche) => majEtat({ securite: coche === true })}
            />
            {t('or:lignes.marqueurs.securite')}
          </label>

          {etat.type === 'piece' ? (
            <>
              <label
                htmlFor="or-ligne-fournie-client"
                className="flex items-center gap-2 texte-corps"
              >
                <Checkbox
                  id="or-ligne-fournie-client"
                  checked={etat.fournieParClient}
                  onCheckedChange={(coche) => majEtat({ fournieParClient: coche === true })}
                />
                {t('or:lignes.marqueurs.fournieParClient')}
              </label>
              <label htmlFor="or-ligne-a-restituer" className="flex items-center gap-2 texte-corps">
                <Checkbox
                  id="or-ligne-a-restituer"
                  checked={etat.pieceARestituer}
                  onCheckedChange={(coche) => majEtat({ pieceARestituer: coche === true })}
                />
                {t('or:lignes.marqueurs.pieceARestituer')}
              </label>
            </>
          ) : null}

          {erreurValidation ? (
            <p className="texte-libelle text-destructive">{erreurValidation}</p>
          ) : null}
          {erreurActive
            ? messagesErreurMutation(erreurActive, t).map((message, index) => (
                <p key={index} role="alert" className="texte-libelle text-destructive">
                  {message}
                </p>
              ))
            : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('commun:actions.annuler')}</Button>
          </DialogClose>
          <Button disabled={mutation.isPending} onClick={soumettre}>
            {t('or:actions.confirmer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
