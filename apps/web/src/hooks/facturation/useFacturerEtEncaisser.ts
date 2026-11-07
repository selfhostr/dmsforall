import { useRef, useState } from 'react';

import {
  schemaEmissionDocumentVente,
  type CodeConfirmation,
  type EntreeFacturationOrdreReparation,
  type MoyenPaiement,
  type ReponseDocumentVente,
} from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { genererCleIdempotence } from '@/api/idempotence';
import { afficherToastSucces } from '@/composants/motifs/toast-succes';
import i18n from '@/i18n';

import { montantPourMoyen } from './montant-encaissement';
import { useEmettreDocumentVente } from './useEmettreDocumentVente';
import { useEncaissement } from './useEncaissement';
import { useFacturerOrdreReparation } from './useFacturerOrdreReparation';

/** Moyens proposés au comptoir : les trois gestes courants, plus « le client paiera plus tard »
 *  (facture émise, aucun encaissement). */
export const CHOIX_PAIEMENT_COMPTOIR = ['especes', 'carte', 'twint', 'plus_tard'] as const;
export type ChoixPaiementComptoir = (typeof CHOIX_PAIEMENT_COMPTOIR)[number];

export type EtapeFacturerEncaisser = 'facturation' | 'emission' | 'encaissement';

export interface ResultatFacturerEncaisser {
  readonly document: ReponseDocumentVente;
  /** Montant réellement encaissé (centimes) ; `null` si « le client paiera plus tard ». */
  readonly encaisseCentimes: number | null;
  readonly moyen: MoyenPaiement | null;
}

export interface ErreurEtape {
  readonly etape: EtapeFacturerEncaisser;
  readonly erreur: unknown;
}

export interface FacturerEtEncaisser {
  readonly enCours: boolean;
  /** Étape en vol (ou celle qui vient d'échouer, tant qu'on n'a pas relancé). */
  readonly etape: EtapeFacturerEncaisser | null;
  readonly erreur: ErreurEtape | null;
  /** Facture déjà créée (étape 1 réussie) : un rejeu la REPREND, il ne la recrée jamais. */
  readonly facture: ReponseDocumentVente | null;
  readonly confirmationsRequises: readonly CodeConfirmation[];
  readonly erreurConfirmation: ErreurApi | null;
  readonly resultat: ResultatFacturerEncaisser | null;
  readonly lancer: (
    orId: string,
    entree: EntreeFacturationOrdreReparation,
    choix: ChoixPaiementComptoir,
  ) => Promise<void>;
  /** Rejeu après accord explicite sur `confirmationsRequises` (clé d'idempotence régénérée : les
   *  confirmations entrent dans l'empreinte du corps). */
  readonly confirmerEtRelancer: () => Promise<void>;
  readonly reinitialiser: () => void;
}

interface Demande {
  readonly orId: string;
  readonly entree: EntreeFacturationOrdreReparation;
  readonly choix: ChoixPaiementComptoir;
}

/**
 * « Facturer et encaisser » : enchaîne `POST /ordres-reparation/{id}/facturer`, `POST
 * /documents-vente/{id}/emettre` puis `POST /paiements` en un geste, avec les mutations existantes.
 *
 * Reprise propre : la progression vit dans des refs (lues de façon SYNCHRONE au rejeu). Une étape
 * réussie n'est jamais rejouée — la facture déjà créée est reprise, déjà émise elle n'est pas
 * réémise. Chaque étape garde sa clé d'idempotence tant qu'elle n'a pas réussi ; la clé du
 * paiement change seulement si le moyen change (contenu différent = requête distincte).
 *
 * Le montant encaissé est calculé sur le solde RÉEL de la facture émise (jamais sur une estimation
 * affichée avant) : espèces arrondies au 5 ct, autres moyens au centime près (`montantPourMoyen`).
 */
export function useFacturerEtEncaisser(): FacturerEtEncaisser {
  const facturation = useFacturerOrdreReparation();
  const emission = useEmettreDocumentVente({ succes: null });
  const encaissement = useEncaissement({ silencieux: true });

  const [enCours, setEnCours] = useState(false);
  const [etape, setEtape] = useState<EtapeFacturerEncaisser | null>(null);
  const [erreur, setErreur] = useState<ErreurEtape | null>(null);
  const [facture, setFacture] = useState<ReponseDocumentVente | null>(null);
  const [resultat, setResultat] = useState<ResultatFacturerEncaisser | null>(null);

  const cleFacturation = useRef(genererCleIdempotence());
  const cleEmission = useRef(genererCleIdempotence());
  const clePaiement = useRef<{ moyen: MoyenPaiement; cle: string } | null>(null);
  const factureRef = useRef<ReponseDocumentVente | null>(null);
  const emiseRef = useRef<ReponseDocumentVente | null>(null);
  const paiementFaitRef = useRef(false);
  const derniereDemande = useRef<Demande | null>(null);
  const confirmationsFacturation = useRef<readonly CodeConfirmation[]>([]);
  const confirmationsEmission = useRef<readonly CodeConfirmation[]>([]);

  async function executer(demande: Demande): Promise<void> {
    derniereDemande.current = demande;
    setEnCours(true);
    setErreur(null);
    let etapeCourante: EtapeFacturerEncaisser = 'facturation';
    try {
      if (!factureRef.current) {
        etapeCourante = 'facturation';
        setEtape(etapeCourante);
        const reponse = await facturation.mutateAsync({
          orId: demande.orId,
          entree: { ...demande.entree, confirmations: [...confirmationsFacturation.current] },
          idempotencyKey: cleFacturation.current,
        });
        const creee = reponse.donnees.facturesCreees[0];
        if (!creee) throw new Error('Aucune facture créée par POST /ordres-reparation/facturer.');
        factureRef.current = creee;
        setFacture(creee);
      }

      if (!emiseRef.current) {
        etapeCourante = 'emission';
        setEtape(etapeCourante);
        const entreeEmission = schemaEmissionDocumentVente.parse({
          confirmations: [...confirmationsEmission.current],
        });
        const reponse = await emission.mutateAsync({
          id: factureRef.current.id,
          entree: entreeEmission,
          idempotencyKey: cleEmission.current,
        });
        emiseRef.current = reponse.donnees;
        setFacture(reponse.donnees);
      }

      const emise = emiseRef.current;
      if (demande.choix === 'plus_tard') {
        setResultat({ document: emise, encaisseCentimes: null, moyen: null });
        afficherToastSucces({ message: i18n.t('commun:toasts.factureEmise') });
        return;
      }

      etapeCourante = 'encaissement';
      setEtape(etapeCourante);
      const moyen: MoyenPaiement = demande.choix;
      const soldeCentimes = emise.soldeCentimes ?? emise.totalTtcCentimes;
      if (soldeCentimes === undefined) {
        throw new Error(
          'Montant de la facture indisponible pour ce rôle : encaissement impossible.',
        );
      }
      let encaisseCentimes = 0;
      if (soldeCentimes > 0 && !paiementFaitRef.current) {
        const { montantCentimes } = montantPourMoyen(soldeCentimes, moyen);
        if (clePaiement.current?.moyen !== moyen) {
          clePaiement.current = { moyen, cle: genererCleIdempotence() };
        }
        await encaissement.mutateAsync({
          entree: {
            siteId: emise.siteId,
            dateValeur: new Date().toISOString().slice(0, 10),
            moyen,
            montantCentimes,
            devise: emise.devise,
            payeurClientId: emise.clientId,
            payeurLibelle: emise.figees.clientDesignation,
            // Imputation au solde EXACT : l'éventuel écart d'arrondi espèces est celui du paiement,
            // pas une avance (même règle que `SheetEncaissement`).
            imputations: [
              { documentId: emise.id, montantCentimes: soldeCentimes, nature: 'reglement' },
            ],
          },
          idempotencyKey: clePaiement.current.cle,
        });
        paiementFaitRef.current = true;
        encaisseCentimes = montantCentimes;
      }
      setResultat({ document: emise, encaisseCentimes, moyen });
      afficherToastSucces({ message: i18n.t('commun:toasts.factureEncaissee') });
    } catch (cause) {
      setErreur({ etape: etapeCourante, erreur: cause });
    } finally {
      setEnCours(false);
    }
  }

  const erreurApi = erreur?.erreur instanceof ErreurApi ? erreur.erreur : null;
  const confirmationsRequises = erreurApi?.confirmationsRequises ?? [];

  async function lancer(
    orId: string,
    entree: EntreeFacturationOrdreReparation,
    choix: ChoixPaiementComptoir,
  ) {
    await executer({ orId, entree, choix });
  }

  async function confirmerEtRelancer() {
    const demande = derniereDemande.current;
    if (!demande || !erreur || confirmationsRequises.length === 0) return;
    if (erreur.etape === 'emission') {
      confirmationsEmission.current = [...confirmationsRequises];
      cleEmission.current = genererCleIdempotence();
    } else {
      confirmationsFacturation.current = [...confirmationsRequises];
      cleFacturation.current = genererCleIdempotence();
    }
    await executer(demande);
  }

  function reinitialiser() {
    cleFacturation.current = genererCleIdempotence();
    cleEmission.current = genererCleIdempotence();
    clePaiement.current = null;
    factureRef.current = null;
    emiseRef.current = null;
    paiementFaitRef.current = false;
    derniereDemande.current = null;
    confirmationsFacturation.current = [];
    confirmationsEmission.current = [];
    setEnCours(false);
    setEtape(null);
    setErreur(null);
    setFacture(null);
    setResultat(null);
  }

  return {
    enCours,
    etape,
    erreur: confirmationsRequises.length > 0 ? null : erreur,
    facture,
    confirmationsRequises,
    erreurConfirmation: confirmationsRequises.length > 0 ? erreurApi : null,
    resultat,
    lancer,
    confirmerEtRelancer,
    reinitialiser,
  };
}
