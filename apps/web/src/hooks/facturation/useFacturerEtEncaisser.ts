import { useRef, useState } from 'react';

import type {
  CodeConfirmation,
  EntreeFacturerEtEncaisserOr,
  MoyenPaiement,
  ReponseDocumentVente,
} from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { afficherToastSucces } from '@/composants/motifs/toast-succes';
import i18n from '@/i18n';

import { facturerEtEncaisserOr } from './facturer-et-encaisser.api';
import { montantPourMoyen, repartirImputations } from './montant-encaissement';
import { useEncaissement } from './useEncaissement';

/** Moyens proposés au comptoir : les trois gestes courants, plus « le client paiera plus tard »
 *  (facture émise, aucun encaissement). */
export const CHOIX_PAIEMENT_COMPTOIR = ['especes', 'carte', 'twint', 'plus_tard'] as const;
export type ChoixPaiementComptoir = (typeof CHOIX_PAIEMENT_COMPTOIR)[number];

export interface ResultatFacturerEncaisser {
  readonly document: ReponseDocumentVente;
  /** Montant réellement encaissé (centimes), tel que le SERVEUR le rend (arrondi espèces compris) ;
   *  `null` si « le client paiera plus tard » ou si l'encaissement a échoué. */
  readonly encaisseCentimes: number | null;
  readonly moyen: MoyenPaiement | null;
  /** Facture émise mais encaissement refusé (`ENCAISSEMENT_ECHOUE`) : « Encaisser maintenant ». */
  readonly encaissementEchoue: boolean;
}

export interface FacturerEtEncaisser {
  readonly enCours: boolean;
  readonly erreur: unknown;
  readonly confirmationsRequises: readonly CodeConfirmation[];
  readonly erreurConfirmation: ErreurApi | null;
  readonly resultat: ResultatFacturerEncaisser | null;
  /** Erreur du rattrapage « Encaisser maintenant ». */
  readonly erreurEncaissement: unknown;
  readonly lancer: (orId: string, choix: ChoixPaiementComptoir) => Promise<void>;
  /** Rejeu après accord explicite sur `confirmationsRequises` (clé d'idempotence régénérée : les
   *  confirmations entrent dans l'empreinte du corps). */
  readonly confirmerEtRelancer: () => Promise<void>;
  /** Encaisse le solde d'une facture déjà émise dont l'encaissement a échoué. */
  readonly encaisserMaintenant: () => Promise<void>;
  readonly reinitialiser: () => void;
}

interface Demande {
  readonly orId: string;
  readonly choix: ChoixPaiementComptoir;
}

/**
 * « Facturer et encaisser » : UN appel `POST /ordres-reparation/{id}/facturer-et-encaisser` avec une
 * `Idempotency-Key` (création + émission atomiques côté serveur, encaissement en savepoint).
 *
 * La clé reste la même pour un rejeu à l'identique (échec réseau) et change quand le corps change
 * (autre moyen, confirmations). Le serveur calcule l'arrondi espèces : on n'affiche que le montant
 * qu'il rend. Si l'encaissement échoue seul, la facture reste émise (`ENCAISSEMENT_ECHOUE`) et
 * `encaisserMaintenant` rattrape via `POST /paiements`.
 */
export function useFacturerEtEncaisser(): FacturerEtEncaisser {
  const encaissement = useEncaissement({ silencieux: true });

  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [erreurEncaissement, setErreurEncaissement] = useState<unknown>(null);
  const [resultat, setResultat] = useState<ResultatFacturerEncaisser | null>(null);

  const cle = useRef<{ empreinte: string; valeur: string } | null>(null);
  const derniereDemande = useRef<Demande | null>(null);
  const confirmations = useRef<readonly CodeConfirmation[]>([]);
  const choixEncaissement = useRef<MoyenPaiement | null>(null);
  const clePaiement = useRef<string | null>(null);

  async function executer(demande: Demande): Promise<void> {
    derniereDemande.current = demande;
    setEnCours(true);
    setErreur(null);
    try {
      const entree: EntreeFacturerEtEncaisserOr = {
        ...(demande.choix === 'plus_tard' ? {} : { paiement: { mode: demande.choix } }),
        ...(confirmations.current.length > 0 ? { confirmations: [...confirmations.current] } : {}),
      };
      const empreinte = `${demande.orId}|${JSON.stringify(entree)}`;
      if (cle.current?.empreinte !== empreinte) {
        cle.current = { empreinte, valeur: genererCleIdempotence() };
      }
      const reponse = await facturerEtEncaisserOr(demande.orId, entree, cle.current.valeur);
      const { facture, paiement } = reponse.donnees;
      const echec = reponse.avertissements.some((a) => a.code === 'ENCAISSEMENT_ECHOUE');
      setResultat({
        document: facture,
        encaisseCentimes: paiement?.montantCentimes ?? null,
        moyen: paiement?.moyen ?? null,
        encaissementEchoue: echec,
      });
      if (!echec) {
        afficherToastSucces({
          message: i18n.t(
            paiement ? 'commun:toasts.factureEncaissee' : 'commun:toasts.factureEmise',
          ),
        });
      }
    } catch (cause) {
      setErreur(cause);
    } finally {
      setEnCours(false);
    }
  }

  const erreurApi = erreur instanceof ErreurApi ? erreur : null;
  const confirmationsRequises = erreurApi?.confirmationsRequises ?? [];

  async function lancer(orId: string, choix: ChoixPaiementComptoir) {
    await executer({ orId, choix });
  }

  async function confirmerEtRelancer() {
    const demande = derniereDemande.current;
    if (!demande || confirmationsRequises.length === 0) return;
    confirmations.current = [...confirmationsRequises];
    await executer(demande);
  }

  async function encaisserMaintenant() {
    const emise = resultat?.document;
    const choix = derniereDemande.current?.choix;
    if (!emise || !choix || choix === 'plus_tard') return;
    setErreurEncaissement(null);
    const soldeCentimes = emise.soldeCentimes ?? emise.totalTtcCentimes;
    if (soldeCentimes === undefined || soldeCentimes <= 0) return;
    setEnCours(true);
    try {
      const { montantCentimes, ecartArrondiCentimes } = montantPourMoyen(soldeCentimes, choix);
      const [imputations = []] = repartirImputations(
        [{ montantCentimes, ecartArrondiCentimes }],
        [{ id: emise.id, soldeCentimes }],
      );
      if (choixEncaissement.current !== choix || !clePaiement.current) {
        choixEncaissement.current = choix;
        clePaiement.current = genererCleIdempotence();
      }
      await encaissement.mutateAsync({
        entree: {
          siteId: emise.siteId,
          dateValeur: new Date().toISOString().slice(0, 10),
          moyen: choix,
          montantCentimes,
          devise: emise.devise,
          payeurClientId: emise.clientId,
          payeurLibelle: emise.figees.clientDesignation,
          imputations,
        },
        idempotencyKey: clePaiement.current,
      });
      setResultat({
        ...resultat,
        encaisseCentimes: montantCentimes,
        moyen: choix,
        encaissementEchoue: false,
      });
      afficherToastSucces({ message: i18n.t('commun:toasts.factureEncaissee') });
    } catch (cause) {
      setErreurEncaissement(cause);
    } finally {
      setEnCours(false);
    }
  }

  function reinitialiser() {
    cle.current = null;
    clePaiement.current = null;
    choixEncaissement.current = null;
    derniereDemande.current = null;
    confirmations.current = [];
    setEnCours(false);
    setErreur(null);
    setErreurEncaissement(null);
    setResultat(null);
  }

  return {
    enCours,
    erreur: confirmationsRequises.length > 0 ? null : erreur,
    confirmationsRequises,
    erreurConfirmation: confirmationsRequises.length > 0 ? erreurApi : null,
    resultat,
    erreurEncaissement,
    lancer,
    confirmerEtRelancer,
    encaisserMaintenant,
    reinitialiser,
  };
}
