import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  EntreeCreationOrdreDepuisDevis,
  EntreeCreationOrdreReparation,
  ReponseAvecAvertissements,
  ReponseCreationOrdreDepuisDevis,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  ligneDocument,
  ligneOr,
  ordreReparation,
  type LigneDocumentVente,
  type LigneLigneDocument,
} from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';
import { chargerDocumentOuNull } from '../facturation/documents/document-requetes';
import { ServiceEmissionDocument } from '../facturation/documents/service-emission';

import { ServiceOr } from './service-or';

type TypeLigneOrInsere = typeof ligneOr.$inferInsert.type;

/** Types de ligne de document qui ont un équivalent de ligne d'OR (mêmes noms de part et d'autre). */
const TYPES_REPRENABLES: ReadonlySet<string> = new Set<TypeLigneOrInsere>([
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
  'forfait',
  'piece',
  'fourniture',
  'sous_traitance',
  'produit_atelier',
  'taxe',
  'texte',
]);

const TYPES_MAIN_OEUVRE: ReadonlySet<string> = new Set([
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
]);

export interface LigneOrDepuisDevis {
  readonly type: TypeLigneOrInsere;
  readonly designation: string;
  readonly referenceTexte: string | null;
  readonly quantiteMillieme: number;
  /** HT net par unité (remise de ligne et remise globale comprises), arrondi au centime. */
  readonly prixUnitaireCentimes: number | null;
  readonly tempsBaremeCentiemes: number | null;
  readonly tauxHoraireCentimes: number | null;
  readonly tauxTvaPourmille: number;
  readonly montantHtCentimes: number;
  readonly montantTvaCentimes: number;
  readonly montantTtcCentimes: number;
}

/**
 * Convertit UNE ligne de devis en ligne d'OR. Les MONTANTS de la ligne (HT / TVA / TTC) sont
 * recopiés tels quels du devis — jamais recalculés, c'est ce qui fige le prix accepté par le
 * client (RM-65). Le prix unitaire d'OR (HT, par unité) n'est qu'un reflet lisible : le net du
 * devis divisé par la quantité.
 *
 * Main-d'œuvre : l'OR veut un temps (centièmes d'heure) et un taux horaire ; le devis une quantité
 * (millièmes d'heure) et un prix. `temps = quantité / 10`, `taux = net HT par heure`.
 *
 * @throws ErreurMetier `CONFLIT` (`ligne_non_reprenable`) pour un type sans équivalent d'OR.
 */
export function convertirLigneDevisEnLigneOr(ligne: {
  readonly typeLigne: string;
  readonly designation: string;
  readonly referenceTexte: string | null;
  readonly quantiteMillieme: number;
  readonly tauxTvaPourmille: number;
  readonly htCentimes: number;
  readonly tvaCentimes: number;
  readonly ttcCentimes: number;
}): LigneOrDepuisDevis {
  if (!TYPES_REPRENABLES.has(ligne.typeLigne)) {
    throw new ErreurMetier(
      'CONFLIT',
      `La ligne « ${ligne.designation} » (${ligne.typeLigne}) n'a pas d'équivalent dans un ordre de réparation.`,
      {
        erreurs: [
          {
            champ: 'lignes',
            code: 'ligne_non_reprenable',
            message: `Une ligne « ${ligne.typeLigne} » ne peut pas être reprise dans un OR.`,
          },
        ],
      },
    );
  }
  const estTexte = ligne.typeLigne === 'texte';
  const net =
    estTexte || ligne.quantiteMillieme === 0
      ? null
      : Math.round((ligne.htCentimes * 1000) / ligne.quantiteMillieme);
  const estMo = TYPES_MAIN_OEUVRE.has(ligne.typeLigne);
  return {
    type: ligne.typeLigne as TypeLigneOrInsere,
    designation: ligne.designation,
    referenceTexte: ligne.referenceTexte,
    quantiteMillieme: ligne.quantiteMillieme,
    prixUnitaireCentimes: estMo ? null : net,
    tempsBaremeCentiemes: estMo ? Math.round(ligne.quantiteMillieme / 10) : null,
    tauxHoraireCentimes: estMo ? (net ?? 0) : null,
    tauxTvaPourmille: ligne.tauxTvaPourmille,
    montantHtCentimes: ligne.htCentimes,
    montantTvaCentimes: ligne.tvaCentimes,
    montantTtcCentimes: ligne.ttcCentimes,
  };
}

/** Dérive de la clé du client une clé d'idempotence (uuid v4) STABLE pour la création de l'OR : le
 *  rejeu de la même requête retrouve le même OR au lieu d'en créer un second. */
export function deriverCleIdempotenceOr(cle: string): string {
  const h = createHash('sha256').update(`devis-vers-or:${cle}`).digest();
  const o = Uint8Array.from(h.subarray(0, 16));
  o[6] = ((o[6] ?? 0) & 0x0f) | 0x40;
  o[8] = ((o[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(o).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function conflitDevis(message: string, code: string, champ: string): ErreurMetier {
  return new ErreurMetier('CONFLIT', message, {
    erreurs: [{ champ, code, message }],
    actionsProposees: [{ code: 'RAFRAICHIR' }],
  });
}

/**
 * `POST /documents-vente/{id}/creer-ordre-reparation` — devis -> OR. Voir
 * `@dfa/shared` `document-ordre-reparation.ts` pour le contrat.
 *
 * Déroulé (une transaction applicative `A` sous `ServiceIdempotence.executer`) :
 *  1. verrou consultatif par devis : deux appels concurrents (clés différentes) se sérialisent, le
 *     second voit le lien posé par le premier ;
 *  2. gardes lecture seule : type, véhicule, devise CHF, état, lignes reprenables, devis pas déjà
 *     transformé ;
 *  3. devis `emis` -> `accepte` (`ServiceEmissionDocument.accepter`, sa propre transaction) ;
 *  4. création de l'OR par `ServiceOr.creer` (numérotation, snapshot, confirmations RM-49/50/51 :
 *     rien de dupliqué), sous une clé d'idempotence DÉRIVÉE de celle du client ;
 *  5. dans `A` : lignes d'OR (statut `validee`, origine `commandee`, montants recopiés), puis lien
 *     `ordre_reparation.devis_origine_id` (index unique : un devis ne crée qu'un OR).
 *
 * Étapes 3-4 s'exécutent hors de `A` (autres connexions) : si `A` échoue ensuite, ce qu'elles ont
 * validé reste (devis accepté, OR créé SANS ligne). Un rejeu avec la MÊME clé retrouve cet OR
 * (étape 4 idempotente) et le complète ; avec une AUTRE clé il en créerait un second — cas limité
 * à une panne base entre 4 et 5, signalé plutôt que masqué.
 */
@Injectable()
export class ServiceDevisVersOr {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly serviceOr: ServiceOr,
    private readonly serviceEmission: ServiceEmissionDocument,
  ) {}

  async creerOrdreReparation(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    devisId: string,
    entree: EntreeCreationOrdreDepuisDevis,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseCreationOrdreDepuisDevis> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/documents-vente/:id/creer-ordre-reparation',
        cle: cleIdempotence,
        corps: { devisId, ...entree },
      },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`devis-vers-or:${devisId}`}, 0))`,
        );

        const devis = await chargerDocumentOuNull(tx, ctx, devisId, false);
        if (!devis) {
          throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Devis ${devisId} introuvable.`);
        }
        const lignesDevis = await tx
          .select()
          .from(ligneDocument)
          .where(
            and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.documentId, devisId)),
          )
          .orderBy(asc(ligneDocument.numeroOrdre));
        const lignesOr = this.garantirTransformable(devis, lignesDevis);
        await this.garantirPasDejaTransforme(tx, ctx, devisId);

        const totalTtc = lignesOr.reduce((s, l) => s + l.montantTtcCentimes, 0);
        if (entree.plafondCentimes !== undefined && entree.plafondCentimes < totalTtc) {
          throw new ErreurMetier(
            'VALIDATION_ECHOUEE',
            'Le plafond demandé est inférieur au total du devis accepté.',
            {
              erreurs: [
                {
                  champ: 'plafondCentimes',
                  code: 'plafond_inferieur_devis',
                  message: `Le devis totalise ${String(totalTtc)} centimes TTC ; le plafond de l'OR ne peut pas être plus bas.`,
                },
              ],
            },
          );
        }

        if (devis.statut === 'emis') {
          await this.serviceEmission.accepter(ctx, principal, devisId);
        }

        const entreeOr: EntreeCreationOrdreReparation = {
          ...entree,
          siteId: entree.siteId ?? devis.siteId,
          type: entree.type ?? 'reparation',
          clientId: devis.clientId,
          // `garantirTransformable` a refusé un devis sans véhicule.
          vehiculeId: devis.vehiculeId as string,
        };
        const creation = await this.serviceOr.creer(
          ctx,
          principal,
          entreeOr,
          deriverCleIdempotenceOr(cleIdempotence),
        );
        const orId = creation.reponse.corps.donnees.id;

        await this.reprendreLignes(tx, ctx, orId, lignesOr);
        await tx
          .update(ordreReparation)
          .set({ devisOrigineId: devisId })
          .where(and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.id, orId)));

        const document = await this.serviceOr.assemblerDocument(tx, ctx, principal.role, orId);
        return {
          statutHttp: 201,
          corps: {
            donnees: {
              ordreReparation: document,
              devisId,
              devisStatut: 'accepte' as const,
              nombreLignesReprises: lignesOr.length,
            },
            avertissements: creation.reponse.corps.avertissements,
          },
        };
      },
    );
  }

  private garantirTransformable(
    devis: LigneDocumentVente,
    lignes: readonly LigneLigneDocument[],
  ): readonly LigneOrDepuisDevis[] {
    if (devis.typeDocument !== 'devis') {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Seul un devis peut créer un ordre de réparation.',
        {
          erreurs: [
            {
              champ: 'typeDocument',
              code: 'type_invalide',
              message: `« ${devis.typeDocument} » ne peut pas créer d'OR.`,
            },
          ],
        },
      );
    }
    if (devis.statut !== 'emis' && devis.statut !== 'accepte') {
      throw conflitDevis(
        devis.statut === 'brouillon'
          ? "Le devis est encore un brouillon : émettez-le avant d'en faire un ordre de réparation."
          : `Un devis « ${devis.statut} » ne peut pas devenir un ordre de réparation.`,
        'etat_devis_incompatible',
        'statut',
      );
    }
    if (devis.vehiculeId === null) {
      throw conflitDevis(
        "Le devis n'a pas de véhicule : un ordre de réparation en exige un.",
        'vehicule_requis',
        'vehiculeId',
      );
    }
    if (devis.devise !== 'CHF') {
      throw conflitDevis(
        `Le devis est en ${devis.devise} : un ordre de réparation se tient en CHF.`,
        'devise_non_chf',
        'devise',
      );
    }
    return lignes.map(convertirLigneDevisEnLigneOr);
  }

  private async garantirPasDejaTransforme(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    devisId: string,
  ): Promise<void> {
    const [existant] = await tx
      .select({ id: ordreReparation.id, numero: ordreReparation.numero })
      .from(ordreReparation)
      .where(
        and(
          eq(ordreReparation.tenantId, ctx.tenantId),
          eq(ordreReparation.devisOrigineId, devisId),
        ),
      )
      .limit(1);
    if (existant) {
      throw new ErreurMetier(
        'DOCUMENT_SOURCE_DEJA_TRANSFORME',
        `Ce devis a déjà créé l'ordre de réparation ${existant.numero}.`,
        {
          blocages: [{ type: 'ordre_reparation', id: existant.id, libelle: existant.numero }],
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        },
      );
    }
  }

  /** Insère les lignes d'OR du devis — uniquement si l'OR n'en a aucune (rejeu après panne). */
  private async reprendreLignes(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    orId: string,
    lignes: readonly LigneOrDepuisDevis[],
  ): Promise<void> {
    const [deja] = await tx
      .select({ id: ligneOr.id })
      .from(ligneOr)
      .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.ordreReparationId, orId)))
      .limit(1);
    if (deja) return;

    let numeroOrdre = 0;
    for (const l of lignes) {
      numeroOrdre += 1;
      await tx.insert(ligneOr).values({
        tenantId: ctx.tenantId,
        ordreReparationId: orId,
        numeroOrdre,
        type: l.type,
        // Le client a accepté le devis : ces lignes sont des travaux COMMANDÉS et déjà VALIDÉS.
        origine: 'commandee',
        statut: 'validee',
        payeur: 'client',
        blocage: 'aucun',
        designation: l.designation,
        referenceTexte: l.referenceTexte,
        quantiteMillieme: l.quantiteMillieme,
        tempsBaremeCentiemes: l.tempsBaremeCentiemes,
        tauxHoraireCentimes: l.tauxHoraireCentimes,
        prixUnitaireCentimes: l.prixUnitaireCentimes,
        rabaisPourmille: 0,
        tauxTvaPourmille: l.tauxTvaPourmille,
        montantHtCentimes: l.montantHtCentimes,
        montantTvaCentimes: l.montantTvaCentimes,
        montantTtcCentimes: l.montantTtcCentimes,
      });
    }
  }
}
