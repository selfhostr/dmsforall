import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  schemaCorrectionFacture,
  type ModeCorrectionFacture,
  type MotifAvoir,
  type ReponseDocumentVente,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { useCorrigerFacture } from '@/hooks/facturation/useCorrigerFacture';

/**
 * Motifs proposés selon le choix du garagiste. « Corriger l'adresse seulement » (mode
 * `remplacement`) ne porte QUE sur l'adresse ou le destinataire : `champsCorriges` du contrat ne
 * connaît pas d'autre champ. « Refaire la facture » (mode `brouillon`) recrée les mêmes lignes en
 * brouillon libre, donc tous les motifs de correction TOTALE de `MOTIFS_AVOIR` (`RF-15`) ont un
 * sens ; `prestation_annulee` et `geste_commercial` restent réservés à l'écran Avoir (§4.7).
 */
const MOTIFS_PAR_MODE: Record<ModeCorrectionFacture, readonly MotifAvoir[]> = {
  remplacement: ['erreur_adresse', 'erreur_destinataire'],
  brouillon: ['erreur_montant', 'erreur_taux', 'erreur_adresse', 'erreur_destinataire', 'autre'],
};

const MOTIF_PAR_DEFAUT: Record<ModeCorrectionFacture, MotifAvoir> = {
  remplacement: 'erreur_adresse',
  brouillon: 'erreur_montant',
};

/** Motifs pour lesquels le mode `remplacement` porte réellement un champ à corriger. */
const MOTIFS_AVEC_CHAMP_ADRESSE: ReadonlySet<MotifAvoir> = new Set([
  'erreur_adresse',
  'erreur_destinataire',
]);

interface Props {
  readonly facture: ReponseDocumentVente;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly onSucces: (
    numeroAvoir: string | null,
    numeroNouvelleFacture: string | null,
    idNouvelleFacture: string,
  ) => void;
}

/**
 * `DialogueCorrectionFacture` (§4.7, risque n°1 du design) — UN SEUL composant, jamais deux
 * appelés séparément par l'écran parent, pour que le texte d'explication et la case « corriger la
 * fiche client » ne divergent jamais entre les branches.
 *
 * Deux gestes, un seul endpoint (`POST /documents-vente/{id}/corriger`, champ `mode`) :
 *  - « Corriger l'adresse seulement » (`remplacement`) : avoir total + facture corrigée ÉMISE tout
 *    de suite, uniquement adresse/destinataire ;
 *  - « Refaire la facture » (`brouillon`) : avoir total + NOUVEAU BROUILLON pré-rempli (mêmes
 *    lignes, TVA au régime actuel du garage), ouvert à l'écran pour être modifié librement puis
 *    émis. Refusé par le serveur si la facture porte déjà un règlement : l'option est alors
 *    désactivée avec sa raison, sans attendre le refus.
 */
export function DialogueCorrectionFacture({ facture, ouvert, onOuvertChange, onSucces }: Props) {
  const { t } = useTranslation(['facturation', 'commun', 'erreurs', 'validation']);
  const correction = useCorrigerFacture();

  const [mode, setMode] = useState<ModeCorrectionFacture>('remplacement');
  const [motif, setMotif] = useState<MotifAvoir>('erreur_adresse');
  const [motifAutre, setMotifAutre] = useState('');
  const [rue, setRue] = useState('');
  const [numero, setNumero] = useState('');
  const [npa, setNpa] = useState('');
  const [localite, setLocalite] = useState('');
  const [clientDesignation, setClientDesignation] = useState('');
  const [corrigerFiche, setCorrigerFiche] = useState(true);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    setMode('remplacement');
    setMotif('erreur_adresse');
    setMotifAutre('');
    setRue(facture.figees.adresseFacturation?.rue ?? '');
    setNumero(facture.figees.adresseFacturation?.numero ?? '');
    setNpa(facture.figees.adresseFacturation?.npa ?? '');
    setLocalite(facture.figees.adresseFacturation?.localite ?? '');
    setClientDesignation(facture.figees.clientDesignation);
    setCorrigerFiche(true);
    setErreurValidation(null);
    // Générée à l'ouverture du dialogue, pas au clic sur « Corriger la facture » (même règle que
    // l'émission, §4.5/§4.7, `RF-25`).
    setIdempotencyKey(genererCleIdempotence());
  }, [ouvert, facture]);

  const dejaRegle = (facture.montantRegleCentimes ?? 0) > 0;
  const modeBrouillon = mode === 'brouillon';
  // Le formulaire d'adresse n'existe qu'en mode `remplacement` : en mode brouillon, la facture se
  // corrige ensuite dans le brouillon lui-même (adresse comprise, via la fiche client).
  const brancheAdresse = !modeBrouillon && MOTIFS_AVEC_CHAMP_ADRESSE.has(motif);

  function changerMode(nouveau: ModeCorrectionFacture) {
    setMode(nouveau);
    setMotif(MOTIF_PAR_DEFAUT[nouveau]);
    setErreurValidation(null);
  }

  function soumettre() {
    setErreurValidation(null);
    if (!idempotencyKey) return;

    const champsCorriges = brancheAdresse
      ? {
          clientDesignation: motif === 'erreur_destinataire' ? clientDesignation.trim() : undefined,
          adresseFacturation: {
            rue: rue.trim(),
            numero: numero.trim() === '' ? null : numero.trim(),
            npa: npa.trim(),
            localite: localite.trim(),
            pays: facture.figees.adresseFacturation?.pays ?? 'CH',
          },
        }
      : undefined;

    const resultat = schemaCorrectionFacture.safeParse({
      mode,
      motif,
      motifAutre: motif === 'autre' ? motifAutre.trim() : undefined,
      ...(modeBrouillon ? {} : { corrigerFicheClient: corrigerFiche, champsCorriges }),
    });
    if (!resultat.success) {
      setErreurValidation(t('validation:requis'));
      return;
    }

    correction.mutate(
      { factureId: facture.id, entree: resultat.data, idempotencyKey },
      {
        onSuccess: (reponse) => {
          onSucces(
            reponse.donnees.avoir.numero,
            reponse.donnees.factureRemplacement.numero,
            reponse.donnees.factureRemplacement.id,
          );
          onOuvertChange(false);
        },
      },
    );
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={t('facturation:fiche.correction.titre', { numero: facture.numero ?? '' })}
      pied={
        <>
          <Button type="button" variant="outline" onClick={() => onOuvertChange(false)}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="submit" form="form-correction-facture" disabled={correction.isPending}>
            {correction.isPending
              ? t('facturation:fiche.correction.enCours')
              : modeBrouillon
                ? t('facturation:fiche.correction.confirmerBrouillon')
                : t('facturation:fiche.correction.confirmer')}
          </Button>
        </>
      }
    >
      <form
        id="form-correction-facture"
        className="flex flex-col gap-4"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          soumettre();
        }}
      >
        <p className="texte-corps text-muted-foreground">
          {t('facturation:fiche.correction.explication')}
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="texte-libelle font-medium">
            {t('facturation:fiche.correction.choix.legende')}
          </legend>
          {(['remplacement', 'brouillon'] as const).map((valeur) => {
            const desactive = valeur === 'brouillon' && dejaRegle;
            return (
              <label
                key={valeur}
                className="flex min-h-11 items-start gap-2 texte-corps has-[:disabled]:text-muted-foreground"
              >
                <input
                  type="radio"
                  name="correction-mode"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--marque)]"
                  checked={mode === valeur}
                  disabled={desactive}
                  onChange={() => changerMode(valeur)}
                />
                <span className="flex flex-col">
                  <span className="font-medium">
                    {t(`facturation:fiche.correction.choix.${valeur}.titre`)}
                  </span>
                  <span className="texte-libelle text-muted-foreground">
                    {desactive
                      ? t('facturation:fiche.correction.choix.brouillon.dejaRegle')
                      : t(`facturation:fiche.correction.choix.${valeur}.aide`)}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correction-motif">{t('facturation:motifsAvoir.champ')}</Label>
          <Select
            value={motif}
            onValueChange={(valeur) => {
              // Radix émet '' quand l'option sélectionnée disparaît (changement de mode) : on l'ignore.
              if (valeur !== '') setMotif(valeur as MotifAvoir);
            }}
          >
            <SelectTrigger id="correction-motif">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOTIFS_PAR_MODE[mode].map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`facturation:motifsAvoir.${toCleCamel(valeur)}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {motif === 'autre' ? (
          <Textarea
            aria-label={t('facturation:motifsAvoir.autre')}
            placeholder={t('facturation:motifsAvoir.autrePlaceholder')}
            value={motifAutre}
            onChange={(evenement) => setMotifAutre(evenement.target.value)}
          />
        ) : null}

        {brancheAdresse ? (
          <div className="grid grid-cols-2 gap-3">
            {motif === 'erreur_destinataire' ? (
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="correction-destinataire">
                  {t('facturation:champs.destinataire')}
                </Label>
                <Input
                  id="correction-destinataire"
                  value={clientDesignation}
                  onChange={(e) => setClientDesignation(e.target.value)}
                />
              </div>
            ) : null}
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="correction-rue">
                {t('facturation:fiche.correction.adresse.rue')}
              </Label>
              <Input id="correction-rue" value={rue} onChange={(e) => setRue(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="correction-npa">
                {t('facturation:fiche.correction.adresse.npa')}
              </Label>
              <Input id="correction-npa" value={npa} onChange={(e) => setNpa(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="correction-localite">
                {t('facturation:fiche.correction.adresse.localite')}
              </Label>
              <Input
                id="correction-localite"
                value={localite}
                onChange={(e) => setLocalite(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {brancheAdresse ? (
          <label htmlFor="facture-corriger-fiche" className="flex items-center gap-2 texte-corps">
            <Checkbox
              id="facture-corriger-fiche"
              checked={corrigerFiche}
              onCheckedChange={(coche) => setCorrigerFiche(coche === true)}
            />
            {t('facturation:fiche.correction.corrigerFiche')}
          </label>
        ) : null}

        {erreurValidation ? (
          <p className="texte-libelle text-destructive">{erreurValidation}</p>
        ) : null}
        {correction.isError ? (
          <p className="texte-libelle text-destructive">{messageErreur(correction.error, t)}</p>
        ) : null}
      </form>
    </PanneauLateral>
  );
}

function toCleCamel(motif: MotifAvoir): string {
  return motif.replace(/_([a-z])/g, (_match, lettre: string) => lettre.toUpperCase());
}
