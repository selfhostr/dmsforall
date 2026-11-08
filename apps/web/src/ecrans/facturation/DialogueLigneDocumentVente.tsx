import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  TYPES_LIGNE_DOCUMENT_VENTE,
  type EntreeCreationLigneDocument,
  type RegimeTva,
  type ReponseLigneDocumentVente,
  type TypeLigneDocumentVente,
} from '@dfa/shared';

import { genererCleIdempotence } from '@/api/idempotence';
import { AideContextuelle } from '@/composants/AideContextuelle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { Slot } from '@radix-ui/react-slot';
import { PanneauLateral } from '@/composants/PanneauLateral';
import {
  useAjouterLigneDocument,
  useModifierLigneDocument,
} from '@/hooks/facturation/useLignesDocumentVente';

import { formaterMontant } from '@/lib/formats';
import { messagesErreurMutation } from './messages-erreur-mutation';

/**
 * `POST /documents-vente/{id}/lignes` et `PATCH /documents-vente/{id}/lignes/{ligneId}` — issue
 * #125 (« impossible d'ajouter une ligne à un document de vente, et un document vide peut être
 * émis »). Un SEUL composant pour ajouter ET modifier (mode déterminé par la présence de `ligne`,
 * même patron que `DialogueModifierIdentiteVehicule`), plutôt que deux dialogues quasi identiques
 * — le formulaire est rigoureusement le même, seule la mutation et le préremplissage diffèrent.
 *
 * Aligné, dans l'esprit, sur `ecrans/atelier/DialogueAjoutLigneOr.tsx` (vocabulaire des libellés,
 * disposition en deux colonnes, légende des champs obligatoires, bandeau d'erreur de mutation) —
 * PAS une réutilisation littérale : `TypeLigneDocumentVente` (12 valeurs utiles ici, `acompte_deduit`
 * exclu — voir plus bas) n'a rien de commun avec `TypeLigneOr`, et ce dialogue n'a ni recherche
 * catalogue (`SelecteurArticlePiece`, RP-43 — `articleId`/`siteId` restent délibérément omis, une
 * ligne saisie ici est TOUJOURS une saisie manuelle, jamais un pont stock) ni notion de payeur
 * (`payeur` n'existe pas sur `ligne_document`).
 *
 * PÉRIMÈTRE VOLONTAIREMENT RÉDUIT (même doctrine que `DialogueAjoutLigneOr`, additif au fil de
 * l'eau) :
 *  - `type = 'acompte_deduit'` EXCLU du sélecteur : ce type exige `documentAcompteId` (MD-55, la
 *    référence au document d'acompte dont la ligne déduit le montant) — aucun sélecteur de
 *    document n'existe encore dans cet écran pour le renseigner. Choisir ce type produirait une
 *    ligne structurellement invalide (refusée par `schemaCreationLigneDocument`, refine MD-55).
 *  - `articleId`/`siteId` (pont stock RP-43) jamais posés — une ligne `piece` saisie ici reste une
 *    saisie libre, elle ne réserve jamais de stock. Aucune régression : avant ce lot, AUCUNE ligne
 *    ne pouvait être ajoutée depuis cet écran.
 *  - `remisePourmille`/`remiseMontantCentimes` (remise DE LIGNE, distincte de la remise globale de
 *    pied de document déjà éditable sur `EcranFicheFacture`) omis — optionnels au contrat, une
 *    remise de ligne reste possible plus tard sans migration.
 *  - Taux de TVA : SÉLECTEUR FERMÉ sur les cinq régimes/taux 2026 documentés (`CONTRIBUTING.md` —
 *    normal 8.1%, réduit 2.6%, hébergement 3.8%, exonéré 0%, exclu du champ 0%), pas un champ
 *    numérique libre — un régime `marge` (véhicules d'occasion en marge, `RegimeTva`) reste hors
 *    de ce sélecteur, la ligne `ecart_reprise` dédiée aux reprises couvrant ce cas côté ventes.
 *    CONSÉQUENCE ASSUMÉE sur une ligne EXISTANTE dont le couple (regime, taux) ne correspond à
 *    AUCUN des cinq préréglages (ex. `marge`) : la rouvrir ici et l'enregistrer la NORMALISE vers
 *    le préréglage sélectionné par défaut (`normal`, 8.1%) — signalé, pas un cas couvert par la
 *    correction actuelle. Une ligne jamais rouverte dans ce dialogue n'est jamais affectée.
 */

interface Props {
  readonly documentId: string;
  /** `undefined` = mode AJOUT. Fournie = mode MODIFICATION, préremplit le formulaire. */
  readonly ligne?: ReponseLigneDocumentVente;
  /** Élément déclencheur (`asChild` sur `DialogTrigger`) — un bouton « Ajouter une ligne » en
   *  mode ajout, une icône crayon par ligne en mode modification. */
  readonly enfantDeclencheur: ReactNode;
}

const TYPES_PROPOSES: readonly TypeLigneDocumentVente[] = TYPES_LIGNE_DOCUMENT_VENTE.filter(
  (type) => type !== 'acompte_deduit',
);

interface OptionTaux {
  readonly regimeTva: RegimeTva;
  readonly tauxTvaPourmille: number;
}

type ClefTaux = 'normal' | 'reduit' | 'hebergement' | 'exonere' | 'exclu';

// Clés EXACTES (pas `Record<string, OptionTaux>`) : `etat.clefTaux` est typé `ClefTaux`, jamais
// `string` — l'accès `OPTIONS_TAUX[etat.clefTaux]` reste donc TOUJOURS défini pour le compilateur
// (`noUncheckedIndexedAccess` ne s'applique qu'aux types à index signature, pas à un type à clés
// closes), sans repli `?? OPTIONS_TAUX.normal` nécessaire. Seule la valeur brute d'un `Select`
// (`onValueChange`, typé `string` par Radix) exige encore une conversion explicite, posée à l'appel.
const OPTIONS_TAUX: Readonly<Record<ClefTaux, OptionTaux>> = {
  normal: { regimeTva: 'normal', tauxTvaPourmille: 81 },
  reduit: { regimeTva: 'reduit', tauxTvaPourmille: 26 },
  hebergement: { regimeTva: 'hebergement', tauxTvaPourmille: 38 },
  exonere: { regimeTva: 'exonere', tauxTvaPourmille: 0 },
  exclu: { regimeTva: 'exclu', tauxTvaPourmille: 0 },
};

const CLEFS_TAUX = Object.keys(OPTIONS_TAUX) as readonly ClefTaux[];

/** Clé de `OPTIONS_TAUX` la plus proche du couple (regime, taux) d'une ligne existante — retombe
 *  sur `'normal'` si aucun des cinq préréglages ne correspond exactement (voir la note « CONSÉQUENCE
 *  ASSUMÉE » de la docstring de tête). */
function clefTauxDepuisLigne(ligne: ReponseLigneDocumentVente | undefined): ClefTaux {
  if (!ligne) return 'normal';
  const trouvee = CLEFS_TAUX.find(
    (clef) =>
      OPTIONS_TAUX[clef].regimeTva === ligne.regimeTva &&
      OPTIONS_TAUX[clef].tauxTvaPourmille === ligne.tauxTvaPourmille,
  );
  return trouvee ?? 'normal';
}

/** "1.5" / "1,5" -> millièmes entiers. `null` si non interprétable ou non strictement positif —
 *  même doctrine que `DialogueAjoutLigneOr.analyserDecimalPositif`, dupliquée ici plutôt
 *  qu'importée (utilitaire local à un fichier, pas partagé entre les deux modules). */
function analyserQuantiteMillieme(saisie: string): number | null {
  const normalisee = saisie.trim().replace(',', '.');
  if (normalisee === '') return null;
  if (!/^\d+(\.\d+)?$/.test(normalisee)) return null;
  const valeur = Number.parseFloat(normalisee);
  if (!Number.isFinite(valeur) || valeur <= 0) return null;
  return Math.round(valeur * 1000);
}

function aujourdhuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface EtatFormulaire {
  readonly type: TypeLigneDocumentVente;
  readonly designation: string;
  readonly referenceTexte: string;
  readonly quantiteSaisie: string;
  readonly prixUnitaireCentimes: number | null;
  readonly clefTaux: ClefTaux;
  readonly datePrestation: string;
}

function etatDepuisLigne(ligne: ReponseLigneDocumentVente | undefined): EtatFormulaire {
  if (!ligne) {
    return {
      type: 'forfait',
      designation: '',
      referenceTexte: '',
      quantiteSaisie: '1',
      prixUnitaireCentimes: null,
      clefTaux: 'normal',
      datePrestation: aujourdhuiIso(),
    };
  }
  return {
    type: ligne.type,
    designation: ligne.designation,
    referenceTexte: ligne.referenceTexte ?? '',
    quantiteSaisie: (ligne.quantiteMillieme / 1000).toString(),
    prixUnitaireCentimes: ligne.prixUnitaireTtcCentimes ?? null,
    clefTaux: clefTauxDepuisLigne(ligne),
    datePrestation: ligne.datePrestation,
  };
}

export function DialogueLigneDocumentVente({ documentId, ligne, enfantDeclencheur }: Props) {
  const { t } = useTranslation(['facturation', 'commun', 'validation']);
  const modeModification = ligne !== undefined;
  const ajout = useAjouterLigneDocument();
  const modification = useModifierLigneDocument();
  const mutation = modeModification ? modification : ajout;

  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState<EtatFormulaire>(() => etatDepuisLigne(ligne));
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  const estTexte = etat.type === 'texte';

  function majEtat(partiel: Partial<EtatFormulaire>) {
    setEtat((precedent) => ({ ...precedent, ...partiel }));
  }

  function fermer() {
    setOuvert(false);
    setEtat(etatDepuisLigne(ligne));
    setErreurValidation(null);
    ajout.reset();
    modification.reset();
  }

  function soumettre() {
    if (etat.designation.trim() === '') {
      setErreurValidation(t('validation:requis'));
      return;
    }

    const quantiteMillieme = analyserQuantiteMillieme(etat.quantiteSaisie);
    if (quantiteMillieme === null) {
      setErreurValidation(t('validation:requis'));
      return;
    }

    if (!estTexte && etat.prixUnitaireCentimes === null) {
      setErreurValidation(t('validation:requis'));
      return;
    }

    const optionTaux = OPTIONS_TAUX[etat.clefTaux];

    const corps: EntreeCreationLigneDocument = {
      type: etat.type,
      designation: etat.designation.trim(),
      referenceTexte: etat.referenceTexte.trim() === '' ? null : etat.referenceTexte.trim(),
      articleId: null,
      siteId: null,
      quantiteMillieme,
      prixUnitaireTtcCentimes: estTexte ? null : etat.prixUnitaireCentimes,
      regimeTva: optionTaux.regimeTva,
      tauxTvaPourmille: optionTaux.tauxTvaPourmille,
      datePrestation: etat.datePrestation,
      documentAcompteId: null,
    };

    setErreurValidation(null);

    if (modeModification && ligne) {
      modification.mutate(
        { documentId, ligneId: ligne.id, entree: corps },
        { onSuccess: () => fermer() },
      );
    } else {
      ajout.mutate(
        { documentId, entree: corps, idempotencyKey: genererCleIdempotence() },
        { onSuccess: () => fermer() },
      );
    }
  }

  function gererSoumission(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    soumettre();
  }

  const titre = modeModification
    ? t('facturation:fiche.lignes.dialogueModifier.titre')
    : t('facturation:fiche.lignes.dialogueAjout.titre');

  return (
    <>
      <Slot onClick={() => setOuvert(true)}>{enfantDeclencheur}</Slot>
      <PanneauLateral
        ouvert={ouvert}
        onOuvertChange={(valeur) => (valeur ? setOuvert(true) : fermer())}
        titre={titre}
        pied={
          <>
            <Button type="button" variant="outline" onClick={fermer}>
              {t('commun:actions.annuler')}
            </Button>
            <Button
              type="submit"
              form="form-ligne-document-vente"
              enChargement={mutation.isPending}
            >
              {modeModification ? t('commun:actions.enregistrer') : t('commun:actions.confirmer')}
            </Button>
          </>
        }
      >
        <form
          id="form-ligne-document-vente"
          onSubmit={gererSoumission}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-4">
            <LegendeChampsObligatoires>
              {t('commun:formulaires.champsObligatoiresLegende')}
            </LegendeChampsObligatoires>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fdv-ligne-type" requis>
                  {t('facturation:fiche.lignes.champs.type')}
                </Label>
                <Select
                  value={etat.type}
                  onValueChange={(valeur) => majEtat({ type: valeur as TypeLigneDocumentVente })}
                >
                  <SelectTrigger
                    id="fdv-ligne-type"
                    aria-label={t('facturation:fiche.lignes.champs.type')}
                    aria-required="true"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES_PROPOSES.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`facturation:fiche.lignes.types.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fdv-ligne-taux" requis>
                  {t('facturation:fiche.lignes.champs.taux')}
                </Label>
                <Select
                  value={etat.clefTaux}
                  onValueChange={(valeur) => majEtat({ clefTaux: valeur as ClefTaux })}
                >
                  <SelectTrigger
                    id="fdv-ligne-taux"
                    aria-label={t('facturation:fiche.lignes.champs.taux')}
                    aria-required="true"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLEFS_TAUX.map((clef) => (
                      <SelectItem key={clef} value={clef}>
                        {t(`facturation:fiche.lignes.taux.${clef}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fdv-ligne-designation" requis>
                {t('facturation:fiche.lignes.champs.designation')}
              </Label>
              <Input
                id="fdv-ligne-designation"
                value={etat.designation}
                maxLength={200}
                required
                onChange={(evenement) => majEtat({ designation: evenement.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fdv-ligne-reference">
                {t('facturation:fiche.lignes.champs.reference')}
              </Label>
              <Input
                id="fdv-ligne-reference"
                value={etat.referenceTexte}
                maxLength={80}
                onChange={(evenement) => majEtat({ referenceTexte: evenement.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fdv-ligne-quantite" requis>
                  {t('facturation:fiche.lignes.champs.quantite')}
                </Label>
                <Input
                  id="fdv-ligne-quantite"
                  type="text"
                  inputMode="decimal"
                  value={etat.quantiteSaisie}
                  onChange={(evenement) => majEtat({ quantiteSaisie: evenement.target.value })}
                />
              </div>
              <ChampMontant
                id="fdv-ligne-prix"
                valeurCentimes={etat.prixUnitaireCentimes}
                onChangeCentimes={(centimes) => majEtat({ prixUnitaireCentimes: centimes })}
                label={t('facturation:fiche.lignes.champs.prixUnitaire')}
                aide={
                  <AideContextuelle
                    sujet={t('facturation:fiche.lignes.champs.prixUnitaire')}
                    texte={t('facturation:fiche.lignes.champs.prixUnitaireAide', {
                  ht:
                    etat.prixUnitaireCentimes === null
                      ? '—'
                      : formaterMontant(
                          Math.round(
                            (etat.prixUnitaireCentimes * 1000) /
                              (1000 + OPTIONS_TAUX[etat.clefTaux].tauxTvaPourmille),
                          ),
                        ),
                })}
                  />
                }
                obligatoire={!estTexte}
                disabled={estTexte}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fdv-ligne-date" requis>
                {t('facturation:fiche.lignes.champs.datePrestation')}
              </Label>
              <Input
                id="fdv-ligne-date"
                type="date"
                value={etat.datePrestation}
                required
                onChange={(evenement) => majEtat({ datePrestation: evenement.target.value })}
              />
            </div>

            {erreurValidation ? (
              <p className="texte-libelle text-destructive">{erreurValidation}</p>
            ) : null}
            {mutation.isError
              ? messagesErreurMutation(mutation.error, t).map((message, index) => (
                  <p key={index} role="alert" className="texte-libelle text-destructive">
                    {message}
                  </p>
                ))
              : null}
          </div>
        </form>
      </PanneauLateral>
    </>
  );
}
