import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SiteResume, TypeMouvementStock } from '@dfa/shared';

import { useCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import { PanneauLateral } from '@/composants/PanneauLateral';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApercuForcage } from '@/hooks/pieces/useApercuForcage';
import {
  useCreerAjustementInventaire,
  useCreerMouvementCasse,
  useCreerMouvementPerte,
  useCreerMouvementTransfert,
  useCreerRetourFournisseur,
} from '@/hooks/pieces/useCreerMouvementStock';

import { messageErreurMutation } from './messages-erreur-mutation';
import { saisieVersQuantiteMillieme } from './utils';

/** Les CINQ mouvements à déclenchement direct (RP-16 → RP-18) — voir `useCreerMouvementStock.ts`.
 *  `entree_livraison`/`sortie_or`/`sortie_comptoir`/`retour_client`/`retour_consigne` sont des
 *  effets de bord d'autres actions (réception de commande, réservation, facturation) : aucune
 *  saisie manuelle pour eux ici. */
const TYPES_SAISISSABLES: readonly TypeMouvementStock[] = [
  'casse',
  'perte',
  'transfert',
  'ajustement_inventaire',
  'retour_fournisseur',
];

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly articleId: string;
  /** Sites du tenant (session) — un mouvement se pose toujours sur un site précis, jamais deviné. */
  readonly sites: readonly SiteResume[];
  /** Site présélectionné (`?site=` de l'écran appelant), simple confort de saisie. */
  readonly siteParDefaut?: string;
}

/**
 * Enregistre un mouvement de stock — un seul dialogue, sélecteur de type, champs qui s'adaptent
 * (même esprit que `DialoguePrestation`/`DialogueTauxHoraire` pour un seul dialogue à deux
 * gestes, ici CINQ). `mouvement_stock` est IMMUABLE côté serveur : ce dialogue ne modifie jamais
 * un mouvement existant, il n'en crée qu'un nouveau à chaque soumission.
 */
export function DialogueMouvementStock({
  ouvert,
  onOuvertChange,
  articleId,
  sites,
  siteParDefaut,
}: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'validation', 'erreurs']);
  const idempotence = useCleIdempotence();

  const [type, setType] = useState<TypeMouvementStock>('casse');
  const [siteId, setSiteId] = useState(siteParDefaut ?? '');
  const [siteSourceId, setSiteSourceId] = useState(siteParDefaut ?? '');
  const [siteDestinationId, setSiteDestinationId] = useState('');
  const [quantiteSaisie, setQuantiteSaisie] = useState('');
  const [motif, setMotif] = useState('');
  const [forcer, setForcer] = useState(false);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);
  const [aucunMouvementCree, setAucunMouvementCree] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setType('casse');
    setSiteId(siteParDefaut ?? '');
    setSiteSourceId(siteParDefaut ?? '');
    setSiteDestinationId('');
    setQuantiteSaisie('');
    setMotif('');
    setForcer(false);
    setErreurValidation(null);
    setAucunMouvementCree(false);
  }, [ouvert, siteParDefaut]);

  const casse = useCreerMouvementCasse(articleId);
  const perte = useCreerMouvementPerte(articleId);
  const transfert = useCreerMouvementTransfert(articleId);
  const ajustement = useCreerAjustementInventaire(articleId);
  const retourFournisseur = useCreerRetourFournisseur(articleId);

  const enCours =
    casse.isPending ||
    perte.isPending ||
    transfert.isPending ||
    ajustement.isPending ||
    retourFournisseur.isPending;
  const erreur =
    casse.error ?? perte.error ?? transfert.error ?? ajustement.error ?? retourFournisseur.error;

  const motifObligatoire = type !== 'transfert';
  const motifRequis = motif.trim().length >= 3;

  // DÉFAUT CORRIGÉ (test manuel du 14.08.2026, défaut n°2) : « Forcer » libère potentiellement des
  // réservations en cascade (RP-15) SANS que le dialogue n'en avertisse jusqu'ici. Interrogé
  // UNIQUEMENT quand la case est cochée sur un type qui l'accepte (`casse`/`perte`) ET que
  // site/quantité sont renseignés — jamais en arrière-plan pour un mouvement qui ne force pas.
  const quantiteApercu = saisieVersQuantiteMillieme(quantiteSaisie);
  const apercuForcage = useApercuForcage(
    articleId,
    siteId,
    quantiteApercu,
    forcer && (type === 'casse' || type === 'perte'),
  );
  const reservationsMenacees = apercuForcage.data?.reservations ?? [];

  function fermerApresSucces() {
    idempotence.regenerer();
    onOuvertChange(false);
  }

  function soumettre() {
    setErreurValidation(null);
    setAucunMouvementCree(false);

    const quantite = saisieVersQuantiteMillieme(quantiteSaisie);
    if (quantite === null) {
      setErreurValidation(t('validation:requis'));
      return;
    }
    if (motifObligatoire && !motifRequis) {
      setErreurValidation(t('validation:requis'));
      return;
    }

    const idempotencyKey = idempotence.cle;

    if (type === 'casse') {
      if (!siteId) return setErreurValidation(t('validation:requis'));
      casse.mutate(
        {
          entree: { siteId, quantiteMillieme: quantite, motif, ligneOrId: null, forcer },
          idempotencyKey,
        },
        { onSuccess: fermerApresSucces },
      );
      return;
    }
    if (type === 'perte') {
      if (!siteId) return setErreurValidation(t('validation:requis'));
      perte.mutate(
        {
          entree: { siteId, quantiteMillieme: quantite, motif, ligneOrId: null, forcer },
          idempotencyKey,
        },
        { onSuccess: fermerApresSucces },
      );
      return;
    }
    if (type === 'transfert') {
      if (!siteSourceId || !siteDestinationId || siteSourceId === siteDestinationId) {
        setErreurValidation(t('validation:requis'));
        return;
      }
      transfert.mutate(
        {
          entree: {
            siteSourceId,
            siteDestinationId,
            quantiteMillieme: quantite,
            motif: motif.trim() === '' ? undefined : motif,
          },
          idempotencyKey,
        },
        { onSuccess: fermerApresSucces },
      );
      return;
    }
    if (type === 'ajustement_inventaire') {
      if (!siteId) return setErreurValidation(t('validation:requis'));
      ajustement.mutate(
        { entree: { siteId, quantiteCompteeMillieme: quantite, motif }, idempotencyKey },
        {
          onSuccess: (reponse) => {
            if (reponse.donnees === null) {
              setAucunMouvementCree(true);
              return;
            }
            fermerApresSucces();
          },
        },
      );
      return;
    }
    // retour_fournisseur
    if (!siteId) return setErreurValidation(t('validation:requis'));
    retourFournisseur.mutate(
      {
        entree: { siteId, quantiteMillieme: quantite, motif, commandeFournisseurLigneId: null },
        idempotencyKey,
      },
      { onSuccess: fermerApresSucces },
    );
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={t('pieces:stock.mouvements.nouveauMouvement.titre')}
      pied={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOuvertChange(false)}
            disabled={enCours}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={enCours} onClick={soumettre}>
            {enCours ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-groupe">
        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>

        <div className="flex flex-col gap-champ">
          <Label htmlFor="mvt-type">
            {t('pieces:stock.mouvements.nouveauMouvement.champType')}
          </Label>
          <Select
            value={type}
            onValueChange={(valeur) => setType(valeur as TypeMouvementStock)}
            disabled={enCours}
          >
            <SelectTrigger
              id="mvt-type"
              aria-label={t('pieces:stock.mouvements.nouveauMouvement.champType')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES_SAISISSABLES.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pieces:stock.mouvements.types.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {type === 'transfert' ? (
          <div className="grid grid-cols-2 gap-controles">
            <div className="flex flex-col gap-champ">
              <Label htmlFor="mvt-site-source" requis>
                {t('pieces:stock.mouvements.siteSource')}
              </Label>
              <Select value={siteSourceId} onValueChange={setSiteSourceId} disabled={enCours}>
                <SelectTrigger
                  id="mvt-site-source"
                  aria-label={t('pieces:stock.mouvements.siteSource')}
                  aria-required="true"
                >
                  <SelectValue placeholder={t('pieces:stock.site')} />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-champ">
              <Label htmlFor="mvt-site-destination" requis>
                {t('pieces:stock.mouvements.siteDestination')}
              </Label>
              <Select
                value={siteDestinationId}
                onValueChange={setSiteDestinationId}
                disabled={enCours}
              >
                <SelectTrigger
                  id="mvt-site-destination"
                  aria-label={t('pieces:stock.mouvements.siteDestination')}
                  aria-required="true"
                >
                  <SelectValue placeholder={t('pieces:stock.site')} />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-champ">
            <Label htmlFor="mvt-site" requis>
              {t('pieces:stock.site')}
            </Label>
            <Select value={siteId} onValueChange={setSiteId} disabled={enCours}>
              <SelectTrigger id="mvt-site" aria-label={t('pieces:stock.site')} aria-required="true">
                <SelectValue placeholder={t('pieces:stock.site')} />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-champ">
          <Label htmlFor="mvt-quantite" requis>
            {type === 'ajustement_inventaire'
              ? t('pieces:stock.mouvements.nouveauMouvement.champQuantiteComptee')
              : t('pieces:stock.mouvements.quantite')}
          </Label>
          <Input
            id="mvt-quantite"
            type="text"
            inputMode="decimal"
            required
            readOnly={enCours}
            value={quantiteSaisie}
            onChange={(evenement) => setQuantiteSaisie(evenement.target.value)}
          />
        </div>

        <div className="flex flex-col gap-champ">
          <Label htmlFor="mvt-motif" requis={motifObligatoire}>
            {t('pieces:stock.mouvements.motif')}
          </Label>
          <Input
            id="mvt-motif"
            required={motifObligatoire}
            readOnly={enCours}
            value={motif}
            onChange={(evenement) => setMotif(evenement.target.value)}
          />
        </div>

        {type === 'casse' || type === 'perte' ? (
          <label htmlFor="mvt-forcer" className="flex items-center gap-2 texte-corps">
            <Checkbox
              id="mvt-forcer"
              checked={forcer}
              onCheckedChange={(coche) => setForcer(coche === true)}
              disabled={enCours}
            />
            {t('pieces:stock.mouvements.nouveauMouvement.champForcer')}
          </label>
        ) : null}

        {forcer && (type === 'casse' || type === 'perte') ? (
          apercuForcage.isPending ? (
            <p className="texte-libelle text-muted-foreground">
              {t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.chargement')}
            </p>
          ) : apercuForcage.isError ? (
            <p className="texte-libelle text-destructive" role="alert">
              {t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.erreur')}
            </p>
          ) : reservationsMenacees.length > 0 ? (
            <Alert variant="avertissement">
              <AlertDescription>
                <p>
                  {t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.titre', {
                    count: reservationsMenacees.length,
                  })}
                </p>
                <p>
                  {t('pieces:stock.mouvements.nouveauMouvement.apercuForcage.listeOrs', {
                    numeros: reservationsMenacees
                      .map((reservation) => reservation.ordreReparationNumero)
                      .join(', '),
                  })}
                </p>
              </AlertDescription>
            </Alert>
          ) : null
        ) : null}

        {aucunMouvementCree ? (
          <Alert variant="avertissement">
            <AlertDescription>
              {t('pieces:stock.mouvements.nouveauMouvement.aucunEcart')}
            </AlertDescription>
          </Alert>
        ) : null}

        {erreurValidation ? (
          <p className="texte-libelle text-destructive" role="alert">
            {erreurValidation}
          </p>
        ) : null}
        {erreur ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreurMutation(erreur, t)}
          </p>
        ) : null}
      </div>
    </PanneauLateral>
  );
}
