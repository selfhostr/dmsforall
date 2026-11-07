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
 * Espèces (paramètre tenant actif, solde exact encaissé) : le paiement est la somme réellement remise,
 * le multiple de 5 ct le plus proche du solde, dans les deux sens ; le règlement vaut ce paiement et
 * l'imputation `arrondi` SIGNÉE vaut `solde - espèces` (ex. 109.44 -> 109.45, arrondi -1 ; 109.42 ->
 * 109.40, arrondi +2), de sorte que `règlement + arrondi = solde` exactement, sans avance client.
 * Carte, TWINT, montant partiel ou arrondi désactivé : au centime exact, pas d'arrondi.
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
    const reste = soldeCentimes % 5;
    const especes = reste >= 3 ? soldeCentimes + (5 - reste) : soldeCentimes - reste;
    // Un solde minuscule (1-2 ct) arrondirait à 0 : pas de paiement nul, on garde le solde exact.
    if (reste !== 0 && especes > 0) {
      return { reglementCentimes: especes, arrondiCentimes: soldeCentimes - especes };
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
        ...(arrondiCentimes !== 0
          ? [{ documentId: doc.id, montantCentimes: arrondiCentimes, nature: 'arrondi' as const }]
          : []),
      ],
    });
  }
}
