import { Inject, Injectable } from '@nestjs/common';
import type { EntreeExpertiseVehicule, ReponseVehiculeExpertise } from '@dfa/shared';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../db';
import { vehiculeExpertise, type LigneVehiculeExpertise } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import { chargerLigneVehicule, listerExpertises } from './vehicule-requetes';

/**
 * DÉFAUT CORRIGÉ (issue #15, point 2) : `POST /vehicules/{id}/expertises` acceptait, sans le
 * moindre contrôle, une échéance de contre-visite (`delaiContreVisiteLe`, le délai imparti par le
 * canton) ou une contre-visite déjà réalisée (`dateContreVisiteLe`) ANTÉRIEURE à l'expertise qui
 * les déclenche — un ordre physiquement impossible (la contre-visite SUIT toujours l'expertise,
 * jamais l'inverse, § « pré-expertise / contre-visite » de `specification-etape-1-atelier-clients.md`)
 * qui fausserait silencieusement toute relance ou indicateur bâti sur ces dates (RM-29).
 *
 * REFUS NET (400 `VALIDATION_ECHOUEE`), PAS un avertissement dans l'enveloppe de réponse —
 * délibéré, par opposition à `VEHICULE_KILOMETRAGE_ABERRANT` (avertissement,
 * `service-vehicule-kilometrage.ts::creer`) :
 *  - Un kilométrage aberrant reste PLAUSIBLE (compteur remplacé, relevé exact mais inhabituel) —
 *    il existe un scénario légitime où la valeur, bien qu'atypique, est correcte, d'où
 *    l'avertissement qui laisse passer. Une contre-visite antérieure à l'expertise qui la
 *    déclenche n'a AUCUN scénario légitime : ce n'est pas une donnée inhabituelle mais une paire
 *    de dates incohérente — il n'existe rien à confirmer, seulement une saisie à corriger (le cas
 *    réel constaté, faute de frappe sur l'année).
 *  - Précédent déjà tranché dans ce dépôt pour EXACTEMENT la même famille de défaut (deux dates
 *    d'une même écriture qui se contredisent) : `vehicule_detention_periode_chk` (RM-20/CT-47,
 *    voir `erreurs-contraintes.ts` et `service-vehicule-detention.ts::relancerConflitDetention`)
 *    rejette déjà, en `VALIDATION_ECHOUEE`, une date de changement de détenteur antérieure au
 *    début de la détention qu'elle clôture. Même code, même sévérité, pour rester cohérent avec
 *    ce voisin plutôt que d'inventer un troisième traitement pour la même nature de cas.
 *  - Reprise de données historiques (Auto-i, Nextlane, tableurs) — l'objection naturelle à un
 *    refus net : `docs/reprise-donnees.md` (§ « Dernière / prochaine expertise ») documente que le
 *    délai ET la date de contre-visite sont « rarement stockés » par les DMS existants et ne sont
 *    PAS repris — une seule ligne d'expertise minimale, sans ces deux champs, suffit à la relance
 *    MFK (RM-29). Le refus ne bloque donc pas la reprise : les champs concernés n'y sont
 *    simplement jamais renseignés (`entree.delaiContreVisiteLe`/`dateContreVisiteLe` absents →
 *    aucune des deux conditions ci-dessous ne s'évalue).
 *
 * Comparaison lexicographique valide sans parser de date : `schemaDateJour` (`packages/shared`,
 * contrat gelé, non modifié ici) est `z.string().date()` — format ISO `AAAA-MM-JJ`, où l'ordre
 * lexicographique EST l'ordre chronologique. Égalité ADMISE (comparaison stricte `<`, pas `<=`) :
 * rien n'exclut qu'expertise et contre-visite soient enregistrées le même jour calendaire.
 */
export function exigerOrdreContreVisite(entree: EntreeExpertiseVehicule): void {
  if (entree.delaiContreVisiteLe && entree.delaiContreVisiteLe < entree.dateLe) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      'Le délai de contre-visite est antérieur à la date de l’expertise qui le déclenche (RM-28).',
      {
        erreurs: [
          {
            champ: 'delaiContreVisiteLe',
            code: 'anterieur_a_expertise',
            message:
              'Doit être postérieur ou égal à `dateLe` : la contre-visite suit toujours l’expertise qui la déclenche.',
          },
        ],
      },
    );
  }
  if (entree.dateContreVisiteLe && entree.dateContreVisiteLe < entree.dateLe) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      'La date de contre-visite est antérieure à la date de l’expertise qui le déclenche (RM-28).',
      {
        erreurs: [
          {
            champ: 'dateContreVisiteLe',
            code: 'anterieure_a_expertise',
            message:
              'Doit être postérieure ou égale à `dateLe` : la contre-visite suit toujours l’expertise qui la déclenche.',
          },
        ],
      },
    );
  }
}

function versReponse(ligne: LigneVehiculeExpertise): ReponseVehiculeExpertise {
  return {
    id: ligne.id,
    dateLe: ligne.dateExpertise,
    resultat: ligne.resultat,
    defauts: ligne.defauts,
    delaiContreVisiteLe: ligne.delaiContreVisite,
    dateContreVisiteLe: ligne.dateContreVisite,
    prochaineEcheanceLe: ligne.prochaineEcheance,
    // Le contrat déclare `sourceEcheance` non nullable ; la colonne base l'est (CHECK couplé à
    // `prochaine_echeance`). `calculee` par défaut quand ni l'un ni l'autre n'est renseigné —
    // cohérent avec RM-28 (aucune échéance connue = pas de convocation qui prime).
    sourceEcheance: ligne.sourceEcheance ?? 'calculee',
  };
}

/** Expertises (MFK) d'un véhicule (RM-28/29, CT-10) — la convocation cantonale prime toujours. */
@Injectable()
export class ServiceVehiculeExpertise {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    vehiculeId: string,
  ): Promise<readonly ReponseVehiculeExpertise[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      const lignes = await listerExpertises(tx, ctx, vehiculeId);
      return lignes.map(versReponse);
    });
  }

  async creer(
    ctx: ContexteTenant,
    vehiculeId: string,
    entree: EntreeExpertiseVehicule,
  ): Promise<ReponseVehiculeExpertise> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      exigerOrdreContreVisite(entree);

      const lignes = await tx
        .insert(vehiculeExpertise)
        .values({
          tenantId: ctx.tenantId,
          vehiculeId,
          dateExpertise: entree.dateLe,
          resultat: entree.resultat,
          defauts: entree.defauts ?? null,
          delaiContreVisite: entree.delaiContreVisiteLe ?? null,
          dateContreVisite: entree.dateContreVisiteLe ?? null,
          prochaineEcheance: entree.prochaineEcheanceLe ?? null,
          sourceEcheance: entree.prochaineEcheanceLe ? entree.sourceEcheance : null,
        })
        .returning();
      const inseree = lignes[0];
      if (!inseree) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "L'insertion de l'expertise n'a rendu aucune ligne.",
        );
      }
      return versReponse(inseree);
    });
  }
}
