import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  TRI_DEFAUT_CREATION,
  type DisponibiliteCourtoisie,
  type EntreeCreationPretCourtoisie,
  type EntreeCreationVehiculeCourtoisie,
  type EntreeModificationVehiculeCourtoisie,
  type EntreeRetourPretCourtoisie,
  type FiltresPretsCourtoisie,
  type FiltresVehiculesCourtoisie,
  type PageCurseur,
  type ReponsePretCourtoisie,
  type ReponseListeVehiculesCourtoisie,
  type ReponseVehiculeCourtoisie,
  type StatutPretCourtoisieUtilise,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import {
  client,
  ordreReparation,
  pretCourtoisie,
  rendezVous,
  vehiculeCourtoisie,
  type LignePretCourtoisie,
  type LigneVehiculeCourtoisie,
} from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../../common/pagination';
import { nomAfficheClient } from '../references';

/** Un prêt dont le début tombe dans cette marge est « en cours » d'emblée (décalage d'horloge). */
const TOLERANCE_DEBUT_MS = 5 * 60 * 1000;
/** Fenêtre testée quand l'appelant ne précise pas de période : « libre maintenant ? ». */
const FENETRE_DEFAUT_MS = 60 * 1000;

type LigneJointe = {
  readonly pret: LignePretCourtoisie;
  readonly vehicule: Pick<LigneVehiculeCourtoisie, 'designation' | 'plaque' | 'kilometrage'>;
  readonly client: Parameters<typeof nomAfficheClient>[0];
  readonly creeLeTexte?: string;
};

export function versReponsePret(ligne: LigneJointe, maintenant: Date): ReponsePretCourtoisie {
  const { pret } = ligne;
  return {
    id: pret.id,
    vehiculeCourtoisieId: pret.vehiculeCourtoisieId,
    vehiculeDesignation: ligne.vehicule.designation,
    vehiculePlaque: ligne.vehicule.plaque,
    clientId: pret.clientId,
    clientNom: nomAfficheClient(ligne.client),
    ordreReparationId: pret.ordreReparationId,
    rendezVousId: pret.rendezVousId,
    debutLe: pret.debutLe.toISOString(),
    finPrevueLe: pret.finPrevueLe.toISOString(),
    renduLe: pret.renduLe ? pret.renduLe.toISOString() : null,
    kmDepart: pret.kmDepart,
    kmRetour: pret.kmRetour,
    statut: pret.statut as StatutPretCourtoisieUtilise,
    enRetard: pret.statut === 'en_cours' && pret.finPrevueLe.getTime() < maintenant.getTime(),
    note: pret.note,
    creeLe: pret.creeLe.toISOString(),
  };
}

function versVehicule(
  ligne: LigneVehiculeCourtoisie,
  occupant: ReponsePretCourtoisie | null,
): ReponseVehiculeCourtoisie {
  let disponibilite: DisponibiliteCourtoisie = 'libre';
  if (ligne.etat !== 'disponible') disponibilite = 'indisponible';
  else if (occupant) disponibilite = 'occupe';
  return {
    id: ligne.id,
    designation: ligne.designation,
    plaque: ligne.plaque,
    kilometrage: ligne.kilometrage,
    etat: ligne.etat as ReponseVehiculeCourtoisie['etat'],
    note: ligne.note,
    disponibilite,
    pretSurPeriode: disponibilite === 'occupe' ? occupant : null,
  };
}

/** Fin d'occupation réelle : un prêt « en cours » non rendu occupe la voiture au-delà de sa fin prévue. */
function finEffective(maintenant: Date): SQL<Date> {
  return sql<Date>`case when ${pretCourtoisie.statut} = 'en_cours' then greatest(${pretCourtoisie.finPrevueLe}, ${maintenant.toISOString()}::timestamptz) else ${pretCourtoisie.finPrevueLe} end`;
}

function estViolationExclusion(erreur: unknown): boolean {
  const e = erreur as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23P01' || e?.cause?.code === '23P01';
}

@Injectable()
export class ServiceCourtoisie {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  /* ------------------------------ parc ------------------------------ */

  /** Parc + disponibilité sur la période (`du`/`au`, défaut : maintenant). Borné : un parc de garage. */
  async listerVehicules(
    ctx: ContexteTenant,
    filtres: FiltresVehiculesCourtoisie,
    maintenant: Date,
  ): Promise<ReponseListeVehiculesCourtoisie> {
    const du = filtres.du ? new Date(filtres.du) : maintenant;
    const au = filtres.au ? new Date(filtres.au) : new Date(du.getTime() + FENETRE_DEFAUT_MS);
    if (!(au.getTime() > du.getTime())) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'La fin de période doit suivre le début.', {
        erreurs: [{ champ: 'au', code: 'periode_invalide', message: 'Fin avant le début.' }],
      });
    }
    return this.acces.enTenant(ctx, async (tx) => {
      const parc = await tx
        .select()
        .from(vehiculeCourtoisie)
        .where(eq(vehiculeCourtoisie.tenantId, ctx.tenantId))
        .orderBy(asc(vehiculeCourtoisie.designation), asc(vehiculeCourtoisie.id))
        .limit(200);

      const occupations = await tx
        .select({ pret: pretCourtoisie, vehicule: vehiculeCourtoisie, client })
        .from(pretCourtoisie)
        .innerJoin(
          vehiculeCourtoisie,
          and(
            eq(vehiculeCourtoisie.tenantId, pretCourtoisie.tenantId),
            eq(vehiculeCourtoisie.id, pretCourtoisie.vehiculeCourtoisieId),
          ),
        )
        .innerJoin(
          client,
          and(eq(client.tenantId, pretCourtoisie.tenantId), eq(client.id, pretCourtoisie.clientId)),
        )
        .where(
          and(
            eq(pretCourtoisie.tenantId, ctx.tenantId),
            inArray(pretCourtoisie.statut, ['reserve', 'en_cours']),
            sql`${pretCourtoisie.debutLe} < ${au.toISOString()}::timestamptz`,
            sql`${finEffective(maintenant)} > ${du.toISOString()}::timestamptz`,
          ),
        )
        .orderBy(asc(pretCourtoisie.debutLe));

      const parVehicule = new Map<string, ReponsePretCourtoisie>();
      for (const o of occupations) {
        if (!parVehicule.has(o.pret.vehiculeCourtoisieId)) {
          parVehicule.set(o.pret.vehiculeCourtoisieId, versReponsePret(o, maintenant));
        }
      }
      return {
        du: du.toISOString(),
        au: au.toISOString(),
        vehicules: parc.map((v) => versVehicule(v, parVehicule.get(v.id) ?? null)),
      };
    });
  }

  async creerVehicule(
    ctx: ContexteTenant,
    entree: EntreeCreationVehiculeCourtoisie,
  ): Promise<ReponseVehiculeCourtoisie> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [cree] = await tx
        .insert(vehiculeCourtoisie)
        .values({
          tenantId: ctx.tenantId,
          designation: entree.designation,
          plaque: entree.plaque ?? null,
          kilometrage: entree.kilometrage ?? null,
          note: entree.note ?? null,
        })
        .returning();
      if (!cree) throw new ErreurMetier('ERREUR_INTERNE', 'La création du véhicule a échoué.');
      return versVehicule(cree, null);
    });
  }

  async modifierVehicule(
    ctx: ContexteTenant,
    vehiculeId: string,
    entree: EntreeModificationVehiculeCourtoisie,
  ): Promise<ReponseVehiculeCourtoisie> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [mis] = await tx
        .update(vehiculeCourtoisie)
        .set({
          designation: entree.designation,
          plaque: entree.plaque,
          kilometrage: entree.kilometrage,
          etat: entree.etat,
          note: entree.note,
        })
        .where(
          and(eq(vehiculeCourtoisie.tenantId, ctx.tenantId), eq(vehiculeCourtoisie.id, vehiculeId)),
        )
        .returning();
      if (!mis) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Véhicule de courtoisie introuvable.');
      }
      return versVehicule(mis, null);
    });
  }

  /* ------------------------------ prêts ------------------------------ */

  async listerPrets(
    ctx: ContexteTenant,
    filtres: FiltresPretsCourtoisie,
    limite: number,
    curseur: string | undefined,
    maintenant: Date,
  ): Promise<PageCurseur<ReponsePretCourtoisie>> {
    const decode = curseur ? decoderCurseurTrie(curseur, TRI_DEFAUT_CREATION, 'temporel') : null;
    return this.acces.enTenant(ctx, async (tx) => {
      const conditions: SQL[] = [eq(pretCourtoisie.tenantId, ctx.tenantId)];
      // Comparaison à `undefined` : un id inexistant doit rendre une liste vide, jamais être ignoré.
      if (filtres.clientId !== undefined)
        conditions.push(eq(pretCourtoisie.clientId, filtres.clientId));
      if (filtres.ordreReparationId !== undefined) {
        conditions.push(eq(pretCourtoisie.ordreReparationId, filtres.ordreReparationId));
      }
      if (filtres.vehiculeCourtoisieId !== undefined) {
        conditions.push(eq(pretCourtoisie.vehiculeCourtoisieId, filtres.vehiculeCourtoisieId));
      }
      if (filtres.statut !== undefined) conditions.push(eq(pretCourtoisie.statut, filtres.statut));
      if (decode) {
        if (typeof decode.valeur !== 'string') {
          conditions.push(sql`false`);
        } else {
          conditions.push(
            sql`(${pretCourtoisie.creeLe}, ${pretCourtoisie.id}) < (${decode.valeur}::timestamptz, ${decode.id})`,
          );
        }
      }
      const lignes = await tx
        .select({
          pret: pretCourtoisie,
          vehicule: vehiculeCourtoisie,
          client,
          creeLeTexte: sql<string>`${pretCourtoisie.creeLe}::text`,
        })
        .from(pretCourtoisie)
        .innerJoin(
          vehiculeCourtoisie,
          and(
            eq(vehiculeCourtoisie.tenantId, pretCourtoisie.tenantId),
            eq(vehiculeCourtoisie.id, pretCourtoisie.vehiculeCourtoisieId),
          ),
        )
        .innerJoin(
          client,
          and(eq(client.tenantId, pretCourtoisie.tenantId), eq(client.id, pretCourtoisie.clientId)),
        )
        .where(and(...conditions))
        .orderBy(desc(pretCourtoisie.creeLe), desc(pretCourtoisie.id))
        .limit(limite + 1);

      const aSuite = lignes.length > limite;
      const page = aSuite ? lignes.slice(0, limite) : lignes;
      const dernier = page[page.length - 1];
      return {
        donnees: page.map((l) => versReponsePret(l, maintenant)),
        curseurSuivant:
          aSuite && dernier
            ? encoderCurseurTrie({
                tri: TRI_DEFAUT_CREATION,
                valeur: valeurCurseurTimestamptz(dernier.creeLeTexte),
                id: dernier.pret.id,
              })
            : null,
        limite,
      };
    });
  }

  async creerPret(
    ctx: ContexteTenant,
    utilisateurId: string,
    entree: EntreeCreationPretCourtoisie,
    maintenant: Date,
  ): Promise<ReponsePretCourtoisie> {
    const debut = new Date(entree.debutLe);
    const fin = new Date(entree.finPrevueLe);
    if (!(fin.getTime() > debut.getTime())) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'La fin prévue doit suivre le début.', {
        erreurs: [
          { champ: 'finPrevueLe', code: 'periode_invalide', message: 'Fin avant le début.' },
        ],
      });
    }
    try {
      return await this.acces.enTenant(ctx, async (tx) => {
        // Verrou sur le véhicule : deux prêts simultanés se sérialisent ici, le second voit le premier.
        const [vehicule] = await tx
          .select()
          .from(vehiculeCourtoisie)
          .where(
            and(
              eq(vehiculeCourtoisie.tenantId, ctx.tenantId),
              eq(vehiculeCourtoisie.id, entree.vehiculeCourtoisieId),
            ),
          )
          .for('update')
          .limit(1);
        if (!vehicule) {
          throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Véhicule de courtoisie introuvable.');
        }
        if (vehicule.etat !== 'disponible') {
          throw new ErreurMetier('CONFLIT', 'Ce véhicule de courtoisie est hors du parc prêtable.');
        }
        const [clientLigne] = await tx
          .select()
          .from(client)
          .where(and(eq(client.tenantId, ctx.tenantId), eq(client.id, entree.clientId)))
          .limit(1);
        if (!clientLigne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Client introuvable.');
        await this.verifierRattachements(tx, ctx, entree);

        const [conflit] = await tx
          .select({ id: pretCourtoisie.id })
          .from(pretCourtoisie)
          .where(
            and(
              eq(pretCourtoisie.tenantId, ctx.tenantId),
              eq(pretCourtoisie.vehiculeCourtoisieId, vehicule.id),
              inArray(pretCourtoisie.statut, ['reserve', 'en_cours']),
              sql`${pretCourtoisie.debutLe} < ${fin.toISOString()}::timestamptz`,
              sql`${finEffective(maintenant)} > ${debut.toISOString()}::timestamptz`,
            ),
          )
          .limit(1);
        if (conflit) {
          throw new ErreurMetier('CONFLIT', 'Ce véhicule est déjà prêté sur cette période.');
        }

        const demarre = debut.getTime() <= maintenant.getTime() + TOLERANCE_DEBUT_MS;
        const [cree] = await tx
          .insert(pretCourtoisie)
          .values({
            tenantId: ctx.tenantId,
            vehiculeCourtoisieId: vehicule.id,
            clientId: clientLigne.id,
            ordreReparationId: entree.ordreReparationId ?? null,
            rendezVousId: entree.rendezVousId ?? null,
            debutLe: debut,
            finPrevueLe: fin,
            kmDepart: demarre
              ? (entree.kmDepart ?? vehicule.kilometrage)
              : (entree.kmDepart ?? null),
            statut: demarre ? 'en_cours' : 'reserve',
            note: entree.note ?? null,
            creeParId: utilisateurId,
          })
          .returning();
        if (!cree) throw new ErreurMetier('ERREUR_INTERNE', 'La création du prêt a échoué.');
        return versReponsePret({ pret: cree, vehicule, client: clientLigne }, maintenant);
      });
    } catch (erreur) {
      if (estViolationExclusion(erreur)) {
        throw new ErreurMetier('CONFLIT', 'Ce véhicule est déjà prêté sur cette période.');
      }
      throw erreur;
    }
  }

  /** Reserve -> en cours : la voiture quitte le garage (km de départ relevé à ce moment). */
  async remettre(
    ctx: ContexteTenant,
    pretId: string,
    kmDepart: number | undefined,
    maintenant: Date,
  ): Promise<ReponsePretCourtoisie> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerPretPourEcriture(tx, ctx, pretId);
      if (ligne.pret.statut !== 'reserve') {
        throw new ErreurMetier('CONFLIT', 'Seul un prêt réservé peut être remis au client.');
      }
      const [mis] = await tx
        .update(pretCourtoisie)
        .set({
          statut: 'en_cours',
          kmDepart: kmDepart ?? ligne.pret.kmDepart ?? ligne.vehicule.kilometrage,
        })
        .where(and(eq(pretCourtoisie.tenantId, ctx.tenantId), eq(pretCourtoisie.id, pretId)))
        .returning();
      if (!mis) throw new ErreurMetier('ERREUR_INTERNE', 'La remise du véhicule a échoué.');
      return versReponsePret({ ...ligne, pret: mis }, maintenant);
    });
  }

  async rendre(
    ctx: ContexteTenant,
    pretId: string,
    entree: EntreeRetourPretCourtoisie,
    maintenant: Date,
  ): Promise<ReponsePretCourtoisie> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerPretPourEcriture(tx, ctx, pretId);
      if (ligne.pret.statut !== 'en_cours') {
        throw new ErreurMetier('CONFLIT', 'Seul un prêt en cours peut être rendu.');
      }
      if (
        entree.kmRetour !== undefined &&
        ligne.pret.kmDepart !== null &&
        entree.kmRetour < ligne.pret.kmDepart
      ) {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          'Le kilométrage au retour est inférieur au départ.',
          {
            erreurs: [
              {
                champ: 'kmRetour',
                code: 'km_retour_inferieur',
                message: 'Inférieur au km de départ.',
              },
            ],
          },
        );
      }
      const [mis] = await tx
        .update(pretCourtoisie)
        .set({
          statut: 'retourne',
          renduLe: entree.renduLe ? new Date(entree.renduLe) : maintenant,
          kmRetour: entree.kmRetour,
        })
        .where(and(eq(pretCourtoisie.tenantId, ctx.tenantId), eq(pretCourtoisie.id, pretId)))
        .returning();
      if (!mis) throw new ErreurMetier('ERREUR_INTERNE', 'Le retour du véhicule a échoué.');
      if (entree.kmRetour !== undefined) {
        await tx
          .update(vehiculeCourtoisie)
          .set({ kilometrage: entree.kmRetour })
          .where(
            and(
              eq(vehiculeCourtoisie.tenantId, ctx.tenantId),
              eq(vehiculeCourtoisie.id, mis.vehiculeCourtoisieId),
            ),
          );
      }
      return versReponsePret({ ...ligne, pret: mis }, maintenant);
    });
  }

  async annuler(
    ctx: ContexteTenant,
    pretId: string,
    maintenant: Date,
  ): Promise<ReponsePretCourtoisie> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await this.chargerPretPourEcriture(tx, ctx, pretId);
      if (ligne.pret.statut !== 'reserve' && ligne.pret.statut !== 'en_cours') {
        throw new ErreurMetier('CONFLIT', 'Ce prêt est déjà terminé ou annulé.');
      }
      const [mis] = await tx
        .update(pretCourtoisie)
        .set({ statut: 'annule' })
        .where(and(eq(pretCourtoisie.tenantId, ctx.tenantId), eq(pretCourtoisie.id, pretId)))
        .returning();
      if (!mis) throw new ErreurMetier('ERREUR_INTERNE', "L'annulation du prêt a échoué.");
      return versReponsePret({ ...ligne, pret: mis }, maintenant);
    });
  }

  /* ------------------------------ privé ------------------------------ */

  private async verifierRattachements(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: EntreeCreationPretCourtoisie,
  ): Promise<void> {
    if (entree.ordreReparationId !== undefined) {
      const [or] = await tx
        .select({ id: ordreReparation.id })
        .from(ordreReparation)
        .where(
          and(
            eq(ordreReparation.tenantId, ctx.tenantId),
            eq(ordreReparation.id, entree.ordreReparationId),
          ),
        )
        .limit(1);
      if (!or) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Ordre de réparation introuvable.');
    }
    if (entree.rendezVousId !== undefined) {
      const [rdv] = await tx
        .select({ id: rendezVous.id })
        .from(rendezVous)
        .where(and(eq(rendezVous.tenantId, ctx.tenantId), eq(rendezVous.id, entree.rendezVousId)))
        .limit(1);
      if (!rdv) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Rendez-vous introuvable.');
    }
  }

  private async chargerPretPourEcriture(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    pretId: string,
  ): Promise<LigneJointe> {
    const [ligne] = await tx
      .select({ pret: pretCourtoisie, vehicule: vehiculeCourtoisie, client })
      .from(pretCourtoisie)
      .innerJoin(
        vehiculeCourtoisie,
        and(
          eq(vehiculeCourtoisie.tenantId, pretCourtoisie.tenantId),
          eq(vehiculeCourtoisie.id, pretCourtoisie.vehiculeCourtoisieId),
        ),
      )
      .innerJoin(
        client,
        and(eq(client.tenantId, pretCourtoisie.tenantId), eq(client.id, pretCourtoisie.clientId)),
      )
      .where(and(eq(pretCourtoisie.tenantId, ctx.tenantId), eq(pretCourtoisie.id, pretId)))
      .for('update', { of: pretCourtoisie })
      .limit(1);
    if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Prêt introuvable.');
    return ligne;
  }
}
