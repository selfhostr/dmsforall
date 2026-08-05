import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOYENS_PAIEMENT, type EntreeCreationPaiement, type MoyenPaiement } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { useEncaissement } from '@/hooks/facturation/useEncaissement';
import { useFacturesOuvertesClient } from '@/hooks/facturation/useFacturesOuvertesClient';
import { formaterDate, formaterMontant } from '@/lib/formats';
import { genererUuid } from '@/lib/uuid';

import { EncartAvanceClient } from './EncartAvanceClient';

/** Arrondi commercial au 5 centimes (RF-49) — seule la ligne Espèces qui SOLDE le document y est
 *  soumise (§5.3). `Math.round` centré : 2 et 3 centimes d'écart se répartissent symétriquement. */
function arrondirA5Centimes(centimes: number): number {
  return Math.round(centimes / 5) * 5;
}

interface LignePaiementSaisie {
  readonly id: string;
  readonly moyen: MoyenPaiement;
  readonly montantCentimes: number | null;
  /** Non nul UNIQUEMENT si cette ligne a été pré-remplie automatiquement en Espèces comme dernière
   *  ligne qui solde (§5.3) — s'efface dès que l'utilisateur modifie le montant ou le moyen à la
   *  main (risque n°3 du design : « le montant déjà saisi manuellement n'est jamais modifié
   *  automatiquement une fois édité »). */
  readonly ecartArrondiCentimes: number | null;
}

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** Résolu par l'écran appelant (`document.siteId` en écran 2, site courant `?site=` en fiche
   *  client) — jamais deviné ici : le tenant/site vient toujours de l'appelant, jamais d'un état
   *  local à ce panneau. */
  readonly siteId: string;
  readonly clientId: string;
  /** Nom affiché dans le titre du panneau (`figees.clientDesignation`/`nomAffiche` du contexte
   *  appelant). */
  readonly destinataireNom: string | null;
  /** Facture précochée si le panneau s'ouvre depuis `/factures/:id` (point d'entrée 1, §5). Absent
   *  si ouvert depuis la fiche client (point d'entrée 2) : aucune présélection (`RF-70`). */
  readonly factureIdPreselectionnee?: string;
}

/**
 * Écran 3 — Encaissement (`design-etape-2-facturation.md` §5). Un seul composant pour les deux
 * points d'entrée (facture précochée / liste des factures ouvertes du client), un `Sheet`
 * (`side="right"`), jamais une page dédiée.
 */
export function SheetEncaissement({
  ouvert,
  onOuvertChange,
  siteId,
  clientId,
  destinataireNom,
  factureIdPreselectionnee,
}: Props) {
  const { t } = useTranslation(['facturation', 'commun']);
  const facturesOuvertes = useFacturesOuvertesClient(ouvert ? clientId : undefined);
  const encaissement = useEncaissement();

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [lignes, setLignes] = useState<readonly LignePaiementSaisie[]>([]);
  const [erreurGenerique, setErreurGenerique] = useState<string | null>(null);

  // Réinitialisation à chaque ouverture — la présélection (`RF-70`) n'a de sens qu'au premier
  // rendu après ouverture, jamais recalculée pendant la saisie.
  useEffect(() => {
    if (!ouvert) return;
    setSelection(factureIdPreselectionnee ? new Set([factureIdPreselectionnee]) : new Set());
    setLignes([]);
    setErreurGenerique(null);
  }, [ouvert, factureIdPreselectionnee]);

  const factures = facturesOuvertes.data ?? [];
  const totalSelectionneCentimes = factures
    .filter((facture) => selection.has(facture.id))
    .reduce((somme, facture) => somme + (facture.soldeCentimes ?? 0), 0);

  const sommeLignesCentimes = lignes.reduce(
    (somme, ligne) => somme + (ligne.montantCentimes ?? 0),
    0,
  );
  const sommeEcartsCentimes = lignes.reduce(
    (somme, ligne) => somme + (ligne.ecartArrondiCentimes ?? 0),
    0,
  );
  const resteAEncaisserCentimes =
    totalSelectionneCentimes - sommeLignesCentimes + sommeEcartsCentimes;
  const tropPercuCentimes = sommeLignesCentimes - sommeEcartsCentimes - totalSelectionneCentimes;

  function basculerFacture(id: string) {
    setSelection((valeur) => {
      const suivant = new Set(valeur);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  function ajouterLigne() {
    const resteExact = totalSelectionneCentimes - sommeLignesCentimes;
    const id = genererUuid();
    // Espèces par défaut (le geste comptoir le plus fréquent) : si ce reste zéro le solde,
    // arrondi commercial automatique et visible sans qu'on ait à le savoir (§5.3).
    if (resteExact > 0) {
      const arrondi = arrondirA5Centimes(resteExact);
      const ecart = arrondi - resteExact;
      setLignes((valeur) => [
        ...valeur,
        {
          id,
          moyen: 'especes',
          montantCentimes: arrondi,
          ecartArrondiCentimes: ecart !== 0 ? ecart : null,
        },
      ]);
    } else {
      setLignes((valeur) => [
        ...valeur,
        { id, moyen: 'especes', montantCentimes: null, ecartArrondiCentimes: null },
      ]);
    }
  }

  function retirerLigne(id: string) {
    setLignes((valeur) => valeur.filter((ligne) => ligne.id !== id));
  }

  function modifierMoyen(id: string, moyen: MoyenPaiement) {
    setLignes((valeur) =>
      valeur.map((ligne) =>
        ligne.id === id ? { ...ligne, moyen, ecartArrondiCentimes: null } : ligne,
      ),
    );
  }

  function modifierMontant(id: string, montantCentimes: number | null) {
    setLignes((valeur) =>
      valeur.map((ligne) =>
        ligne.id === id ? { ...ligne, montantCentimes, ecartArrondiCentimes: null } : ligne,
      ),
    );
  }

  function fermer() {
    onOuvertChange(false);
  }

  /** Un `paiement` = un moyen (`EntreeCreationPaiement.moyen` est singulier) : plusieurs lignes de
   *  paiement, c'est donc plusieurs `POST /paiements` distincts — jamais le même endpoint pour un
   *  panier. Chaque requête est une création SENSIBLE et porte SA PROPRE clé d'idempotence
   *  (`api/idempotence.ts` : « une clé par requête distincte ») ; réutiliser une seule clé pour N
   *  corps différents provoquerait un `409 IDEMPOTENCE_CONFLIT` sur la deuxième ligne. Le lettrage
   *  (`RF-69`) est porté par la PREMIÈRE ligne seulement, réparti dans l'ordre d'ancienneté sur les
   *  factures cochées, à hauteur du total réellement collecté (hors écart d'arrondi).
   */
  async function soumettre() {
    setErreurGenerique(null);
    if (
      lignes.length === 0 ||
      lignes.some((ligne) => ligne.montantCentimes === null || ligne.montantCentimes <= 0)
    ) {
      setErreurGenerique(t('facturation:encaissement.lignesInvalides'));
      return;
    }

    let resteAImputer = Math.max(sommeLignesCentimes - sommeEcartsCentimes, 0);
    const imputations = factures
      .filter((facture) => selection.has(facture.id))
      .map((facture) => {
        const montant = Math.min(facture.soldeCentimes ?? 0, resteAImputer);
        resteAImputer -= montant;
        return { documentId: facture.id, montantCentimes: montant, nature: 'reglement' as const };
      })
      .filter((imputation) => imputation.montantCentimes > 0);

    try {
      for (const [index, ligne] of lignes.entries()) {
        const entree: EntreeCreationPaiement = {
          siteId,
          dateValeur: new Date().toISOString().slice(0, 10),
          moyen: ligne.moyen,
          montantCentimes: ligne.montantCentimes as number,
          devise: 'CHF',
          payeurClientId: clientId,
          payeurLibelle: destinataireNom ?? '',
          imputations: index === 0 ? imputations : [],
        };
        await encaissement.mutateAsync({ entree, idempotencyKey: genererCleIdempotence() });
      }
      fermer();
    } catch {
      // L'erreur est déjà exposée via `encaissement.error`/`messageErreur` ci-dessous — pas de
      // retraitement ici, seule la fermeture du panneau doit être annulée pour laisser la saisie
      // intacte (§5.5 : « contenu saisi conservé, la demande peut être rejouée sans tout retaper »).
    }
  }

  const enCours = encaissement.isPending;

  return (
    <Sheet open={ouvert} onOpenChange={(valeur) => (valeur ? undefined : fermer())}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {destinataireNom
              ? t('facturation:encaissement.titre', { destinataire: destinataireNom })
              : t('facturation:encaissement.titreGenerique')}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-6 py-4">
          <section className="flex flex-col gap-2">
            <h2 className="texte-libelle font-medium text-foreground">
              {t('facturation:encaissement.facturesOuvertes.titre')}
            </h2>
            {facturesOuvertes.isPending ? (
              <EtatChargement lignes={2} />
            ) : factures.length === 0 ? (
              <p className="texte-corps text-muted-foreground">
                {t('facturation:encaissement.facturesOuvertes.vide')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {factures.map((facture) => (
                  <li key={facture.id} className="flex items-center gap-2 texte-corps">
                    <Checkbox
                      id={`encaissement-facture-${facture.id}`}
                      checked={selection.has(facture.id)}
                      onCheckedChange={() => basculerFacture(facture.id)}
                    />
                    <label htmlFor={`encaissement-facture-${facture.id}`} className="flex-1">
                      {facture.numero} ·{' '}
                      {t('facturation:encaissement.facturesOuvertes.emiseLe', {
                        date: formaterDate(facture.dateDocument),
                      })}
                    </label>
                    {facture.soldeCentimes !== undefined ? (
                      <span className="tabular-nums text-muted-foreground">
                        {t('facturation:encaissement.facturesOuvertes.resteDu', {
                          montant: formaterMontant(facture.soldeCentimes),
                        })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {factures.length === 0 && !facturesOuvertes.isPending ? (
              <EncartAvanceClient message={t('facturation:avanceClient.aucuneFactureOuverte')} />
            ) : (
              <div className="flex items-center justify-between border-t pt-2 texte-corps font-medium">
                <span>{t('facturation:encaissement.facturesOuvertes.totalSelectionne')}</span>
                <span className="tabular-nums">{formaterMontant(totalSelectionneCentimes)}</span>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="texte-libelle font-medium text-foreground">
              {t('facturation:encaissement.lignes.titre')}
            </h2>
            {lignes.map((ligne) => (
              <div key={ligne.id} className="flex items-end gap-2 rounded-md border p-2">
                <div className="flex flex-col gap-1.5">
                  <span className="texte-libelle text-muted-foreground">
                    {t('facturation:encaissement.lignes.moyen')}
                  </span>
                  <Select
                    value={ligne.moyen}
                    onValueChange={(valeur) => modifierMoyen(ligne.id, valeur as MoyenPaiement)}
                  >
                    <SelectTrigger
                      className="w-[160px]"
                      aria-label={t('facturation:encaissement.lignes.moyen')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MOYENS_PAIEMENT.map((moyen) => (
                        <SelectItem key={moyen} value={moyen}>
                          {t(`facturation:moyensPaiement.${moyen}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <ChampMontant
                    valeurCentimes={ligne.montantCentimes}
                    onChangeCentimes={(centimes) => modifierMontant(ligne.id, centimes)}
                    label={t('facturation:encaissement.lignes.montant')}
                  />
                  {ligne.ecartArrondiCentimes !== null ? (
                    <p className="texte-libelle text-muted-foreground">
                      {t('facturation:encaissement.lignes.arrondi', {
                        ecart: `${ligne.ecartArrondiCentimes > 0 ? '+' : ''}${formaterMontant(ligne.ecartArrondiCentimes)}`,
                      })}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('facturation:encaissement.lignes.retirer')}
                  onClick={() => retirerLigne(ligne.id)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={ajouterLigne}>
              {t('facturation:encaissement.lignes.ajouter')}
            </Button>
          </section>

          {tropPercuCentimes > 0 ? (
            <EncartAvanceClient
              message={t('facturation:avanceClient.message', {
                montant: formaterMontant(totalSelectionneCentimes),
              })}
            />
          ) : null}

          <div className="flex items-center justify-between border-t pt-3 texte-corps font-semibold">
            <span>{t('facturation:encaissement.resteAEncaisser')}</span>
            <span className="tabular-nums">
              {formaterMontant(Math.max(resteAEncaisserCentimes, 0))}
            </span>
          </div>

          {encaissement.isError ? (
            <p className="texte-libelle text-destructive">{messageErreur(encaissement.error, t)}</p>
          ) : null}
          {erreurGenerique ? (
            <p className="texte-libelle text-destructive">{erreurGenerique}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={fermer} disabled={enCours}>
              {t('commun:actions.annuler')}
            </Button>
            <Button
              type="button"
              onClick={() => void soumettre()}
              disabled={enCours || lignes.length === 0}
            >
              {enCours
                ? t('facturation:encaissement.enCours')
                : t('facturation:encaissement.confirmer')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
