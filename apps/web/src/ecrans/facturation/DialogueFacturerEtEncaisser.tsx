import { AlertTriangle, CheckCircle2, Download, Mail } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AideContextuelle } from '@/composants/AideContextuelle';
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
import { cn } from '@/lib/utils';
import { montantPourMoyen } from '@/hooks/facturation/montant-encaissement';
import { useEnvoyerDocumentParCourriel } from '@/hooks/facturation/useEnvoyerDocumentParCourriel';
import {
  CHOIX_PAIEMENT_COMPTOIR,
  useFacturerEtEncaisser,
  type ChoixPaiementComptoir,
} from '@/hooks/facturation/useFacturerEtEncaisser';
import { useTelechargerPdfDocument } from '@/hooks/facturation/useTelechargerPdfDocument';
import { formaterMontant, formaterMontantAvecDevise } from '@/lib/formats';

/** Ce que le dialogue doit facturer : figé à l'ouverture par l'écran appelant, car la facturation
 *  vide la liste des lignes à facturer de l'OR (le dialogue ne doit pas disparaître avec elle). */
export interface DemandeFacturerEtEncaisser {
  readonly orId: string;
  /** Total TTC estimé (somme des groupes cochés) ; le montant réellement encaissé est celui du
   *  solde de la facture créée. `undefined` pour un rôle sans droit aux montants. */
  readonly totalEstimeCentimes: number | undefined;
  readonly destinataireNom: string;
}

interface Props {
  readonly demande: DemandeFacturerEtEncaisser | null;
  /** Fermeture du dialogue ; `facture` porte l'id de la facture si elle a été créée. */
  readonly onFermer: (issue: { readonly factureId: string | null }) => void;
  /** Ouvre l'écran détaillé de la facture (`/factures/:id`). */
  readonly onOuvrirFacture: (factureId: string) => void;
  /** Parcours détaillé (« Facturer en détail ») ; absent si on y est déjà. */
  readonly onFacturerEnDetail?: () => void;
}

const DEVISE = 'CHF' as const;

/**
 * « Facturer et encaisser » : un seul dialogue pour créer la facture, l'émettre et encaisser, puis
 * télécharger le PDF ou l'envoyer par e-mail. Un seul appel serveur (`useFacturerEtEncaisser`) ;
 * ici, seulement l'affichage.
 */
export function DialogueFacturerEtEncaisser({
  demande,
  onFermer,
  onOuvrirFacture,
  onFacturerEnDetail,
}: Props) {
  const { t } = useTranslation(['facturation', 'commun', 'erreurs']);
  const idGroupe = useId();
  const flux = useFacturerEtEncaisser();
  const pdf = useTelechargerPdfDocument();
  const courriel = useEnvoyerDocumentParCourriel();
  const [choix, setChoix] = useState<ChoixPaiementComptoir>('especes');

  const ouvert = demande !== null;
  const { resultat } = flux;

  function fermer() {
    if (flux.enCours) return;
    const factureId = resultat?.document.id ?? null;
    flux.reinitialiser();
    pdf.reset();
    courriel.reset();
    setChoix('especes');
    onFermer({ factureId });
  }

  // Aperçu du montant : espèces arrondies au 5 ct, autres moyens au centime — le MÊME calcul que
  // celui appliqué à l'encaissement (`montantPourMoyen`), recalculé à chaque changement de moyen.
  const apercu =
    demande?.totalEstimeCentimes !== undefined && choix !== 'plus_tard'
      ? montantPourMoyen(demande.totalEstimeCentimes, choix)
      : null;

  const libelleBouton = flux.enCours
    ? t('facturation:facturerEncaisser.enCours')
    : flux.erreur
      ? t('facturation:facturerEncaisser.reessayer')
      : choix === 'plus_tard'
        ? t('facturation:facturerEncaisser.actionPlusTard')
        : t('facturation:facturerEncaisser.action', {
            montant: apercu ? formaterMontantAvecDevise(apercu.montantCentimes, DEVISE) : '',
          }).trim();

  const peutEnvoyer = resultat !== null && resultat.document.qr !== null;

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => (valeur ? undefined : fermer())}>
      <DialogContent>
        {resultat ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('facturation:facturerEncaisser.succes.titre')}</DialogTitle>
              <DialogDescription>
                {t('facturation:facturerEncaisser.succes.facture', {
                  numero: resultat.document.numero ?? '',
                })}
              </DialogDescription>
            </DialogHeader>
            <section
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-2 py-2 text-center"
            >
              {resultat.encaissementEchoue ? (
                <AlertTriangle aria-hidden className="h-10 w-10 text-statut-attention" />
              ) : (
                <CheckCircle2 aria-hidden className="h-10 w-10 text-statut-succes" />
              )}
              <p className="texte-corps font-medium text-foreground">
                {resultat.encaissementEchoue
                  ? t('facturation:facturerEncaisser.succes.encaissementEchoue', {
                      numero: resultat.document.numero ?? '',
                    })
                  : resultat.moyen && resultat.encaisseCentimes !== null
                    ? t('facturation:facturerEncaisser.succes.encaisse', {
                        montant: formaterMontantAvecDevise(resultat.encaisseCentimes, DEVISE),
                        moyen: t(`facturation:moyensPaiement.${resultat.moyen}`),
                      })
                    : t('facturation:facturerEncaisser.succes.plusTard')}
              </p>
            </section>
            {resultat.encaissementEchoue ? (
              <div className="flex flex-col items-center gap-2">
                <Button
                  type="button"
                  disabled={flux.enCours}
                  onClick={() => void flux.encaisserMaintenant()}
                >
                  {t('facturation:facturerEncaisser.succes.encaisserMaintenant')}
                </Button>
                {flux.erreurEncaissement ? (
                  <p role="alert" className="texte-libelle text-destructive">
                    {t('facturation:facturerEncaisser.succes.encaissementErreur')}{' '}
                    {messageErreur(flux.erreurEncaissement, t)}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pdf.isPending}
                onClick={() =>
                  pdf.mutate({
                    id: resultat.document.id,
                    nom: resultat.document.numero ?? resultat.document.id,
                  })
                }
              >
                <Download aria-hidden className="h-4 w-4" />
                {t('facturation:facturerEncaisser.succes.telechargerPdf')}
              </Button>
              {peutEnvoyer ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={courriel.isPending}
                  onClick={() => courriel.mutate(resultat.document.id)}
                >
                  <Mail aria-hidden className="h-4 w-4" />
                  {t('facturation:facturerEncaisser.succes.envoyerCourriel')}
                </Button>
              ) : null}
            </div>
            {pdf.isError ? (
              <p role="alert" className="texte-libelle text-destructive">
                {messageErreur(pdf.error, t)}
              </p>
            ) : null}
            {courriel.isError ? (
              <p role="alert" className="texte-libelle text-destructive">
                {messageErreur(courriel.error, t)}
              </p>
            ) : null}
            {courriel.isSuccess ? (
              <p role="status" className="texte-libelle text-statut-succes">
                {t('facturation:facturerEncaisser.succes.courrielEnvoye', {
                  destinataire: courriel.data.destinataire,
                })}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOuvrirFacture(resultat.document.id)}
              >
                {t('facturation:facturerEncaisser.succes.ouvrirFacture')}
              </Button>
              <Button type="button" onClick={fermer}>
                {t('commun:actions.fermer')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('facturation:facturerEncaisser.titre')}</DialogTitle>
              <DialogDescription>
                {demande?.totalEstimeCentimes !== undefined
                  ? t('facturation:facturerEncaisser.resume', {
                      destinataire: demande.destinataireNom,
                      montant: formaterMontantAvecDevise(demande.totalEstimeCentimes, DEVISE),
                    })
                  : (demande?.destinataireNom ?? '')}
              </DialogDescription>
            </DialogHeader>

            <fieldset className="flex flex-col gap-2" disabled={flux.enCours}>
              <legend className="mb-1 texte-libelle font-medium text-foreground">
                {t('facturation:facturerEncaisser.modeLegende')}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {CHOIX_PAIEMENT_COMPTOIR.map((valeur) => (
                  <label
                    key={valeur}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-center texte-corps font-medium',
                      'has-[:focus-visible]:anneau-focus',
                      choix === valeur
                        ? 'border-primary bg-marque-doux text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <input
                      type="radio"
                      name={idGroupe}
                      value={valeur}
                      checked={choix === valeur}
                      onChange={() => setChoix(valeur)}
                      className="sr-only"
                    />
                    {t(`facturation:facturerEncaisser.modes.${valeur}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="texte-corps text-foreground" aria-live="polite">
              {choix === 'plus_tard'
                ? t('facturation:facturerEncaisser.apercuPlusTard')
                : apercu
                  ? apercu.ecartArrondiCentimes !== 0
                    ? t('facturation:facturerEncaisser.apercuArrondi', {
                        montant: formaterMontantAvecDevise(apercu.montantCentimes, DEVISE),
                        ecart: `${apercu.ecartArrondiCentimes > 0 ? '+' : ''}${formaterMontant(apercu.ecartArrondiCentimes)}`,
                      })
                    : t('facturation:facturerEncaisser.apercuExact', {
                        montant: formaterMontantAvecDevise(apercu.montantCentimes, DEVISE),
                      })
                  : t('facturation:facturerEncaisser.apercuInconnu')}{' '}
              <AideContextuelle
                sujet={t('aide:facturation.arrondiEspeces.sujet')}
                texte={t('aide:facturation.arrondiEspeces.texte')}
              />
            </p>

            {flux.erreurConfirmation ? (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-md border border-statut-attention bg-statut-attention-fond p-3"
              >
                <p className="texte-corps text-statut-attention">
                  {messageErreur(flux.erreurConfirmation, t)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  disabled={flux.enCours}
                  onClick={() => void flux.confirmerEtRelancer()}
                >
                  {t('commun:actions.continuerQuandMeme')}
                </Button>
              </div>
            ) : null}

            {flux.erreur ? (
              <div role="alert" className="flex flex-col gap-1">
                <p className="texte-corps font-medium text-destructive">
                  {t('facturation:facturerEncaisser.echec.facturation')}
                </p>
                <p className="texte-libelle text-destructive">{messageErreur(flux.erreur, t)}</p>
                <p className="texte-libelle text-muted-foreground">
                  {t('facturation:facturerEncaisser.echec.factureConservee')}
                </p>
              </div>
            ) : null}

            <DialogFooter>
              {onFacturerEnDetail ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={flux.enCours}
                  onClick={onFacturerEnDetail}
                >
                  {t('facturation:facturerEncaisser.enDetail')}
                </Button>
              ) : null}
              <Button type="button" variant="outline" disabled={flux.enCours} onClick={fermer}>
                {t('commun:actions.annuler')}
              </Button>
              <Button
                type="button"
                disabled={flux.enCours || flux.confirmationsRequises.length > 0 || !demande}
                onClick={() => (demande ? void flux.lancer(demande.orId, choix) : undefined)}
              >
                {libelleBouton}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
