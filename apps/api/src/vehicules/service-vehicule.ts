import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  schemaModificationVehicule,
  type EntreeArchivageVehicule,
  type EntreeCreationVehicule,
  type EntreeFusionVehicule,
  type EntreeModificationVehicule,
  type FiltresVehicules,
  type PageCurseur,
  type ReponseVehicule,
  type VehiculeResume,
} from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { vehicule, type LigneVehicule } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { Horloge } from '../common/horloge';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';
import { neGarderQueChampsEnvoyes, PipeZod } from '../common/validation';
import { interpreterContrainteVehicule } from './erreurs-contraintes';
import { versVehiculeResume } from './vehicule.mappers';
import {
  chargerLigneVehicule,
  construireReponseVehicule,
  listerOrOuverts,
  trouverVehiculeCollisionPlaque,
} from './vehicule-requetes';

/**
 * VIN accepté mais de moins de 17 caractères (RM-15) → avertissement `VEHICULE_VIN_COURT`.
 * L'unicité (`VEHICULE_VIN_EXISTANT`) ne porte, elle, que sur un VIN complet (index partiel
 * `vehicule_vin_actif_uk`, sur véhicule `actif`) — un VIN court n'entre jamais en collision.
 */
const LONGUEUR_VIN_COMPLET = 17;

export interface ResultatEcritureVehicule {
  readonly donnees: ReponseVehicule;
  readonly avertissements: CollecteurAvertissements;
}

@Injectable()
export class ServiceVehicule {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly horloge: Horloge,
  ) {}

  async lister(
    ctx: ContexteTenant,
    filtres: FiltresVehicules,
    pagination: { readonly limite: number; readonly curseur?: string },
  ): Promise<PageCurseur<VehiculeResume>> {
    const tri = filtres.tri;
    const limite = pagination.limite;
    // DÉFAUT CORRIGÉ (même classe que celui documenté dans `common/pagination/curseur.ts`, constaté
    // en exécution réelle sur `apps/api/src/pneus/**`) : seul `creeLe:desc` porte sur une colonne
    // `timestamptz` (`construireTriEtSeuil` ci-dessous caste explicitement `${v}::timestamptz` dans
    // cette seule branche) — `plaque:asc/desc` et `prochaineExpertiseLe:asc` comparent du texte à du
    // texte sans cast, donc sans risque d'erreur PostgreSQL native sur un contenu arbitraire.
    // `typeValeur = 'temporel'` uniquement pour `creeLe:desc` : une valeur forgée qui n'est pas un
    // horodatage bien formé est alors rejetée ICI, avant d'atteindre le `::timestamptz` de
    // `construireTriEtSeuil`, en `400 VALIDATION_ECHOUEE` plutôt qu'en `500 ERREUR_INTERNE`.
    const curseurDecode = pagination.curseur
      ? decoderCurseurTrie(pagination.curseur, tri, tri === 'creeLe:desc' ? 'temporel' : 'texte')
      : null;

    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await executerListeVehicules(
        tx,
        ctx.tenantId,
        filtres,
        tri,
        curseurDecode,
        limite,
      );

      const aUnePageSuivante = lignes.length > limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, limite) : lignes;
      const derniere = pageLignes[pageLignes.length - 1];

      return {
        donnees: pageLignes.map((ligne) =>
          versVehiculeResume(
            ligne,
            ligne.plaqueValeur ? { valeur: ligne.plaqueValeur, canton: ligne.plaqueCanton } : null,
          ),
        ),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({ tri, valeur: valeurDeTri(derniere, tri), id: derniere.id })
            : null,
        limite,
      };
    });
  }

  async parId(ctx: ContexteTenant, vehiculeId: string): Promise<ReponseVehicule> {
    return this.acces.enTenant(ctx, (tx) =>
      construireReponseVehicule(tx, ctx, vehiculeId, this.horloge.maintenant()),
    );
  }

  /**
   * `POST /vehicules` — appelée par le contrôleur À L'INTÉRIEUR de `ServiceIdempotence.executer`
   * (l'`Idempotency-Key` est obligatoire, RM-15/RM-16 : un doublon de véhicule pollue la recherche
   * par plaque). `tx` est donc fournie par l'appelant, jamais ouverte ici.
   */
  async creerDansTransaction(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: EntreeCreationVehicule,
  ): Promise<ResultatEcritureVehicule> {
    const avertissements = new CollecteurAvertissements();
    const identificationIncomplete = !entree.vin;

    if (entree.vin && entree.vin.length < LONGUEUR_VIN_COMPLET) {
      avertissements.ajouter(
        'VEHICULE_VIN_COURT',
        'VIN de moins de 17 caractères — accepté (RM-15).',
        {
          longueur: entree.vin.length,
        },
      );
    }
    if (identificationIncomplete) {
      avertissements.ajouter(
        'VEHICULE_IDENTIFICATION_INCOMPLETE',
        'Véhicule créé sans VIN (RM-16).',
      );
    }

    let inseree: LigneVehicule;
    try {
      const lignes = await tx
        .insert(vehicule)
        .values({
          tenantId: ctx.tenantId,
          vin: entree.vin ?? null,
          marque: entree.marque,
          modele: entree.modele,
          version: entree.version ?? null,
          finition: entree.finition ?? null,
          codeTypeCh: entree.codeTypeCh ?? null,
          date1reCirculation: entree.premiereMiseEnCirculationLe ?? null,
          carburant: entree.carburant ?? null,
          cylindreeCm3: entree.cylindreeCm3 ?? null,
          puissanceKw: entree.puissanceKw ?? null,
          boite: entree.boite ?? null,
          transmission: entree.transmission ?? null,
          couleur: entree.couleur ?? null,
          conducteurHabituel: entree.conducteurHabituel ?? null,
          proprietaireEconomiqueClientId: entree.proprietaireEconomiqueClientId ?? null,
          importe: entree.importe,
          paysOrigine: entree.paysOrigine ?? null,
          dateImportation: entree.importeLe ?? null,
          identificationIncomplete,
        })
        .returning();
      const premiere = lignes[0];
      if (!premiere) {
        throw new ErreurMetier('ERREUR_INTERNE', "L'insertion du véhicule n'a rendu aucune ligne.");
      }
      inseree = premiere;
    } catch (erreur) {
      relancerErreurContrainte(erreur);
    }

    if (entree.plaque) {
      const debutLe = jourIso(this.horloge.maintenant());
      try {
        await tx.execute(sql`
          insert into public.vehicule_plaque (tenant_id, vehicule_id, valeur, canton, pays, du, interchangeable, professionnelle)
          values (${ctx.tenantId}, ${inseree.id}, ${entree.plaque}, ${entree.canton ?? null}, 'CH', ${debutLe}, false, false)
        `);
      } catch (erreur) {
        await this.relancerErreurContraintePlaqueCreation(ctx, erreur, {
          valeur: entree.plaque,
          debutLe,
        });
      }
    }

    if (entree.detenteurId) {
      await tx.execute(sql`
        insert into public.vehicule_detention (tenant_id, vehicule_id, client_id, du)
        values (${ctx.tenantId}, ${inseree.id}, ${entree.detenteurId}, ${jourIso(this.horloge.maintenant())})
      `);
    }

    const reponse = await this.chargerReponse(tx, ctx, inseree.id);
    return { donnees: reponse, avertissements };
  }

  async modifierDansTransaction(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    vehiculeId: string,
    entree: Partial<EntreeModificationVehicule>,
  ): Promise<ResultatEcritureVehicule> {
    const avertissements = new CollecteurAvertissements();
    const existante = await chargerLigneVehicule(tx, ctx, vehiculeId);

    if (entree.vin !== undefined && entree.vin && entree.vin.length < LONGUEUR_VIN_COMPLET) {
      avertissements.ajouter(
        'VEHICULE_VIN_COURT',
        'VIN de moins de 17 caractères — accepté (RM-15).',
      );
    }
    const identificationIncomplete =
      entree.vin !== undefined ? !entree.vin : existante.identificationIncomplete;
    if (entree.vin !== undefined && !entree.vin) {
      avertissements.ajouter(
        'VEHICULE_IDENTIFICATION_INCOMPLETE',
        'Véhicule modifié sans VIN (RM-16).',
      );
    }

    try {
      await tx
        .update(vehicule)
        .set({
          vin: entree.vin !== undefined ? (entree.vin ?? null) : undefined,
          marque: entree.marque,
          modele: entree.modele,
          version: entree.version !== undefined ? (entree.version ?? null) : undefined,
          finition: entree.finition !== undefined ? (entree.finition ?? null) : undefined,
          codeTypeCh: entree.codeTypeCh !== undefined ? (entree.codeTypeCh ?? null) : undefined,
          date1reCirculation:
            entree.premiereMiseEnCirculationLe !== undefined
              ? (entree.premiereMiseEnCirculationLe ?? null)
              : undefined,
          carburant: entree.carburant !== undefined ? (entree.carburant ?? null) : undefined,
          cylindreeCm3:
            entree.cylindreeCm3 !== undefined ? (entree.cylindreeCm3 ?? null) : undefined,
          puissanceKw: entree.puissanceKw !== undefined ? (entree.puissanceKw ?? null) : undefined,
          boite: entree.boite !== undefined ? (entree.boite ?? null) : undefined,
          transmission:
            entree.transmission !== undefined ? (entree.transmission ?? null) : undefined,
          couleur: entree.couleur !== undefined ? (entree.couleur ?? null) : undefined,
          conducteurHabituel:
            entree.conducteurHabituel !== undefined
              ? (entree.conducteurHabituel ?? null)
              : undefined,
          proprietaireEconomiqueClientId:
            entree.proprietaireEconomiqueClientId !== undefined
              ? (entree.proprietaireEconomiqueClientId ?? null)
              : undefined,
          // F-01-bis (corruption silencieuse, gravité haute) : `schemaModificationVehicule` naît
          // de `schemaCreationVehicule.omit({...}).partial()`, et `importe` porte
          // `.default(false)` sur le schéma de BASE. `.partial()` rend la clé optionnelle, il
          // n'annule PAS le `.default(...)` : un corps qui ne mentionne jamais `importe` ressort
          // quand même du `.parse()` avec `importe: false`. La garde `!== undefined` ci-dessous
          // ne suffit PAS à elle seule contre ce défaut précis (voir `neGarderQueChampsEnvoyes`,
          // `common/validation/champs-envoyes.ts`) : elle protège ici seulement parce que
          // `entree` est le résultat DÉJÀ FILTRÉ sur le corps brut (voir `modifier()` ci-dessous),
          // pas l'objet zod-parsé brut — sans ce filtrage en amont, `entree.importe` vaudrait
          // TOUJOURS `false` que le client l'ait envoyé ou non, et cette garde serait inopérante.
          importe: entree.importe !== undefined ? entree.importe : undefined,
          paysOrigine: entree.paysOrigine !== undefined ? (entree.paysOrigine ?? null) : undefined,
          dateImportation: entree.importeLe !== undefined ? (entree.importeLe ?? null) : undefined,
          pneusEte: entree.pneusEte !== undefined ? (entree.pneusEte ?? null) : undefined,
          pneusHiver: entree.pneusHiver !== undefined ? (entree.pneusHiver ?? null) : undefined,
          pressionPneus:
            entree.pressionPneus !== undefined ? (entree.pressionPneus ?? null) : undefined,
          huileType: entree.huileType !== undefined ? (entree.huileType ?? null) : undefined,
          huileQuantiteDl:
            entree.huileQuantiteDl !== undefined ? (entree.huileQuantiteDl ?? null) : undefined,
          batterie: entree.batterie !== undefined ? (entree.batterie ?? null) : undefined,
          codeRadio: entree.codeRadio !== undefined ? (entree.codeRadio ?? null) : undefined,
          codeCle: entree.codeCle !== undefined ? (entree.codeCle ?? null) : undefined,
          intervalleEntretienKm:
            entree.intervalleEntretienKm !== undefined
              ? (entree.intervalleEntretienKm ?? null)
              : undefined,
          intervalleEntretienMois:
            entree.intervalleEntretienMois !== undefined
              ? (entree.intervalleEntretienMois ?? null)
              : undefined,
          garantieDebut:
            entree.garantieDebutLe !== undefined ? (entree.garantieDebutLe ?? null) : undefined,
          garantieMois:
            entree.garantieMois !== undefined ? (entree.garantieMois ?? null) : undefined,
          garantieKm: entree.garantieKm !== undefined ? (entree.garantieKm ?? null) : undefined,
          // `emplacementMajLe` n'avance QUE quand `emplacementLibre` figure dans le corps de la
          // requête (poser une valeur ou l'effacer avec `null` compte pareil comme y toucher) —
          // JAMAIS via `modifieLe`/un trigger générique, qui avancerait sur n'importe quel autre
          // champ (couleur, kilométrage...) sans rapport avec la position (migration 0044).
          emplacementLibre:
            entree.emplacementLibre !== undefined ? (entree.emplacementLibre ?? null) : undefined,
          emplacementMajLe:
            entree.emplacementLibre !== undefined ? this.horloge.maintenant() : undefined,
          identificationIncomplete,
        })
        .where(and(eq(vehicule.tenantId, ctx.tenantId), eq(vehicule.id, vehiculeId)));
    } catch (erreur) {
      relancerErreurContrainte(erreur);
    }

    const reponse = await construireReponseVehicule(tx, ctx, vehiculeId, this.horloge.maintenant());
    return { donnees: reponse, avertissements };
  }

  /**
   * `PATCH /vehicules/{id}` — pas d'idempotence requise (contrat §7.4), transaction ouverte ici.
   *
   * Reçoit le corps BRUT (pas encore parsé) : `schemaModificationVehicule` porte `importe`
   * hérité de `schemaCreationVehicule` avec `.default(false)` — `.partial()` ne l'annule pas.
   * `neGarderQueChampsEnvoyes` retire donc toute clé absente du corps brut AVANT que
   * `modifierDansTransaction` ne construise le `.set()`, sinon un `PATCH` qui ne mentionne
   * jamais `importe` écraserait silencieusement le statut « importé » d'un véhicule (F-01-bis,
   * voir `common/validation/champs-envoyes.ts`).
   */
  async modifier(
    ctx: ContexteTenant,
    vehiculeId: string,
    corpsBrut: Readonly<Record<string, unknown>>,
  ): Promise<ResultatEcritureVehicule> {
    const entreeParsee = new PipeZod(schemaModificationVehicule).transform(corpsBrut);
    const entree = neGarderQueChampsEnvoyes(corpsBrut, entreeParsee);
    return this.acces.enTenant(ctx, (tx) =>
      this.modifierDansTransaction(tx, ctx, vehiculeId, entree),
    );
  }

  async archiver(
    ctx: ContexteTenant,
    vehiculeId: string,
    entree: EntreeArchivageVehicule,
  ): Promise<ResultatEcritureVehicule> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);

      const orOuverts = await listerOrOuverts(tx, ctx, vehiculeId);
      if (orOuverts.length > 0) {
        throw new ErreurMetier(
          'VEHICULE_ARCHIVAGE_IMPOSSIBLE',
          'Le véhicule porte encore des ordres de réparation ouverts.',
          {
            blocages: orOuverts.map((or) => ({
              type: 'ordre_reparation' as const,
              id: or.id,
              libelle: or.numero,
              donnees: { statut: or.statut },
            })),
          },
        );
      }

      await tx
        .update(vehicule)
        .set({ statut: 'archive', motifArchivage: entree.motifArchivage })
        .where(and(eq(vehicule.tenantId, ctx.tenantId), eq(vehicule.id, vehiculeId)));

      const reponse = await construireReponseVehicule(
        tx,
        ctx,
        vehiculeId,
        this.horloge.maintenant(),
      );
      return { donnees: reponse, avertissements: new CollecteurAvertissements() };
    });
  }

  /**
   * RM-32 — fusion de doublon. AMBIGUÏTÉ DE CONTRAT SIGNALÉE : le contrat d'API (§7.4) exige le
   * droit `direction` seul, mais `auth/matrice-droits.ts` (lecture seule pour ce module, propriété
   * d'un autre agent) ne déclare AUCUNE action `vehicule.fusionner` — seule `vehicule.archiver`
   * s'en approche (réceptionnaire/chef d'atelier/direction). Faute d'action dédiée, ce service
   * réutilise `vehicule.archiver` au niveau du `@ExigerDroit` du contrôleur ET resserre ICI,
   * explicitement, au rôle `direction`/`admin` — sans modifier la matrice, qui n'est pas de mon
   * périmètre. À faire trancher par expert-auth/lead-backend : soit une action dédiée est ajoutée
   * à la matrice, soit ce resserrement in-service devient la règle documentée.
   */
  async fusionner(
    ctx: ContexteTenant,
    principalRole: string,
    vehiculeId: string,
    entree: EntreeFusionVehicule,
  ): Promise<ResultatEcritureVehicule> {
    if (principalRole !== 'direction' && principalRole !== 'admin') {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        'La fusion de véhicules est réservée à la direction.',
      );
    }

    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      const source = await chargerLigneVehicule(tx, ctx, entree.vehiculeSourceId);

      if (!source.vin || source.vin.toUpperCase() !== entree.confirmationVin.toUpperCase()) {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          'Le VIN de confirmation ne correspond pas au véhicule source.',
          {
            erreurs: [
              {
                champ: 'confirmationVin',
                code: 'vin_incorrect',
                message: 'Le VIN saisi ne correspond pas.',
              },
            ],
          },
        );
      }

      await tx
        .update(vehicule)
        .set({ statut: 'archive', motifArchivage: 'doublon', fusionneVersVehiculeId: vehiculeId })
        .where(and(eq(vehicule.tenantId, ctx.tenantId), eq(vehicule.id, entree.vehiculeSourceId)));

      const reponse = await construireReponseVehicule(
        tx,
        ctx,
        vehiculeId,
        this.horloge.maintenant(),
      );
      return { donnees: reponse, avertissements: new CollecteurAvertissements() };
    });
  }

  /**
   * Seconde voie d'entrée sur la même collision que `ServiceVehiculePlaque.creer` (dette
   * technique n°6) : l'INSERT de plaque de `creerDansTransaction` ci-dessus vit dans `tx`, une
   * transaction OUVERTE PAR L'APPELANT (`POST /vehicules`, sous `ServiceIdempotence.executer`) —
   * jamais par cette méthode. Une fois cet INSERT en échec, `tx` est ABORTÉE côté Postgres
   * (25P02) : toute requête supplémentaire dessus, y compris une simple lecture, serait rejetée.
   * La relecture de secours (`trouverVehiculeCollisionPlaque`) doit donc courir dans une
   * transaction FRAÎCHE, ouverte par un second appel À `this.acces.enTenant` — jamais sur `tx` —
   * exactement la structure déjà prouvée contre la vraie base sur `ServiceVehiculePlaque.creer`.
   *
   * Contrat de sortie IDENTIQUE à `ServiceVehiculePlaque.creer` : même code `409
   * VEHICULE_PLAQUE_COLLISION`, `blocages[0].donnees` au même type `DetailCollisionPlaqueVehicule`
   * — seul `blocages[0].id` diffère (`'plaque'` ici, `'valeur'` là-bas). CONFIRMÉ, pas un bug
   * (issue #95) : `id` pour `type: 'champ'` est TOUJOURS le nom du champ fautif DANS LE CORPS DE
   * CETTE requête (`EntreeCreationVehicule.plaque` ici, `EntreePlaqueVehicule.valeur` sur l'autre
   * route) — jamais un identifiant de rôle stable entre endpoints. Doc complète et convention
   * produit dans `DetailCollisionPlaqueVehicule` (`@dfa/shared`, `contrats/vehicules/collision-
   * plaque.ts`) : un consommateur ne doit JAMAIS brancher sur `blocages[0].id`, seulement sur
   * `.donnees`.
   * Cas de course identique : ligne fautive disparue entre l'échec de l'INSERT et cette relecture
   * → `collision` vaut `null`, l'erreur reste un `409` correct, `blocages` simplement OMIS —
   * jamais un `500`, jamais un identifiant inventé.
   */
  private async relancerErreurContraintePlaqueCreation(
    ctx: ContexteTenant,
    erreur: unknown,
    plaque: { readonly valeur: string; readonly debutLe: string },
  ): Promise<never> {
    const interpretation = interpreterContrainteVehicule(erreur);
    if (!interpretation) {
      throw erreur;
    }
    if (interpretation.code !== 'VEHICULE_PLAQUE_COLLISION') {
      throw new ErreurMetier(
        interpretation.code,
        MESSAGES_CONTRAINTE[interpretation.contrainte] ??
          `Contrainte violée : ${interpretation.contrainte}.`,
      );
    }
    const collision = await this.acces.enTenant(ctx, (tx) =>
      trouverVehiculeCollisionPlaque(tx, ctx, plaque),
    );
    throw new ErreurMetier(
      interpretation.code,
      'Cette plaque est déjà portée par un autre véhicule sur une période qui chevauche (RM-18).',
      {
        blocages: collision
          ? [
              {
                type: 'champ',
                id: 'plaque',
                libelle: `Plaque déjà portée par le véhicule ${collision.marque} ${collision.modele}`,
                donnees: { ...collision },
              },
            ]
          : undefined,
      },
    );
  }

  /**
   * Projection `ReponseVehicule` complète, à l'intérieur d'une transaction déjà ouverte par
   * l'appelant (mêmes garanties que `construireReponseVehicule`, dont c'est un simple relais lié
   * à l'horloge de ce service — voir `creerDansTransaction`).
   */
  private async chargerReponse(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    vehiculeId: string,
  ): Promise<ReponseVehicule> {
    return construireReponseVehicule(tx, ctx, vehiculeId, this.horloge.maintenant());
  }
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Messages spécifiques pour les contraintes dont le libellé générique (« Contrainte violée : xxx »)
 * n'aiderait pas la réceptionniste à corriger sa saisie — sinon, repli sur le nom de la contrainte.
 */
const MESSAGES_CONTRAINTE: Readonly<Record<string, string>> = {
  vehicule_vin_format_chk:
    'VIN invalide : un VIN de 17 caractères ne peut pas contenir les lettres I, O ou Q (RM-15).',
};

function relancerErreurContrainte(erreur: unknown): never {
  const interpretation = interpreterContrainteVehicule(erreur);
  if (interpretation) {
    throw new ErreurMetier(
      interpretation.code,
      MESSAGES_CONTRAINTE[interpretation.contrainte] ??
        `Contrainte violée : ${interpretation.contrainte}.`,
    );
  }
  throw erreur;
}

// -----------------------------------------------------------------------------------------
// Liste paginée triable (GET /vehicules) — SQL direct : jointures LATERAL pour la plaque
// courante et la prochaine échéance d'expertise, nécessaires aux 4 tris exposés (§6.2) et non
// exprimables simplement avec le query-builder Drizzle. Colonnes rescoped sur tenant_id (défense
// en profondeur, RLS déjà actif via enTenant()).
// -----------------------------------------------------------------------------------------

type LigneListeVehiculeBrute = {
  readonly id: string;
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
  readonly vin: string | null;
  readonly date_1re_circulation: string | null;
  readonly identification_incomplete: boolean;
  // `string`, jamais `Date` : le `SELECT` d'`executerListeVehicules` ci-dessous cast explicitement
  // cette colonne en `v.cree_le::text` — PAS parce que le pilote `pg` rendrait par défaut un
  // `timestamptz` en chaîne (mesuré : il rend un `Date`, comme le fait le query builder Drizzle
  // typé), mais pour l'EMPÊCHER de le faire. `Date` n'a qu'une résolution MILLISECONDE quand
  // PostgreSQL stocke `timestamptz` à la MICROSECONDE ; cette colonne alimente la valeur de curseur
  // de pagination (`valeurDeTri()` ci-dessous, via `valeurCurseurTimestamptz()`), et un aller-retour
  // par `Date` y tronquerait silencieusement la microseconde — c'est précisément ce qui faisait
  // sauter des lignes entières de `GET /vehicules?tri=creeLe:desc` dès que plusieurs véhicules
  // partageaient la même milliseconde de création (typiquement une reprise de données ou un import
  // en lot). Voir `common/pagination/valeur-temporelle.ts` pour le détail du mécanisme, et le même
  // motif dans `clients/service-client.ts` / `clients/pagination-triee.ts`.
  readonly cree_le: string;
  readonly plaque_valeur: string | null;
  readonly plaque_canton: string | null;
  readonly prochaine_expertise_le: string | null;
  // Colonne plate de `vehicule`, sans jointure supplémentaire (migration 0044) : coût quasi nul
  // ajouté à ce SELECT déjà LATERAL sur la plaque/l'expertise — voir `VehiculeResume.emplacementLibre`
  // (packages/shared) pour la justification de sa présence dans cette projection de liste.
  readonly emplacement_libre: string | null;
};

interface LigneListeVehicule {
  readonly id: string;
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
  readonly vin: string | null;
  readonly date1reCirculation: string | null;
  readonly identificationIncomplete: boolean;
  // `string` : simple relais de `LigneListeVehiculeBrute.cree_le`, non converti à ce stade — voir
  // le commentaire sur `cree_le` ci-dessus et `valeurCurseurTimestamptz()` dans `valeurDeTri()`.
  readonly creeLe: string;
  readonly plaqueValeur: string | null;
  readonly plaqueCanton: string | null;
  readonly prochaineExpertiseLe: string | null;
  readonly emplacementLibre: string | null;
}

function versLigneListe(brute: LigneListeVehiculeBrute): LigneListeVehicule {
  return {
    id: brute.id,
    marque: brute.marque,
    modele: brute.modele,
    version: brute.version,
    vin: brute.vin,
    date1reCirculation: brute.date_1re_circulation,
    identificationIncomplete: brute.identification_incomplete,
    creeLe: brute.cree_le,
    plaqueValeur: brute.plaque_valeur,
    plaqueCanton: brute.plaque_canton,
    prochaineExpertiseLe: brute.prochaine_expertise_le,
    emplacementLibre: brute.emplacement_libre,
  };
}

function valeurDeTri(ligne: LigneListeVehicule, tri: string): string | number | null {
  if (tri === 'plaque:asc' || tri === 'plaque:desc') return ligne.plaqueValeur;
  if (tri === 'prochaineExpertiseLe:asc') return ligne.prochaineExpertiseLe;
  // `creeLe:desc` (défaut) : `ligne.creeLe` est le texte natif PostgreSQL (`v.cree_le::text`, voir
  // le `SELECT` d'`executerListeVehicules`) — jamais un `Date`, pour ne pas tronquer la
  // microseconde avant d'encoder le curseur (voir la doc de `LigneListeVehiculeBrute.cree_le`
  // ci-dessus).
  return valeurCurseurTimestamptz(ligne.creeLe);
}

async function executerListeVehicules(
  tx: TransactionDfa,
  tenantId: string,
  filtres: FiltresVehicules,
  tri: string,
  curseur: { readonly valeur: string | number | null; readonly id: string } | null,
  limite: number,
): Promise<readonly LigneListeVehicule[]> {
  const conditions: SQL[] = [sql`v.tenant_id = ${tenantId}`];
  // `filtres.siteId` (schéma `schemaFiltresVehicules`, `@dfa/shared`) : volontairement IGNORÉ ici,
  // même décision que `siteId` sur `GET /clients` (voir `service-client.ts::lister`) — `vehicule`
  // ne porte aucune colonne de site, et P-30 (`docs/specification-etape-1-atelier-clients.md` §annexe,
  // `docs/plan-etape-1-backend.md` N-13) tranche le défaut du lot 1 en faveur du PARTAGE entre sites
  // d'un même tenant : clients et véhicules ne sont cloisonnés par site que si P-30 devient
  // « cloisonné », ce qui exigerait un second niveau de RLS qui n'existe pas encore. Le champ reste
  // accepté par le contrat pour ne pas casser un futur client qui l'enverrait, mais n'a aucun effet
  // aujourd'hui — ce n'est PAS un oubli à « corriger » isolément dans ce module.
  if (filtres.statut && filtres.statut.length > 0) {
    // `sql.param(...)::public.statut_vehicule[]` — jamais l'interpolation directe d'un tableau JS
    // dans `sql\`\``, qui produit un constructeur d'enregistrement (`any(($2, $3))`) au lieu d'un
    // tableau SQL et fait échouer la requête à l'exécution. Même motif qu'en recherche (voir
    // `recherche/service-recherche.ts`, `v.id = any(${sql.param(vehiculeIds)}::uuid[])`).
    conditions.push(sql`v.statut = any(${sql.param(filtres.statut)}::public.statut_vehicule[])`);
  }
  if (filtres.marque) {
    conditions.push(sql`v.marque ilike ${`%${filtres.marque}%`}`);
  }
  if (filtres.importe !== undefined) {
    conditions.push(sql`v.importe = ${filtres.importe}`);
  }
  if (filtres.detenteurId) {
    conditions.push(sql`exists (
      select 1 from public.vehicule_detention d
       where d.tenant_id = v.tenant_id and d.vehicule_id = v.id and d.au is null and d.client_id = ${filtres.detenteurId}
    )`);
  }
  if (filtres.prochaineExpertiseAu) {
    conditions.push(sql`exists (
      select 1 from public.vehicule_expertise e
       where e.tenant_id = v.tenant_id and e.vehicule_id = v.id
         and e.prochaine_echeance is not null and e.prochaine_echeance <= ${filtres.prochaineExpertiseAu}
    )`);
  }
  if (filtres.q) {
    const motif = `%${filtres.q}%`;
    conditions.push(sql`(
      public.normaliser_recherche(coalesce(v.marque,'') || ' ' || coalesce(v.modele,'')) like public.normaliser_recherche(${motif})
      or public.normaliser_recherche(coalesce(v.vin,'')) like public.normaliser_recherche(${motif})
      or exists (
        select 1 from public.vehicule_plaque p
         where p.tenant_id = v.tenant_id and p.vehicule_id = v.id and p.au is null
           and public.normaliser_recherche(p.valeur) like public.normaliser_recherche(${motif})
      )
    )`);
  }

  const { ordre, seuil } = construireTriEtSeuil(tri, curseur);
  conditions.push(seuil);

  const requete = sql`
    select v.id, v.marque, v.modele, v.version, v.vin, v.date_1re_circulation, v.identification_incomplete,
           v.cree_le::text as cree_le, v.emplacement_libre,
           pc.valeur as plaque_valeur, pc.canton as plaque_canton,
           ne.prochaine_echeance as prochaine_expertise_le
      from public.vehicule v
      left join lateral (
        select valeur, canton from public.vehicule_plaque
         where tenant_id = v.tenant_id and vehicule_id = v.id and au is null
         order by du desc limit 1
      ) pc on true
      left join lateral (
        select prochaine_echeance from public.vehicule_expertise
         where tenant_id = v.tenant_id and vehicule_id = v.id and prochaine_echeance is not null
         order by prochaine_echeance desc limit 1
      ) ne on true
     where ${sql.join(conditions, sql` and `)}
     order by ${ordre}
     limit ${limite + 1}
  `;

  const resultat = await tx.execute<LigneListeVehiculeBrute>(requete);
  return resultat.rows.map(versLigneListe);
}

function construireTriEtSeuil(
  tri: string,
  curseur: { readonly valeur: string | number | null; readonly id: string } | null,
): { readonly ordre: SQL; readonly seuil: SQL } {
  // Sentinelles NULLS LAST : `plaque_valeur`/`prochaine_echeance` sont non vides quand présents
  // (contrainte `vehicule_plaque_valeur_non_vide_chk`, dates ISO), donc `''`/`'0001-01-01'`
  // trient toujours avant une vraie valeur et `'￿'`/`'9999-12-31'` toujours après.
  if (tri === 'plaque:asc') {
    const v = typeof curseur?.valeur === 'string' ? curseur.valeur : '￿';
    const id = curseur?.id ?? '';
    const seuil = curseur ? sql`(coalesce(pc.valeur, '￿'), v.id) > (${v}, ${id})` : sql`true`;
    return { ordre: sql`coalesce(pc.valeur, '￿') asc, v.id asc`, seuil };
  }
  if (tri === 'plaque:desc') {
    const v = typeof curseur?.valeur === 'string' ? curseur.valeur : '';
    const id = curseur?.id ?? '';
    const seuil = curseur ? sql`(coalesce(pc.valeur, ''), v.id) < (${v}, ${id})` : sql`true`;
    return { ordre: sql`coalesce(pc.valeur, '') desc, v.id desc`, seuil };
  }
  if (tri === 'prochaineExpertiseLe:asc') {
    const v = typeof curseur?.valeur === 'string' ? curseur.valeur : '9999-12-31';
    const id = curseur?.id ?? '';
    const seuil = curseur
      ? sql`(coalesce(ne.prochaine_echeance::text, '9999-12-31'), v.id) > (${v}, ${id})`
      : sql`true`;
    return { ordre: sql`coalesce(ne.prochaine_echeance, '9999-12-31'::date) asc, v.id asc`, seuil };
  }
  // creeLe:desc (défaut de `decoderCurseurTrie`)
  const v = typeof curseur?.valeur === 'string' ? curseur.valeur : null;
  const id = curseur?.id ?? '';
  const seuil = curseur && v ? sql`(v.cree_le, v.id) < (${v}::timestamptz, ${id})` : sql`true`;
  return { ordre: sql`v.cree_le desc, v.id desc`, seuil };
}
