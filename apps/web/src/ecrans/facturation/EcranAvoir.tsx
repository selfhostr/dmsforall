import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { MOTIFS_AVOIR, schemaCreationAvoir, type MotifAvoir } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
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
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { useCreerAvoir } from '@/hooks/facturation/useCreerAvoir';
import { useDocumentVente } from '@/hooks/facturation/useDocumentVente';
import { useEmettreDocumentVente } from '@/hooks/facturation/useEmettreDocumentVente';
import { formaterMontant, formaterMontantAvecDevise } from '@/lib/formats';

/** Suffixe camelCase de `facturation:motifsAvoir.*` — snake_case (`prestation_annulee`) vers
 *  camelCase (`prestationAnnulee`), même mapping que `DialogueCorrectionFacture`. */
function cleMotif(motif: MotifAvoir): string {
  return motif.replace(/_([a-z])/g, (_m, lettre: string) => lettre.toUpperCase());
}

/**
 * Écran 4 — Avoir (`design-etape-2-facturation.md` §6). Route attendue : `/factures/:id/avoir`.
 * Couvre les avoirs PARTIELS et les motifs qui ne justifient pas une facture de remplacement
 * (`prestation_annulee`, `geste_commercial`) — distinct de « Corriger cette facture » (§4.7).
 *
 * Le geste visible est UNIQUE (« Émettre l'avoir »), mais recouvre DEUX appels serveur successifs
 * (`RF-9` : un avoir naît toujours en brouillon, émis séparément) : création du brouillon puis
 * émission immédiate, chacun avec sa propre `Idempotency-Key` générée à l'ouverture du dialogue de
 * confirmation.
 */
export function EcranAvoir() {
  const { t } = useTranslation(['facturation', 'commun', 'erreurs', 'validation']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const requete = useDocumentVente(id);
  const creation = useCreerAvoir();
  const emission = useEmettreDocumentVente();

  const [motif, setMotif] = useState<MotifAvoir>('geste_commercial');
  const [motifAutre, setMotifAutre] = useState('');
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const [clesIdempotence, setClesIdempotence] = useState<{
    readonly creation: string;
    readonly emission: string;
  } | null>(null);
  const [erreurEtape, setErreurEtape] = useState<unknown>(null);

  useEffect(() => {
    if (dialogueOuvert) {
      setClesIdempotence({ creation: genererCleIdempotence(), emission: genererCleIdempotence() });
      setErreurEtape(null);
    }
  }, [dialogueOuvert]);

  if (requete.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('facturation:titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (requete.isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('facturation:titre')}</h1>
        <EtatErreur
          titre={t('facturation:avoir.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const facture = requete.data;
  const lignesEligibles = facture.lignes.filter((ligne) => ligne.montants);
  const toutesSelectionnees =
    lignesEligibles.length > 0 && lignesEligibles.every((ligne) => selection.has(ligne.id));

  function basculerLigne(id_: string) {
    setSelection((valeur) => {
      const suivant = new Set(valeur);
      if (suivant.has(id_)) suivant.delete(id_);
      else suivant.add(id_);
      return suivant;
    });
  }

  function toutSelectionner() {
    setSelection(new Set(lignesEligibles.map((ligne) => ligne.id)));
  }

  const totalAvoirCentimes = lignesEligibles
    .filter((ligne) => selection.has(ligne.id))
    .reduce((somme, ligne) => somme + (ligne.montants?.montantTtcCentimes ?? 0), 0);

  async function soumettre() {
    if (!clesIdempotence || !id) return;
    setErreurEtape(null);

    const portee = toutesSelectionnees ? 'total' : 'partiel';
    const resultat = schemaCreationAvoir.safeParse({
      portee,
      motif,
      motifAutre: motif === 'autre' ? motifAutre.trim() : undefined,
      lignes:
        portee === 'partiel'
          ? lignesEligibles
              .filter((ligne) => selection.has(ligne.id))
              .map((ligne) => ({
                ligneDocumentId: ligne.id,
                montantTtcCentimes: ligne.montants?.montantTtcCentimes ?? 0,
              }))
          : [],
    });
    if (!resultat.success) {
      // Défaut corrigé : `return` silencieux — le bouton restait actif et le clic ne faisait
      // rien (cas déclencheur : motif « Autre » de plus de 4000 caractères, `schemaTexteLong`,
      // au-delà de ce que `motifValide` ci-dessous et le `maxLength` du champ bornent déjà côté
      // UI). Défensif : `motifValide` doit normalement empêcher d'arriver ici, mais un refus
      // serveur inattendu ne doit jamais rester sans message (invariant n°8).
      setErreurEtape(new Error('validation_avoir_echouee'));
      return;
    }

    try {
      const brouillon = await creation.mutateAsync({
        factureId: id,
        entree: resultat.data,
        idempotencyKey: clesIdempotence.creation,
      });
      const emis = await emission.mutateAsync({
        id: brouillon.donnees.id,
        entree: {},
        idempotencyKey: clesIdempotence.emission,
      });
      setDialogueOuvert(false);
      navigate(`/factures/${emis.donnees.id}`);
    } catch (erreur) {
      setErreurEtape(erreur);
    }
  }

  const enCours = creation.isPending || emission.isPending;
  const erreurActive = erreurEtape ?? creation.error ?? emission.error;
  // `schemaTexteLong` (@dfa/shared) borne `motifAutre` à 4000 caractères — défaut corrigé : cette
  // contrainte n'était testée nulle part côté écran (ni validation ni `maxLength` sur le champ),
  // donc un texte plus long faisait échouer `schemaCreationAvoir.safeParse` en silence dans
  // `soumettre()` sans que le bouton ne se désactive ni qu'aucun message n'apparaisse.
  const motifAutreTropLong = motif === 'autre' && motifAutre.trim().length > 4000;
  const motifValide = motif !== 'autre' || (motifAutre.trim() !== '' && !motifAutreTropLong);
  const peutEmettre = selection.size > 0 && motifValide;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="texte-titre-section font-semibold text-foreground">
          {t('facturation:avoir.titre', {
            numero: facture.numero ?? '',
            destinataire: facture.figees.clientDesignation,
          })}
        </h1>
        <Button type="button" disabled={!peutEmettre} onClick={() => setDialogueOuvert(true)}>
          {t('facturation:avoir.action.emettre')}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="avoir-motif">{t('facturation:motifsAvoir.champ')}</Label>
            <Select value={motif} onValueChange={(valeur) => setMotif(valeur as MotifAvoir)}>
              <SelectTrigger id="avoir-motif">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOTIFS_AVOIR.map((valeur) => (
                  <SelectItem key={valeur} value={valeur}>
                    {t(`facturation:motifsAvoir.${cleMotif(valeur)}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {motif === 'autre' ? (
              <Textarea
                aria-label={t('facturation:motifsAvoir.autre')}
                placeholder={t('facturation:motifsAvoir.autrePlaceholder')}
                value={motifAutre}
                onChange={(evenement) => setMotifAutre(evenement.target.value)}
                maxLength={4000}
              />
            ) : null}
            {!motifValide ? (
              <p className="texte-libelle text-destructive">
                {motifAutreTropLong
                  ? t('facturation:motifsAvoir.autreTexteTropLong')
                  : t('facturation:motifsAvoir.autreTexteObligatoire')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <h2 className="texte-libelle font-medium text-foreground">
                {t('facturation:avoir.lignesOrigine.titre')}
              </h2>
              <Button type="button" variant="outline" size="sm" onClick={toutSelectionner}>
                {t('facturation:avoir.lignesOrigine.toutSelectionner')}
              </Button>
            </div>
            <ul className="flex flex-col gap-1.5">
              {facture.lignes.map((ligne) => {
                const eligible = Boolean(ligne.montants);
                return (
                  <li key={ligne.id} className="flex items-center gap-2 texte-corps">
                    <Checkbox
                      id={`avoir-ligne-${ligne.id}`}
                      checked={selection.has(ligne.id)}
                      disabled={!eligible}
                      onCheckedChange={() => basculerLigne(ligne.id)}
                    />
                    <label htmlFor={`avoir-ligne-${ligne.id}`} className="flex-1">
                      {ligne.designation}
                    </label>
                    {/* Pas de préfixe devise ici : toutes les lignes viennent de LA MÊME facture
                        d'origine (`facture.devise`), déjà annoncée sur le total de l'avoir
                        ci-dessous — la répéter par ligne serait du bruit (même règle que
                        `EcranFicheFacture.tsx`). */}
                    {ligne.montants ? (
                      <span className="tabular-nums">
                        {formaterMontant(ligne.montants.montantTtcCentimes)}
                      </span>
                    ) : (
                      <span className="texte-libelle text-muted-foreground">
                        {t('facturation:avoir.lignesOrigine.dejaCreditee')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {selection.size === 0 ? (
            <p className="texte-libelle text-muted-foreground">
              {t('facturation:avoir.motifObligatoire')}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <p className="texte-libelle text-muted-foreground">{t('facturation:avoir.totalAvoir')}</p>
          <p className="texte-chiffre-geant tabular-nums font-semibold text-foreground">
            −{formaterMontantAvecDevise(totalAvoirCentimes, facture.devise)}
          </p>
        </div>
      </div>

      <Dialog open={dialogueOuvert} onOpenChange={setDialogueOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('facturation:fiche.dialogueEmission.titreAvoir')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="texte-corps">
              {t('facturation:fiche.dialogueEmission.resumeAvoir', {
                numero: facture.numero ?? '',
                montant: formaterMontantAvecDevise(totalAvoirCentimes, facture.devise),
              })}
            </p>
            <p className="texte-corps text-muted-foreground">
              {t('facturation:fiche.dialogueEmission.avertissementAvoir', {
                numero: facture.numero ?? '',
              })}
            </p>
            {erreurActive ? (
              <p className="texte-libelle text-destructive">{messageErreur(erreurActive, t)}</p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t('commun:actions.annuler')}</Button>
            </DialogClose>
            <Button disabled={enCours} onClick={() => void soumettre()}>
              {enCours
                ? t('facturation:avoir.action.enCours')
                : t('facturation:fiche.dialogueEmission.confirmer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
