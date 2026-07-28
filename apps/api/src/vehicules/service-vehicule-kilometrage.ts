import { Inject, Injectable } from '@nestjs/common';
import { MOTIFS_KILOMETRAGE_REGRESSIF, type EntreeKilometrageVehicule, type ReponseVehiculeKilometrage } from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { vehiculeKilometrage, type LigneVehiculeKilometrage } from '../db/schema';
import { CollecteurAvertissements } from '../common/avertissements';
import { ErreurMetier } from '../common/erreurs';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../common/evenements';
import { Horloge } from '../common/horloge';
import { convertirEnKm, evaluerKilometrage } from './kilometrage.regles';
import type { FiltresKilometrages } from './schemas-locales';
import { chargerLigneVehicule, lireDernierKilometrage, listerKilometrages } from './vehicule-requetes';

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

  async lister(ctx: ContexteTenant, vehiculeId: string, filtres: FiltresKilometrages): Promise<readonly ReponseVehiculeKilometrage[]> {
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

  async creer(ctx: ContexteTenant, vehiculeId: string, entree: EntreeKilometrageVehicule): Promise<ResultatEcritureKilometrage> {
    return this.acces.enTenant(ctx, async (tx) => {
      const avertissements = new CollecteurAvertissements();
      await chargerLigneVehicule(tx, ctx, vehiculeId);

      const dernier = await lireDernierKilometrage(tx, ctx, vehiculeId);
      const nouveauValeurKm = convertirEnKm(entree.valeur, entree.unite);
      const decision = evaluerKilometrage(
        nouveauValeurKm,
        dernier ? { valeurKm: dernier.valeurKm ?? convertirEnKm(dernier.valeur, dernier.unite), releveLe: dernier.releveLe } : null,
        this.horloge.maintenant(),
      );

      if (decision.regressif && !entree.motifRegression) {
        throw new ErreurMetier('VEHICULE_KILOMETRAGE_REGRESSIF', 'Le kilométrage saisi est inférieur au dernier relevé connu.', {
          blocages: dernier
            ? [
                {
                  type: 'champ' as const,
                  id: 'valeur',
                  libelle: 'Dernier relevé connu',
                  donnees: { valeurKm: dernier.valeurKm, releveLe: dernier.releveLe.toISOString() },
                },
              ]
            : undefined,
          actionsProposees: [{ code: 'FOURNIR_MOTIF', parametres: { motifsAcceptes: MOTIFS_KILOMETRAGE_REGRESSIF } }],
        });
      }

      if (decision.aberrant) {
        avertissements.ajouter('VEHICULE_KILOMETRAGE_ABERRANT', "Écart aberrant avec le dernier relevé connu (RM-25).", {
          nouveauValeurKm,
          dernierValeurKm: dernier?.valeurKm ?? null,
        });
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
        donnees: { valeurKm: nouveauValeurKm, unite: entree.unite, source: entree.source, releveLe: entree.releveLe },
      });

      return { donnees: versReponse(inseree), avertissements };
    });
  }
}
