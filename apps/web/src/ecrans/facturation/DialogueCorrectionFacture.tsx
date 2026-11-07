import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { schemaCorrectionFacture, type MotifAvoir, type ReponseDocumentVente } from '@dfa/shared';

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
 * Motifs de correction TOTALE proposés ici — 5 des 7 valeurs de `MOTIFS_AVOIR` (`RF-15`).
 * `prestation_annulee` et `geste_commercial` ne figurent JAMAIS dans ce select (§4.7 du design) :
 * ces deux motifs redirigent vers l'écran Avoir général (§6), qui ne recrée pas de facture de
 * remplacement.
 */
const MOTIFS_CORRECTION_TOTALE = [
  'erreur_adresse',
  'erreur_destinataire',
  'erreur_montant',
  'erreur_taux',
  'autre',
] as const;

/** Motifs pour lesquels `POST .../corriger` porte réellement un champ à corriger
 *  (`schemaCorrectionFacture.champsCorriges` ne connaît QUE `clientDesignation` et
 *  `adresseFacturation` — voir l'ÉCART SIGNALÉ ci-dessous). */
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
 * ÉCART SIGNALÉ, à résoudre avant que la branche montant/taux du design (§4.7 : « la Sheet de
 * lignes éditables ») puisse être construite : `schemaCorrectionFacture.champsCorriges`
 * (`packages/shared/src/contrats/facturation/document.ts`) n'accepte QUE `clientDesignation` et
 * `adresseFacturation` — aucun champ ne permet de corriger un montant ou un taux de ligne par cet
 * endpoint. Le design suppose une Sheet de lignes éditables qui n'a donc, à ce jour, RIEN à
 * soumettre. Plutôt que de construire un formulaire qui ne peut aboutir, ce dialogue redirige
 * explicitement `erreur_montant`/`erreur_taux` vers l'écran Avoir (§6, pleinement fonctionnel pour
 * une correction de montant) — la bascule Dialog/Sheet du design reste donc à implémenter le jour
 * où le contrat gagne ce champ.
 */
export function DialogueCorrectionFacture({ facture, ouvert, onOuvertChange, onSucces }: Props) {
  const { t } = useTranslation(['facturation', 'commun', 'erreurs', 'validation']);
  const navigate = useNavigate();
  const correction = useCorrigerFacture();

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

  const brancheAdresse = MOTIFS_AVEC_CHAMP_ADRESSE.has(motif);
  const brancheMontantTaux = motif === 'erreur_montant' || motif === 'erreur_taux';

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
      motif,
      motifAutre: motif === 'autre' ? motifAutre.trim() : undefined,
      corrigerFicheClient: corrigerFiche,
      champsCorriges,
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
          {brancheAdresse ? (
            <Button type="submit" form="form-correction-facture" disabled={correction.isPending}>
              {correction.isPending
                ? t('facturation:fiche.correction.enCours')
                : t('facturation:fiche.correction.confirmer')}
            </Button>
          ) : null}
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correction-motif">{t('facturation:motifsAvoir.champ')}</Label>
          <Select value={motif} onValueChange={(valeur) => setMotif(valeur as MotifAvoir)}>
            <SelectTrigger id="correction-motif">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOTIFS_CORRECTION_TOTALE.map((valeur) => (
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

        {brancheMontantTaux ? (
          // DESIGN.md « bordure structurelle » — conservée : encart d'alerte avec sa propre
          // action (« Créer un avoir »), pas un simple regroupement de texte.
          <div className="flex flex-col gap-2 rounded-md border border-statut-info bg-statut-info-fond p-3">
            <p className="texte-corps">{t('facturation:fiche.correction.motifMontantTaux')}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOuvertChange(false);
                navigate(`/factures/${facture.id}/avoir`);
              }}
            >
              {t('facturation:fiche.actions.menu.creerAvoir')}
            </Button>
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
