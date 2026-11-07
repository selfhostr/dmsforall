import { Inject, Injectable } from '@nestjs/common';
import type {
  Avertissement,
  EntreeFacturerEtEncaisserOr,
  ReponseAvecAvertissements,
  ReponseFacturerEtEncaisserOr,
  ReponsePaiement,
} from '@dfa/shared';

import { MATRICE_DROITS } from '../auth/matrice-droits';
import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';
import {
  avertissementsSansQr,
  ServiceEmissionDocument,
} from '../facturation/documents/service-emission';
import { ServiceDocumentsVente } from '../facturation/documents/service-documents';
import { ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES } from '../facturation/paiements/arrondi-especes';
import {
  chargerArrondiEspecesActif,
  chargerDocumentPourEcriture,
} from '../facturation/paiements/paiement-requetes';
import { ServicePaiement } from '../facturation/paiements/service-paiement';

import { ServiceFacturationOr } from './service-facturation-or';
import { ServiceOr } from './service-or';

type MoyenRapide = NonNullable<EntreeFacturerEtEncaisserOr['paiement']>['mode'];

/**
 * Montants d'un encaissement rapide pour un solde donné (fonction pure, testée seule).
 *
 * Arrondi au 5 centimes — espèces SEULEMENT, paramètre tenant actif, et seulement quand on encaisse
 * le solde exact : le modèle d'imputation (`imputations.ts`, `verifierArrondiEspeces`) n'admet qu'un
 * arrondi POSITIF de 1 ou 2 ct (le garage fait cadeau de l'écart : règlement + arrondi = total).
 * Solde se terminant par 1/2 ct (modulo 5) -> règlement = solde - écart, arrondi = écart. Se
 * terminant par 3/4 ct -> un arrondi « vers le haut » n'est pas représentable : on encaisse le
 * solde exact, sans arrondi (ambiguïté de contrat signalée au rapport, rien d'inventé).
 */
export function calculerEncaissementRapide(
  soldeCentimes: number,
  mode: MoyenRapide,
  montantDemandeCentimes: number | undefined,
  arrondiEspecesActif: boolean,
): { readonly reglementCentimes: number; readonly arrondiCentimes: number } {
  const montant = montantDemandeCentimes ?? soldeCentimes;
  const encaisseLeSolde = montant === soldeCentimes;
  if (mode === 'especes' && arrondiEspecesActif && encaisseLeSolde) {
    const ecart = soldeCentimes % 5;
    if (ecart >= 1 && ecart <= ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES && soldeCentimes > ecart) {
      return { reglementCentimes: soldeCentimes - ecart, arrondiCentimes: ecart };
    }
  }
  return { reglementCentimes: montant, arrondiCentimes: 0 };
}

/**
 * `POST /ordres-reparation/{orId}/facturer-et-encaisser` — contrat : `@dfa/shared`,
 * `facturation/facturer-et-encaisser-or.ts` (lire son en-tête).
 *
 * Une transaction : création du brouillon (`ServiceFacturationOr.facturerTx`, groupe `client`),
 * émission (`emettreCoeurDetailleTx`, droit d'émission vérifié par le cœur), puis encaissement dans
 * un SAVEPOINT — un échec d'encaissement n'annule ni la facture ni l'émission.
 */
@Injectable()
export class ServiceFacturationEncaissementOr {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
    private readonly facturation: ServiceFacturationOr,
    private readonly emission: ServiceEmissionDocument,
    private readonly paiements: ServicePaiement,
    private readonly documents: ServiceDocumentsVente,
    private readonly serviceOr: ServiceOr,
  ) {}

  async facturerEtEncaisser(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeFacturerEtEncaisserOr,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseFacturerEtEncaisserOr> }
    >
  > {
    // Droit d'encaisser vérifié AVANT tout effet de bord, seulement si un encaissement est demandé
    // (la route porte `facturation.document.creer`, l'émission son propre droit dans le cœur).
    if (
      entree.paiement &&
      !(MATRICE_DROITS[principal.role] ?? []).includes('facturation.paiement.creer')
    ) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        `Le rôle "${principal.role}" n'a pas le droit d'encaisser (facturation.paiement.creer).`,
      );
    }

    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/ordres-reparation/:orId/facturer-et-encaisser',
        cle: cleIdempotence,
        corps: { orId, ...entree },
      },
      async (tx) => {
        const { facturesCreees } = await this.facturation.facturerTx(tx, ctx, principal, orId, {
          groupes: [{ payeur: 'client' }],
          motifsReport: [],
          confirmations: entree.confirmations,
        });
        const brouillon = facturesCreees[0];
        if (!brouillon || facturesCreees.length !== 1) {
          throw new ErreurMetier('ERREUR_INTERNE', 'La facturation du groupe client a échoué.');
        }

        const { document: emise, sansQr } = await this.emission.emettreCoeurDetailleTx(
          tx,
          ctx,
          principal,
          brouillon.id,
        );
        const avertissements: Avertissement[] = [...avertissementsSansQr(emise.id, sansQr)];

        let paiement: ReponsePaiement | undefined;
        if (entree.paiement) {
          const demande = entree.paiement;
          try {
            paiement = await tx.transaction((savepoint) =>
              this.encaisser(savepoint, ctx, emise.id, demande),
            );
          } catch (erreur) {
            if (!(erreur instanceof ErreurMetier)) throw erreur;
            avertissements.push({
              code: 'ENCAISSEMENT_ECHOUE',
              message: `Facture émise, mais l'encaissement a échoué : ${erreur.message}`,
              donnees: { factureId: emise.id, codeErreur: erreur.code },
            });
          }
        }

        const facture = await this.documents.assemblerDocument(tx, ctx, principal.role, emise.id);
        const ordreReparation = await this.serviceOr.assemblerDocument(
          tx,
          ctx,
          principal.role,
          orId,
        );
        return {
          statutHttp: 201,
          corps: {
            donnees: { facture, ...(paiement ? { paiement } : {}), ordreReparation },
            avertissements,
          },
        };
      },
    );
  }

  private async encaisser(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    factureId: string,
    demande: NonNullable<EntreeFacturerEtEncaisserOr['paiement']>,
  ): Promise<ReponsePaiement> {
    const doc = await chargerDocumentPourEcriture(tx, ctx, factureId);
    const solde = Number(doc.totalTtcCentimes - doc.montantRegleCentimes);
    if (solde <= 0) {
      throw new ErreurMetier('CONFLIT', 'La facture est déjà soldée : rien à encaisser.');
    }
    if (demande.montantCentimes !== undefined && demande.montantCentimes > solde) {
      throw new ErreurMetier(
        'IMPUTATION_MONTANT_EXCEDENTAIRE',
        'Le montant demandé dépasse le solde de la facture.',
      );
    }
    const arrondiActif =
      demande.mode === 'especes' ? await chargerArrondiEspecesActif(tx, ctx) : false;
    const { reglementCentimes, arrondiCentimes } = calculerEncaissementRapide(
      solde,
      demande.mode,
      demande.montantCentimes,
      arrondiActif,
    );

    return this.paiements.creerTx(tx, ctx, {
      siteId: doc.siteId,
      dateValeur: this.horloge.maintenant().toISOString().slice(0, 10),
      moyen: demande.mode,
      montantCentimes: reglementCentimes,
      devise: doc.devise,
      payeurClientId: doc.clientId,
      payeurLibelle: doc.clientDesignationFigee,
      imputations: [
        { documentId: doc.id, montantCentimes: reglementCentimes, nature: 'reglement' },
        ...(arrondiCentimes > 0
          ? [{ documentId: doc.id, montantCentimes: arrondiCentimes, nature: 'arrondi' as const }]
          : []),
      ],
    });
  }
}
