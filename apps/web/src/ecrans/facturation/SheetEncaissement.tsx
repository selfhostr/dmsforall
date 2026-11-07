import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MOYENS_PAIEMENT,
  type DeviseFacturation,
  type EntreeCreationPaiement,
  type MoyenPaiement,
} from '@dfa/shared';

import { AideContextuelle } from '@/composants/AideContextuelle';
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
import { clesFacturation } from '@/hooks/facturation/cles';
import { montantPourMoyen, repartirImputations } from '@/hooks/facturation/montant-encaissement';
import { useEncaissement } from '@/hooks/facturation/useEncaissement';
import { useFacturesOuvertesClient } from '@/hooks/facturation/useFacturesOuvertesClient';
import { formaterDate, formaterMontant, formaterMontantAvecDevise } from '@/lib/formats';
import { genererUuid } from '@/lib/uuid';

import { BadgeStatutReglement } from './BadgeStatutReglement';
import { EncartAvanceClient } from './EncartAvanceClient';

interface LignePaiementSaisie {
  readonly id: string;
  readonly moyen: MoyenPaiement;
  readonly montantCentimes: number | null;
  /** Non nul UNIQUEMENT si cette ligne a été pré-remplie automatiquement en Espèces comme dernière
   *  ligne qui solde (§5.3) — s'efface dès que l'utilisateur modifie le montant ou le moyen à la
   *  main (risque n°3 du design : « le montant déjà saisi manuellement n'est jamais modifié
   *  automatiquement une fois édité »). */
  readonly ecartArrondiCentimes: number | null;
  /** Montant EXACT dont `montantCentimes` découle, tant que la ligne est pré-remplie
   *  automatiquement (non nul uniquement dans ce cas). Sert à RECALCULER le montant quand on change
   *  de moyen (espèces arrondies au 5 ct, TWINT/carte au centime près) sans repartir d'un montant
   *  déjà arrondi. Passe à `null` dès que l'utilisateur tape un montant : sa saisie n'est jamais
   *  réécrite. */
  readonly exactCentimes: number | null;
  /**
   * Clé d'idempotence de CETTE ligne (`api/idempotence.ts` : « une clé par ligne, à l'instant où
   * le contenu est déterminé »), STABLE tant que la ligne n'est ni modifiée ni soumise avec
   * succès — DÉFAUT CORRIGÉ (testeur novice, encaissement de Meier Urs, 60.00 CHF) : `soumettre()`
   * appelait autrefois `genererCleIdempotence()` DANS la boucle d'envoi, donc à CHAQUE clic sur
   * « Enregistrer l'encaissement », y compris un simple rejeu après une erreur d'affichage. Un
   * rejeu portant une clé neuve n'est jamais reconnu par le serveur comme le même geste : si le
   * premier essai avait en réalité RÉUSSI côté serveur (réponse perdue côté client — timeout,
   * coupure), le second envoyait un DEUXIÈME encaissement, distinct, sur un solde déjà nul —
   * exactement le `IMPUTATION_MONTANT_EXCEDENTAIRE` observé par le testeur après avoir cliqué
   * « Réessayez ». Preuve en exécution (`POST /paiements` réel, deux clés différentes, même
   * corps) : 1er appel → 201 (facture soldée) ; 2e appel → 409, `restant=0`. La clé est régénérée
   * UNIQUEMENT quand `moyen`/`montantCentimes` changent (`modifierMoyen`/`modifierMontant`
   * ci-dessous) — un contenu modifié est, par construction, une requête distincte.
   */
  readonly idempotencyKey: string;
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
  const queryClient = useQueryClient();
  const facturesOuvertes = useFacturesOuvertesClient(ouvert ? clientId : undefined);
  const encaissement = useEncaissement();

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [lignes, setLignes] = useState<readonly LignePaiementSaisie[]>([]);
  const [erreurGenerique, setErreurGenerique] = useState<string | null>(null);
  /** Non `null` UNIQUEMENT après un encaissement effectivement confirmé par le serveur (§ item 3
   *  du correctif du testeur novice — « confirmer explicitement le succès »). Remplace le
   *  formulaire par un accusé de réception explicite plutôt que de fermer le panneau en silence :
   *  avant ce correctif, un succès et un échec se refermaient tous deux sans un mot, ce qui a fait
   *  perdre le premier encaissement de vue au testeur. */
  const [confirmationSucces, setConfirmationSucces] = useState<{
    readonly montantCentimes: number;
    readonly devise: DeviseFacturation;
    readonly regle: boolean;
  } | null>(null);
  /**
   * Défaut corrigé (issues #80/#61, testeur novice — « je n'ai pas osé cliquer, j'allais enregistrer
   * une avance sur le compte d'un client qui a déjà payé ») : quand `factures.length === 0`, ce
   * panneau composait DÉJÀ le message « aucune facture ouverte », mais laissait la section
   * « Encaissements » et le bouton « Enregistrer » pleinement actifs juste en dessous — un utilisateur
   * pressé pouvait saisir un montant et soumettre SANS jamais avoir choisi une avance, elle se
   * produisait comme EFFET DE BORD d'un geste qui se voulait un encaissement normal. `avanceConfirmee`
   * verrouille la saisie tant que l'utilisateur n'a pas cliqué un bouton dédié, EXPLICITE, qui NOMME
   * ce que ce geste va faire — jamais un défaut silencieux. Sans objet (et donc sans effet) tant
   * qu'au moins une facture ouverte existe : dans ce cas la saisie reste immédiatement disponible,
   * comme avant ce correctif.
   */
  const [avanceConfirmee, setAvanceConfirmee] = useState(false);

  // Réinitialisation à chaque ouverture — la présélection (`RF-70`) n'a de sens qu'au premier
  // rendu après ouverture, jamais recalculée pendant la saisie.
  useEffect(() => {
    if (!ouvert) return;
    setSelection(factureIdPreselectionnee ? new Set([factureIdPreselectionnee]) : new Set());
    setLignes([]);
    setErreurGenerique(null);
    setConfirmationSucces(null);
    setAvanceConfirmee(false);
  }, [ouvert, factureIdPreselectionnee]);

  const factures = facturesOuvertes.data ?? [];
  // Voir le commentaire de `avanceConfirmee` ci-dessus : tant que la question n'est pas tranchée
  // (chargement en cours), on ne bascule PAS en mode avance — un flash « aucune facture ouverte »
  // pendant les quelques centaines de ms du premier rendu serait un mensonge temporaire.
  const aucuneFactureOuverte = !facturesOuvertes.isPending && factures.length === 0;

  /**
   * Devise portée par les factures sélectionnées (`DocumentVenteResume.devise`, migration `0015`)
   * — déterminée UNIQUEMENT quand la sélection est homogène. Sélection vide (rien à régler
   * encore) ou mélangeant CHF/EUR (un client peut, en théorie, avoir des factures reprises dans
   * deux devises) : `undefined`, jamais une devise devinée par défaut.
   */
  const devisesSelectionnees = new Set(
    factures.filter((facture) => selection.has(facture.id)).map((facture) => facture.devise),
  );
  const deviseSelectionCommune: DeviseFacturation | undefined =
    devisesSelectionnees.size === 1 ? [...devisesSelectionnees][0] : undefined;
  /**
   * Défaut corrigé (issue #135) : une sélection mixte (une facture CHF + une facture EUR cochées
   * ensemble) laissait auparavant `totalSelectionneCentimes` additionner des soldes de deux
   * devises différentes ET le paiement partait quand même codé en dur `devise: 'CHF'` — un
   * garagiste qui cochait par erreur deux factures de devises différentes n'avait AUCUN signal
   * avant l'échec, et l'échec lui-même (`409 IMPUTATION_DEVISE_INCOHERENTE`) n'aurait porté que
   * sur la SECONDE facture imputée, jamais sur la sélection dans son ensemble. Verrouille la
   * saisie (même patron que `avanceConfirmee` ci-dessus) tant que la sélection n'est pas ramenée
   * à une seule devise — voir le message dédié plus bas dans le rendu.
   */
  const selectionMultiDevises = selection.size > 0 && devisesSelectionnees.size > 1;
  const saisieDisponible = (!aucuneFactureOuverte || avanceConfirmee) && !selectionMultiDevises;
  const totalSelectionneCentimes = factures
    .filter((facture) => selection.has(facture.id))
    .reduce((somme, facture) => somme + (facture.soldeCentimes ?? 0), 0);

  /** Affiche la devise quand elle est connue et non ambiguë (`deviseSelectionCommune`), sinon un
   *  montant nu plutôt qu'un préfixe inventé — voir le commentaire ci-dessus. */
  function formaterTotalSelection(centimes: number): string {
    return deviseSelectionCommune
      ? formaterMontantAvecDevise(centimes, deviseSelectionCommune)
      : formaterMontant(centimes);
  }

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
      const { montantCentimes, ecartArrondiCentimes } = montantPourMoyen(resteExact, 'especes');
      setLignes((valeur) => [
        ...valeur,
        {
          id,
          moyen: 'especes',
          montantCentimes,
          ecartArrondiCentimes: ecartArrondiCentimes !== 0 ? ecartArrondiCentimes : null,
          exactCentimes: resteExact,
          idempotencyKey: genererCleIdempotence(),
        },
      ]);
    } else {
      setLignes((valeur) => [
        ...valeur,
        {
          id,
          moyen: 'especes',
          montantCentimes: null,
          ecartArrondiCentimes: null,
          exactCentimes: null,
          idempotencyKey: genererCleIdempotence(),
        },
      ]);
    }
  }

  function retirerLigne(id: string) {
    setLignes((valeur) => valeur.filter((ligne) => ligne.id !== id));
  }

  // `modifierMoyen`/`modifierMontant` régénèrent la clé d'idempotence de la ligne : un contenu
  // modifié est une requête DISTINCTE de celle (jamais envoyée, ou en échec) qui portait l'ancien
  // contenu — voir le commentaire de `LignePaiementSaisie.idempotencyKey`. Ne PAS régénérer ici
  // romprait la déduplication ; régénérer à chaque clic de soumission (l'ancien défaut) la cassait
  // entièrement.
  function modifierMoyen(id: string, moyen: MoyenPaiement) {
    setLignes((valeur) =>
      valeur.map((ligne) => {
        if (ligne.id !== id) return ligne;
        // Montant pré-rempli (jamais tapé à la main) : on le recalcule pour le NOUVEAU moyen à
        // partir du montant exact — espèces -> TWINT repasse de 109.45 à 109.44, et inversement.
        if (ligne.exactCentimes !== null) {
          const { montantCentimes, ecartArrondiCentimes } = montantPourMoyen(
            ligne.exactCentimes,
            moyen,
          );
          return {
            ...ligne,
            moyen,
            montantCentimes,
            ecartArrondiCentimes: ecartArrondiCentimes !== 0 ? ecartArrondiCentimes : null,
            idempotencyKey: genererCleIdempotence(),
          };
        }
        return {
          ...ligne,
          moyen,
          ecartArrondiCentimes: null,
          idempotencyKey: genererCleIdempotence(),
        };
      }),
    );
  }

  function modifierMontant(id: string, montantCentimes: number | null) {
    setLignes((valeur) =>
      valeur.map((ligne) =>
        ligne.id === id
          ? {
              ...ligne,
              montantCentimes,
              ecartArrondiCentimes: null,
              exactCentimes: null,
              idempotencyKey: genererCleIdempotence(),
            }
          : ligne,
      ),
    );
  }

  function fermer() {
    // Défensif (item 2 du correctif, testeur novice) : si une erreur a été affichée sans qu'un
    // rejeu réussi n'ait suivi, on NE SAIT PAS si la dernière tentative a réellement échoué côté
    // serveur — voir le commentaire de `LignePaiementSaisie.idempotencyKey`. Invalider les mêmes
    // clés qu'un succès plutôt que de laisser la fiche facture / la liste mentir jusqu'à ce que
    // l'utilisateur navigue manuellement, exactement le symptôme rapporté (« facture Émise » et
    // bouton « Encaisser » encore visibles après un encaissement en réalité déjà passé).
    if (encaissement.isError) {
      for (const factureId of selection) {
        void queryClient.invalidateQueries({
          queryKey: clesFacturation.documents.detail(factureId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
      void queryClient.invalidateQueries({
        queryKey: clesFacturation.documents.ouvertesClient(clientId),
      });
    }
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

    // Chaque ligne (un paiement) n'impute que SES espèces/son montant : règlement = ce qui est
    // réellement remis, et l'écart d'arrondi espèces devient une imputation `arrondi` SIGNÉE
    // (`-ecart`) — 109.44 payé 109.45 = règlement 10945 + arrondi -1. Aucun centime ne reste
    // « non imputé » (avance fantôme) et aucun règlement ne dépasse son paiement (MD-51.b).
    const imputationsParLigne = repartirImputations(
      lignes.map((ligne) => ({
        montantCentimes: ligne.montantCentimes ?? 0,
        ecartArrondiCentimes: ligne.ecartArrondiCentimes,
      })),
      factures
        .filter((facture) => selection.has(facture.id))
        .map((facture) => ({ id: facture.id, soldeCentimes: facture.soldeCentimes ?? 0 })),
    );

    // Capturés AVANT la boucle : `resteAEncaisserCentimes`/`sommeLignesCentimes`/
    // `sommeEcartsCentimes` dépendent de `lignes`/`selection`, non mutées pendant l'envoi — la
    // confirmation finale (item 3) reflète donc exactement ce que l'utilisateur a validé, pas un
    // état recalculé après coup.
    const montantTotalCollecteCentimes = Math.max(sommeLignesCentimes, 0);
    const selectionDesormaisReglee = totalSelectionneCentimes > 0 && resteAEncaisserCentimes <= 0;

    try {
      for (const [index, ligne] of lignes.entries()) {
        const entree: EntreeCreationPaiement = {
          siteId,
          dateValeur: new Date().toISOString().slice(0, 10),
          moyen: ligne.moyen,
          montantCentimes: ligne.montantCentimes as number,
          // Défaut corrigé (issue #135) : cette valeur était codée en dur `'CHF'` quelle que soit
          // la facture réglée — une facture EUR sélectionnée envoyait donc TOUJOURS un paiement
          // CHF, refusé par le serveur (`409 IMPUTATION_DEVISE_INCOHERENTE`) sans qu'aucun geste
          // de l'utilisateur n'ait pu prévenir l'échec, ni le corriger (« CHF » restait un texte
          // fixe, sans sélecteur). Décision (arbitrée en revue, pas d'écran de choix de devise) :
          // le paiement suit TOUJOURS la devise de la facture réglée, jamais une devise choisie
          // librement — le produit ne fait pas de change (`MD-50`), un paiement dans une autre
          // devise que celle du document n'est jamais une opération valide, seulement une erreur
          // de saisie à empêcher plutôt qu'à permettre puis refuser. `deviseSelectionCommune`
          // (§ plus haut) porte déjà cette règle : `undefined` uniquement pour une sélection
          // vide (avance client, RF-65, sans document à aligner — CHF par défaut, seule devise
          // que ce flux connaît aujourd'hui) puisque `selectionMultiDevises` bloque déjà la
          // saisie avant d'arriver ici pour toute sélection mixte.
          devise: deviseSelectionCommune ?? 'CHF',
          payeurClientId: clientId,
          payeurLibelle: destinataireNom ?? '',
          imputations: imputationsParLigne[index] ?? [],
        };
        // Clé STABLE portée par la ligne (voir `LignePaiementSaisie.idempotencyKey`) — plus jamais
        // régénérée ici à chaque clic : DÉFAUT CORRIGÉ (testeur novice) qui empêchait tout rejeu
        // réseau d'être reconnu comme tel par le serveur.
        await encaissement.mutateAsync({ entree, idempotencyKey: ligne.idempotencyKey });
      }
      // Confirmation EXPLICITE du succès (item 3) — remplace la fermeture silencieuse : un succès
      // et un échec ne doivent jamais se ressembler à l'écran.
      setConfirmationSucces({
        montantCentimes: montantTotalCollecteCentimes,
        devise: deviseSelectionCommune ?? 'CHF',
        regle: selectionDesormaisReglee,
      });
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
          {confirmationSucces ? (
            // Confirmation EXPLICITE du succès (item 3, testeur novice) : avant ce correctif, le
            // panneau se refermait en silence sur `fermer()`, identique visuellement à un abandon
            // — le testeur n'a découvert son premier encaissement réussi qu'en retournant à la
            // liste. Défaut corrigé (issue #63) : la clé de titre manquait réellement
            // (`facturation:encaissement.confirmationSucces`, signalée dans le commentaire
            // d'origine mais jamais posée) — le montant seul, sans texte, ne dit pas explicitement
            // ce qui vient de se passer ; `role="status"`/`aria-live="polite"` manquaient aussi,
            // donc un lecteur d'écran n'annonçait rien à l'ouverture de cette confirmation (même
            // patron que `EtatChargement`/`BoutonImprimerOr`, voir leurs régions `role="status"`).
            <section
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-3 py-8 text-center"
            >
              <CheckCircle2 aria-hidden className="h-10 w-10 text-statut-succes" />
              <p className="texte-corps font-medium text-foreground">
                {t('facturation:encaissement.confirmationSucces')}
              </p>
              <p className="texte-titre-section font-semibold text-foreground">
                {formaterMontantAvecDevise(
                  confirmationSucces.montantCentimes,
                  confirmationSucces.devise,
                )}
              </p>
              {confirmationSucces.regle ? <BadgeStatutReglement statut="regle" /> : null}
              <Button type="button" onClick={fermer} className="mt-2">
                {t('commun:actions.fermer')}
              </Button>
            </section>
          ) : (
            <>
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
                              montant: formaterMontantAvecDevise(
                                facture.soldeCentimes,
                                facture.devise,
                              ),
                            })}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {factures.length === 0 && !facturesOuvertes.isPending ? (
                  <EncartAvanceClient
                    message={t('facturation:avanceClient.aucuneFactureOuverte')}
                  />
                ) : (
                  <div className="flex items-center justify-between border-t pt-2 texte-corps font-medium">
                    <span>{t('facturation:encaissement.facturesOuvertes.totalSelectionne')}</span>
                    <span className="tabular-nums">
                      {formaterTotalSelection(totalSelectionneCentimes)}
                    </span>
                  </div>
                )}
                {/* Défaut corrigé (issue #135) : le paiement suit TOUJOURS la devise de la
                    facture réglée (voir le commentaire de `soumettre`) — une sélection mixte
                    CHF/EUR n'a donc pas de devise unique à suivre. Message explicite plutôt
                    qu'un échec serveur silencieux ou un montant total dans une devise inventée. */}
                {selectionMultiDevises ? (
                  <p className="texte-libelle text-statut-attention" role="alert">
                    {t('facturation:encaissement.facturesOuvertes.devisesMultiples')}
                  </p>
                ) : null}
              </section>

              {saisieDisponible ? (
                <>
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-1.5">
                      <h2 className="texte-libelle font-medium text-foreground">
                        {t('facturation:encaissement.lignes.titre')}
                      </h2>
                      <AideContextuelle
                        sujet={t('aide:facturation.encaissement.sujet')}
                        texte={t('aide:facturation.encaissement.texte')}
                      />
                    </div>
                    {lignes.map((ligne) => (
                      // DESIGN.md « bordure structurelle » — conservée : ligne de saisie réelle
                      // (moyen de paiement, montant, bouton « retirer ») dans un bloc qui gère
                      // l'ajout/retrait de lignes de paiement, pas un simple regroupement.
                      <div key={ligne.id} className="flex items-end gap-2 rounded-md border p-2">
                        <div className="flex flex-col gap-1.5">
                          <span className="texte-libelle text-muted-foreground">
                            {t('facturation:encaissement.lignes.moyen')}
                          </span>
                          <Select
                            value={ligne.moyen}
                            onValueChange={(valeur) =>
                              modifierMoyen(ligne.id, valeur as MoyenPaiement)
                            }
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
                          {/* Défaut corrigé (issue #135) : préfixe désormais la VRAIE devise de
                              la facture réglée (`deviseSelectionCommune`) au lieu du défaut
                              `CHF` figé de `ChampMontant` — un texte mort sur une sélection EUR,
                              qui laissait croire à un paiement en francs sur une facture en
                              euros. `undefined` uniquement pour l'avance client (aucune facture
                              sélectionnée, § commentaire de `soumettre`), repli CHF alors
                              inchangé. */}
                          <ChampMontant
                            valeurCentimes={ligne.montantCentimes}
                            onChangeCentimes={(centimes) => modifierMontant(ligne.id, centimes)}
                            label={t('facturation:encaissement.lignes.montant')}
                            devise={deviseSelectionCommune}
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
                      message={t('facturation:avanceClient.excedent', {
                        excedent: formaterTotalSelection(tropPercuCentimes),
                        solde: formaterTotalSelection(totalSelectionneCentimes),
                      })}
                    />
                  ) : null}

                  {/* Paiement partiel : un montant saisi inférieur au solde est un choix légitime
                      (acompte, règlement en deux fois) — dit tel quel, pour ne pas être pris pour
                      une erreur ni pour un solde réglé. */}
                  {lignes.length > 0 &&
                  totalSelectionneCentimes > 0 &&
                  resteAEncaisserCentimes > 0 &&
                  sommeLignesCentimes > 0 ? (
                    <EncartAvanceClient
                      message={t('facturation:encaissement.paiementPartiel', {
                        reste: formaterTotalSelection(resteAEncaisserCentimes),
                      })}
                    />
                  ) : null}

                  <div className="flex items-center justify-between border-t pt-3 texte-corps font-semibold">
                    <span>{t('facturation:encaissement.resteAEncaisser')}</span>
                    <span className="tabular-nums">
                      {formaterTotalSelection(Math.max(resteAEncaisserCentimes, 0))}
                    </span>
                  </div>

                  {encaissement.isError ? (
                    <p className="texte-libelle text-destructive">
                      {messageErreur(encaissement.error, t)}
                    </p>
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
                </>
              ) : (
                // Défaut corrigé (issues #80/#61, voir le commentaire de `avanceConfirmee`) : aucune
                // facture ouverte pour ce client — la saisie d'encaissement reste VERROUILLÉE tant
                // que l'utilisateur n'a pas choisi, explicitement, d'enregistrer une avance. Le seul
                // autre geste possible d'ici est d'annuler — jamais une saisie qui déboucherait sur
                // une avance sans que ce mot ait été prononcé par un clic.
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={fermer}>
                    {t('commun:actions.annuler')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAvanceConfirmee(true)}
                  >
                    {t('facturation:avanceClient.confirmerAction')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
