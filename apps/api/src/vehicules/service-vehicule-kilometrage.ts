import { Inject, Injectable } from '@nestjs/common';
import {
  MOTIFS_KILOMETRAGE_REGRESSIF,
  type EntreeKilometrageVehicule,
  type ReponseVehiculeKilometrage,
  type RoleUtilisateur,
} from '@dfa/shared';
import { MATRICE_DROITS } from '../auth/matrice-droits';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { vehiculeKilometrage, type LigneVehiculeKilometrage } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../common/evenements';
import { Horloge } from '../common/horloge';
import { convertirEnKm, evaluerKilometrage } from './kilometrage.regles';
import type { FiltresKilometrages } from './schemas-locales';
import {
  chargerLigneVehicule,
  lireDernierKilometrage,
  listerKilometrages,
} from './vehicule-requetes';

function versReponse(ligne: LigneVehiculeKilometrage): ReponseVehiculeKilometrage {
  return {
    id: ligne.id,
    valeur: ligne.valeur,
    unite: ligne.unite,
    valeurKm: ligne.valeurKm ?? convertirEnKm(ligne.valeur, ligne.unite),
    releveLe: ligne.releveLe.toISOString(),
    source: ligne.source,
    motifRegression: ligne.motifRegression,
    ordreReparationId: ligne.ordreReparationId,
  };
}

export interface ResultatEcritureKilometrage {
  readonly donnees: ReponseVehiculeKilometrage;
  readonly avertissements: CollecteurAvertissements;
}

/**
 * Relevés kilométriques APPEND-ONLY (RM-23/24/25). La conversion mi→km est faite ICI, côté
 * serveur, avant toute comparaison de régression (CT-08) — `kilometrage.regles.ts` est pure et
 * doit rester l'exacte réciproque de la colonne générée `valeur_km` (migrations/0007_vehicules.sql).
 */
@Injectable()
export class ServiceVehiculeKilometrage {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_EVENEMENTS) private readonly evenements: ServiceEvenements,
    private readonly horloge: Horloge,
  ) {}

  async lister(
    ctx: ContexteTenant,
    vehiculeId: string,
    filtres: FiltresKilometrages,
  ): Promise<readonly ReponseVehiculeKilometrage[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      let lignes = await listerKilometrages(tx, ctx, vehiculeId);

      if (filtres.du) {
        const du = filtres.du;
        lignes = lignes.filter((ligne) => ligne.releveLe.toISOString().slice(0, 10) >= du);
      }
      if (filtres.au) {
        const au = filtres.au;
        lignes = lignes.filter((ligne) => ligne.releveLe.toISOString().slice(0, 10) <= au);
      }
      if (filtres.tri === 'releveLe:asc') {
        lignes = [...lignes].sort((a, b) => a.releveLe.getTime() - b.releveLe.getTime());
      }

      return lignes.map(versReponse);
    });
  }

  /**
   * `role` (§10 L962) — vient TOUJOURS du principal de session (`ServiceContexteRequete.exigerPrincipal`
   * côté contrôleur), jamais d'un paramètre client, exactement comme `ctx.tenantId`.
   *
   * FAILLE É-01 CORRIGÉE (audit sécurité) : `@ExigerDroit('vehicule.kilometrage.saisir')`, posé de
   * façon STATIQUE sur la route par `VehiculeKilometrageController`, autorise tout rôle qui peut
   * saisir un kilométrage NORMAL (y compris `technicien`) — la même route sert aussi la correction
   * à la baisse (§10 L962, réservée à `chef_atelier`/`direction`), qui n'a PAS d'action séparée sur
   * la route et ne peut donc pas être distinguée par un `@ExigerDroit` statique. Le contrôle du
   * droit fort `vehicule.kilometrage.corriger_regression` doit donc être posé ICI, explicitement,
   * uniquement sur la branche RÉGRESSIVE — jamais en permanence (ce qui interdirait au technicien
   * la saisie normale) et jamais côté route (elle ne connaît pas encore, au moment de la garde,
   * si CE relevé sera régressif : ça dépend du dernier relevé connu, une donnée métier).
   */
  async creer(
    ctx: ContexteTenant,
    vehiculeId: string,
    entree: EntreeKilometrageVehicule,
    role: RoleUtilisateur,
  ): Promise<ResultatEcritureKilometrage> {
    return this.acces.enTenant(ctx, async (tx) => {
      const avertissements = new CollecteurAvertissements();
      await chargerLigneVehicule(tx, ctx, vehiculeId);

      const dernier = await lireDernierKilometrage(tx, ctx, vehiculeId);
      const nouveauValeurKm = convertirEnKm(entree.valeur, entree.unite);
      const decision = evaluerKilometrage(
        nouveauValeurKm,
        dernier
          ? {
              valeurKm: dernier.valeurKm ?? convertirEnKm(dernier.valeur, dernier.unite),
              releveLe: dernier.releveLe,
            }
          : null,
        this.horloge.maintenant(),
      );

      if (decision.regressif && !entree.motifRegression) {
        throw new ErreurMetier(
          'VEHICULE_KILOMETRAGE_REGRESSIF',
          'Le kilométrage saisi est inférieur au dernier relevé connu.',
          {
            blocages: dernier
              ? [
                  {
                    type: 'champ' as const,
                    id: 'valeur',
                    libelle: 'Dernier relevé connu',
                    donnees: {
                      valeurKm: dernier.valeurKm,
                      releveLe: dernier.releveLe.toISOString(),
                    },
                  },
                ]
              : undefined,
            actionsProposees: [
              {
                code: 'FOURNIR_MOTIF',
                parametres: { motifsAcceptes: MOTIFS_KILOMETRAGE_REGRESSIF },
              },
            ],
          },
        );
      }

      // Branche régressive AVEC motif fourni : c'est une CORRECTION (§10 L962), pas une saisie
      // normale — droit fort exigé ICI, avant tout écriture (aucune ligne insérée en cas de refus).
      // Même idiome que `GardeDroit.canActivate` (MATRICE_DROITS[role] ?? [], .includes(action)) :
      // un seul endroit sait ce qu'un rôle peut faire, mais cette vérification-CI ne peut vivre que
      // côté service, parce que seul le service sait si CE relevé est régressif.
      if (decision.regressif) {
        const droitsDuRole = MATRICE_DROITS[role] ?? [];
        if (!droitsDuRole.includes('vehicule.kilometrage.corriger_regression')) {
          throw new ErreurMetier(
            'DROIT_INSUFFISANT',
            `Le rôle "${role}" n'a pas le droit de corriger un kilométrage régressif (RM-24, §10 L962).`,
          );
        }
      }

      if (decision.aberrant) {
        avertissements.ajouter(
          'VEHICULE_KILOMETRAGE_ABERRANT',
          'Écart aberrant avec le dernier relevé connu (RM-25).',
          {
            nouveauValeurKm,
            dernierValeurKm: dernier?.valeurKm ?? null,
          },
        );
      }

      const lignes = await tx
        .insert(vehiculeKilometrage)
        .values({
          tenantId: ctx.tenantId,
          vehiculeId,
          valeur: entree.valeur,
          unite: entree.unite,
          releveLe: new Date(entree.releveLe),
          source: entree.source,
          motifRegression: decision.regressif ? (entree.motifRegression ?? null) : null,
          ordreReparationId: entree.ordreReparationId ?? null,
          saisiParId: ctx.utilisateurId,
        })
        .returning();
      const inseree = lignes[0];
      if (!inseree) {
        throw new ErreurMetier('ERREUR_INTERNE', "L'insertion du relevé n'a rendu aucune ligne.");
      }

      await this.evenements.publier(tx, ctx, {
        type: 'vehicule.kilometrage_releve',
        versionSchema: 1,
        siteId: null,
        ressource: { type: 'vehicule', id: vehiculeId },
        donnees: {
          valeurKm: nouveauValeurKm,
          unite: entree.unite,
          source: entree.source,
          releveLe: entree.releveLe,
        },
      });

      return { donnees: versReponse(inseree), avertissements };
    });
  }
}
