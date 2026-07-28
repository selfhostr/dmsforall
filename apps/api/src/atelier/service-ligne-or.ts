import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  ElementBloquant,
  EntreeAnnulationLignes,
  EntreeCreationLigneOr,
  EntreeMarquageRealisee,
  EntreeModificationLigneOr,
  EntreeRefusLignes,
  EntreeSoumissionLignesADevis,
  EntreeValidationLignes,
  FiltresLignesOr,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseLigneOr,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { ligneOr, tauxHoraire, type LigneLigneOr, type LigneOrdreReparation, type LigneTauxHoraire } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../common/evenements';
import { JETON_IDEMPOTENCE, type ReponseMemorisable, type ResultatIdempotent, type ServiceIdempotence } from '../common/idempotence';

import { JETON_CALCUL_LIGNE, type CalculLigne } from './atelier.jetons';
import { roleVoitLesMontants, mapperLigneOr } from './mappeurs';
import {
  chargerLigneOrPourEcriture,
  chargerLignesPourEcriture,
  chargerOr,
  chargerOrPourEcriture,
  listerLignesOr,
} from './or-requetes';
import { decoderCurseurOffset, encoderCurseurOffset, estOrVerrouille, ServiceOr } from './service-or';
import { traduireErreurTransition } from './traducteur-transition';

/**
 * Lignes d'ordre de réparation (contrats-api-etape-1.md §7.8) : création, modification libre,
 * marquage réalisée (action de ligne), et les QUATRE actions GROUPÉES portées par l'OR (§7.7,
 * `ACTIONS_ORDRE_REPARATION` : `valider-lignes`, `refuser-lignes`, `annuler-lignes`,
 * `soumettre-lignes-a-devis`) — atomiques : tout ou rien dans une seule transaction, avec la garde
 * de plafond évaluée UNE FOIS sur le lot entier (§ réponse de tâche : « valider cinq lignes une par
 * une contre le plafond laisserait un état que personne n'a voulu »).
 *
 * `statut` n'est JAMAIS une entrée du contrat (`ligne.ts` : « statut n'est JAMAIS entrant »).
 * INTERPRÉTATION SIGNALÉE, faute de plan disponible pour ce lot : le statut initial d'une ligne
 * découle de son `origine` et du plafond de l'OR (RM-54, Δ1/Q-02) — voir `determinerStatutInitial`
 * ci-dessous. `soumettre-lignes-a-devis` fait passer des lignes `proposee` en `a_valider` (blocage
 * `accord`), préparation du devis complémentaire proprement dit
 * (`POST /ordres-reparation/{orId}/devis-complementaires`, `ServiceDevis`) — les deux endpoints ne
 * se confondent pas : l'un MARQUE des lignes en attente d'accord, l'autre ENVOIE le document.
 */
@Injectable()
export class ServiceLigneOr {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_EVENEMENTS) private readonly evenements: ServiceEvenements,
    @Inject(JETON_CALCUL_LIGNE) private readonly calcul: CalculLigne,
    private readonly serviceOr: ServiceOr,
  ) {}

  /**
   * `GET /ordres-reparation/{orId}/lignes` — collection paginée destinée aux CONNECTEURS (l'écran
   * lit les lignes embarquées dans le document OR, §8.3). SIMPLIFICATION SIGNALÉE, même doctrine
   * que `ServiceOr.journal` : filtrage/tri/pagination en mémoire (offset opaque), acceptable au
   * volume d'un seul OR (200 lignes embarquées au plus, `SEUIL_LIGNES_EMBARQUEES`).
   */
  async lister(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    filtres: FiltresLignesOr,
    limite: number,
    curseur: string | undefined,
  ): Promise<PageCurseur<ReponseLigneOr>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerOr(tx, ctx, orId);
      const toutes = await listerLignesOr(tx, ctx, orId);

      const filtrees = toutes.filter((l) => {
        if (filtres.statut && filtres.statut.length > 0 && !filtres.statut.includes(l.statut)) return false;
        if (filtres.origine && l.origine !== filtres.origine) return false;
        if (filtres.payeur && l.payeur !== filtres.payeur) return false;
        if (filtres.technicienId && l.technicienId !== filtres.technicienId) return false;
        return true;
      });
      if (filtres.tri === 'ordreAffichage:desc') filtrees.reverse();

      const decalage = decoderCurseurOffset(curseur);
      const page = filtrees.slice(decalage, decalage + limite);
      const curseurSuivant = decalage + limite < filtrees.length ? encoderCurseurOffset(decalage + limite) : null;

      return { donnees: page.map((l) => mapperLigneOr(l, principal.role)), curseurSuivant, limite };
    });
  }

  /**
   * `POST /ordres-reparation/{orId}/lignes` — `Idempotency-Key` obligatoire (saisie en rafale au
   * comptoir). Rend la ligne SEULE (pas le document OR entier) : c'est une création de
   * sous-ressource ordinaire, symétrique de `PATCH .../lignes/{ligneId}` — à la différence des
   * actions de §7.7, qui portent leur propre verbe de transition et rendent l'agrégat complet.
   */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeCreationLigneOr,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseLigneOr> }>> {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/ordres-reparation/:orId/lignes', cle: cleIdempotence, corps: { orId, ...entree } },
      async (tx) => {
        const or = await chargerOrPourEcriture(tx, ctx, orId);
        this.garantirNonVerrouille(or, orId);

        const existantes = await listerLignesOr(tx, ctx, orId);
        const numeroOrdre = (existantes.at(-1)?.numeroOrdre ?? 0) + 1;

        const tauxHoraireCentimes = this.estMainOeuvre(entree.type)
          ? await this.resoudreTauxHoraireCentimes(tx, ctx, or)
          : null;
        if (this.estMainOeuvre(entree.type) && tauxHoraireCentimes === null) {
          throw new ErreurMetier('VALIDATION_ECHOUEE', 'Aucun taux horaire résoluble pour cette ligne de main d’œuvre.', {
            erreurs: [{ champ: 'type', code: 'taux_horaire_introuvable', message: 'Taux horaire introuvable ou absent des conditions client (RM-65).' }],
          });
        }

        const montants =
          entree.payeur === 'garage'
            ? { montantHtCentimes: 0, montantTvaCentimes: 0, montantTtcCentimes: 0 } // RM-70
            : this.calcul.calculer({
                type: entree.type,
                quantiteMillieme: entree.quantiteMillieme,
                prixUnitaireCentimes: entree.prixUnitaireCentimes ?? null,
                tempsBaremeCentiemes: entree.tempsBaremeCentiemes ?? null,
                tauxHoraireCentimes,
                rabaisPourmille: entree.rabaisPourmille,
                tauxTvaPourmille: 81, // taux légal suisse par défaut ; figé de la même façon que le taux horaire (RM-65)
              });

        const statutInitial = this.determinerStatutInitial(entree.origine, entree.payeur, or, montants.montantTtcCentimes);
        const blocage = entree.blocage !== 'aucun' ? entree.blocage : statutInitial === 'a_valider' ? 'accord' : 'aucun';

        const [ligne] = await tx
          .insert(ligneOr)
          .values({
            tenantId: ctx.tenantId,
            ordreReparationId: orId,
            numeroOrdre,
            type: entree.type,
            origine: entree.origine,
            statut: statutInitial,
            payeur: entree.payeur,
            blocage,
            designation: entree.designation,
            referenceTexte: entree.referenceTexte ?? null,
            quantiteMillieme: entree.quantiteMillieme,
            tempsBaremeCentiemes: entree.tempsBaremeCentiemes ?? null,
            tauxHoraireCentimes,
            prixUnitaireCentimes: entree.prixUnitaireCentimes ?? null,
            rabaisPourmille: entree.rabaisPourmille,
            tauxTvaPourmille: 81,
            montantHtCentimes: montants.montantHtCentimes,
            montantTvaCentimes: montants.montantTvaCentimes,
            montantTtcCentimes: montants.montantTtcCentimes,
            technicienId: entree.technicienId ?? null,
            urgence: entree.urgence ?? null,
            securite: entree.securite,
            fourniParClient: entree.fournieParClient,
            aRestituer: entree.pieceARestituer,
            codeOperation: entree.codeOperation ?? null,
            codeDefaut: entree.codeDefaut ?? null,
            numeroSinistre: entree.numeroSinistre ?? null,
            numeroAccord: entree.numeroAccord ?? null,
          })
          .returning();
        if (!ligne) {
          throw new ErreurMetier('ERREUR_INTERNE', "L'insertion de la ligne n'a rendu aucune ligne.");
        }

        if (entree.origine === 'constatee') {
          await this.evenements.publier(tx, ctx, {
            type: 'ligne_or.constatee',
            versionSchema: 1,
            siteId: or.siteId,
            ressource: { type: 'ligne_or', id: ligne.id },
            donnees: { ordreReparationId: orId, designation: ligne.designation },
          });
        }

        return { statutHttp: 201, corps: { donnees: mapperLigneOr(ligne, principal.role), avertissements: [] } };
      },
    );
  }

  /**
   * `PATCH /ordres-reparation/{orId}/lignes/{ligneId}` — champs libres. Recalcule les montants
   * SI un champ de tarification change (quantité, temps barème, prix unitaire, rabais, payeur).
   * Garde `OR_PLAFOND_DEPASSE` (ligne.ts : « sur une ligne déjà `validee`, une hausse de montant
   * peut produire 409 ») quand la ligne a dépassé le stade de validation (`validee`, `en_cours`,
   * `realisee`) et que le nouveau total dépasserait le plafond de l'OR.
   */
  async modifier(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    ligneId: string,
    entree: EntreeModificationLigneOr,
  ): Promise<ReponseAvecAvertissements<ReponseLigneOr>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const or = await chargerOrPourEcriture(tx, ctx, orId);
      this.garantirNonVerrouille(or, orId);
      const ligne = await chargerLigneOrPourEcriture(tx, ctx, orId, ligneId);
      this.garantirLigneModifiable(ligne);

      const champsTarifRenseignes =
        entree.quantiteMillieme !== undefined ||
        entree.tempsBaremeCentiemes !== undefined ||
        entree.prixUnitaireCentimes !== undefined ||
        entree.rabaisPourmille !== undefined ||
        entree.payeur !== undefined ||
        entree.type !== undefined;

      const payeurEffectif = entree.payeur ?? ligne.payeur;
      const typeEffectif = entree.type ?? ligne.type;
      const tauxHoraireCentimes = this.estMainOeuvre(typeEffectif)
        ? (ligne.tauxHoraireCentimes ?? (await this.resoudreTauxHoraireCentimes(tx, ctx, or)))
        : ligne.tauxHoraireCentimes;

      const montants = !champsTarifRenseignes
        ? { montantHtCentimes: ligne.montantHtCentimes, montantTvaCentimes: ligne.montantTvaCentimes, montantTtcCentimes: ligne.montantTtcCentimes }
        : payeurEffectif === 'garage'
          ? { montantHtCentimes: 0, montantTvaCentimes: 0, montantTtcCentimes: 0 }
          : this.calcul.calculer({
              type: typeEffectif,
              quantiteMillieme: entree.quantiteMillieme ?? ligne.quantiteMillieme ?? 1000,
              prixUnitaireCentimes: entree.prixUnitaireCentimes ?? ligne.prixUnitaireCentimes,
              tempsBaremeCentiemes: entree.tempsBaremeCentiemes ?? ligne.tempsBaremeCentiemes,
              tauxHoraireCentimes,
              rabaisPourmille: entree.rabaisPourmille ?? ligne.rabaisPourmille ?? 0,
              tauxTvaPourmille: ligne.tauxTvaPourmille,
            });

      const STATUTS_COMPTES_DANS_PLAFOND: ReadonlySet<LigneLigneOr['statut']> = new Set(['validee', 'en_cours', 'realisee', 'facturee']);
      if (or.plafondCentimes !== null && STATUTS_COMPTES_DANS_PLAFOND.has(ligne.statut)) {
        const nouveauTotal = or.totalValideCentimes - ligne.montantTtcCentimes + montants.montantTtcCentimes;
        if (nouveauTotal > or.plafondCentimes) {
          throw new ErreurMetier('OR_PLAFOND_DEPASSE', `Le plafond autorisé (${String(or.plafondCentimes)} centimes) serait dépassé.`, {
            blocages: [this.blocageLigne(ligne, roleVoitLesMontants(principal.role))],
            actionsProposees: [{ code: 'CREER_DEVIS_COMPLEMENTAIRE', methode: 'POST', parametres: { ligneIds: [ligneId] } }],
          });
        }
      }

      const [misAJour] = await tx
        .update(ligneOr)
        .set({
          ...(entree.type !== undefined ? { type: entree.type } : {}),
          ...(entree.designation !== undefined ? { designation: entree.designation } : {}),
          ...(entree.referenceTexte !== undefined ? { referenceTexte: entree.referenceTexte ?? null } : {}),
          ...(entree.quantiteMillieme !== undefined ? { quantiteMillieme: entree.quantiteMillieme } : {}),
          ...(entree.tempsBaremeCentiemes !== undefined ? { tempsBaremeCentiemes: entree.tempsBaremeCentiemes ?? null } : {}),
          ...(entree.prixUnitaireCentimes !== undefined ? { prixUnitaireCentimes: entree.prixUnitaireCentimes ?? null } : {}),
          ...(entree.rabaisPourmille !== undefined ? { rabaisPourmille: entree.rabaisPourmille } : {}),
          ...(entree.payeur !== undefined ? { payeur: entree.payeur } : {}),
          ...(entree.technicienId !== undefined ? { technicienId: entree.technicienId ?? null } : {}),
          ...(entree.urgence !== undefined ? { urgence: entree.urgence ?? null } : {}),
          ...(entree.securite !== undefined ? { securite: entree.securite } : {}),
          ...(entree.fournieParClient !== undefined ? { fourniParClient: entree.fournieParClient } : {}),
          ...(entree.pieceARestituer !== undefined ? { aRestituer: entree.pieceARestituer } : {}),
          ...(entree.codeOperation !== undefined ? { codeOperation: entree.codeOperation ?? null } : {}),
          ...(entree.codeDefaut !== undefined ? { codeDefaut: entree.codeDefaut ?? null } : {}),
          ...(entree.numeroSinistre !== undefined ? { numeroSinistre: entree.numeroSinistre ?? null } : {}),
          ...(entree.numeroAccord !== undefined ? { numeroAccord: entree.numeroAccord ?? null } : {}),
          ...(entree.blocage !== undefined ? { blocage: entree.blocage } : {}),
          ...(tauxHoraireCentimes !== ligne.tauxHoraireCentimes ? { tauxHoraireCentimes } : {}),
          montantHtCentimes: montants.montantHtCentimes,
          montantTvaCentimes: montants.montantTvaCentimes,
          montantTtcCentimes: montants.montantTtcCentimes,
        })
        .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligneId)))
        .returning();
      if (!misAJour) {
        throw new ErreurMetier('ERREUR_INTERNE', "La mise à jour de la ligne n'a rendu aucune ligne.");
      }

      return { donnees: mapperLigneOr(misAJour, principal.role), avertissements: [] };
    });
  }

  /**
   * `POST .../lignes/{ligneId}/marquer-realisee` (§7.9) — `en_cours -> realisee` uniquement ;
   * `refusee -> realisee` n'existe pas dans `transition_autorisee` (RM-72, CT-28) et lève
   * `LIGNE_TRANSITION_INTERDITE` via le même mécanisme ZDFA1 que les transitions d'OR.
   */
  async marquerRealisee(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    ligneId: string,
    entree: EntreeMarquageRealisee,
  ): Promise<ReponseAvecAvertissements<ReponseLigneOr>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const or = await chargerOrPourEcriture(tx, ctx, orId);
      this.garantirNonVerrouille(or, orId);
      const ligne = await chargerLigneOrPourEcriture(tx, ctx, orId, ligneId);

      const misAJour = await this.transitionnerLigne(tx, ctx, ligne, 'realisee', {});
      // `temps_reel_centiemes` n'a nulle part où se poser en base au lot 1 (Δ4, module pointage
      // absent) — voir `mappeurs.ts` : le champ du contrat reste exposé à `null`, jamais omis.
      void entree.tempsReelCentiemes;

      return { donnees: mapperLigneOr(misAJour, principal.role), avertissements: [] };
    });
  }

  /** `POST /ordres-reparation/{orId}/valider-lignes` — `proposee|a_valider -> validee`, ATOMIQUE :
   *  le plafond (RM-54) est vérifié UNE FOIS sur la somme du lot avant toute écriture. */
  async validerLignes(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeValidationLignes,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executerActionGroupee(ctx, principal, orId, entree.ligneIds, async (tx, or, cibles) => {
      const eligibles = cibles.filter((l) => l.statut === 'proposee' || l.statut === 'a_valider');
      if (or.plafondCentimes !== null) {
        const totalCandidat = or.totalValideCentimes + eligibles.reduce((s, l) => s + l.montantTtcCentimes, 0);
        if (totalCandidat > or.plafondCentimes) {
          throw new ErreurMetier('OR_PLAFOND_DEPASSE', `Le plafond autorisé (${String(or.plafondCentimes)} centimes) serait dépassé.`, {
            blocages: eligibles.map((l) => this.blocageLigne(l, roleVoitLesMontants(principal.role))),
            actionsProposees: [{ code: 'CREER_DEVIS_COMPLEMENTAIRE', methode: 'POST', parametres: { ligneIds: eligibles.map((l) => l.id) } }],
          });
        }
      }
      for (const ligne of eligibles) {
        await this.transitionnerLigne(tx, ctx, ligne, 'validee', {});
      }
    });
  }

  /** `POST /ordres-reparation/{orId}/refuser-lignes` — `a_valider -> refusee` (CT-33).
   *  SIMPLIFICATION SIGNALÉE : n'alimente pas encore les travaux reportés du véhicule (RM-73,
   *  propriété du module `vehicules/`, hors périmètre de ce fichier) — voir réponse de tâche. */
  async refuserLignes(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeRefusLignes,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executerActionGroupee(ctx, principal, orId, entree.ligneIds, async (tx, _or, cibles) => {
      for (const ligne of cibles) {
        await this.transitionnerLigne(tx, ctx, ligne, 'refusee', {});
      }
    });
  }

  /** `POST /ordres-reparation/{orId}/annuler-lignes` — motif OBLIGATOIRE (RM-71), un seul motif
   *  partagé par tout le lot. Couvre désormais TOUTE ligne non facturée : `proposee -> annulee` et
   *  `a_valider -> annulee` (0009, comble la lacune signalée dans 0003 §5.2 — une ligne saisie par
   *  erreur avant toute décision client restait auparavant coincée sur l'OR, sans sortie possible
   *  et sans DELETE accordé) en plus de `validee|en_cours|realisee -> annulee` (0003, inchangées).
   *  Aucun filtrage par statut ici (à la différence de `validerLignes`) : une cible dans un état
   *  qui n'admet pas `annulee` (`facturee`, déjà `annulee`, `refusee`) fait échouer TOUTE l'action
   *  groupée via `LIGNE_TRANSITION_INTERDITE` — cohérent avec la sémantique « tout ou rien » des
   *  quatre actions groupées (§7.7) : un lot partiellement annulé n'est un état voulu par personne. */
  async annulerLignes(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeAnnulationLignes,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executerActionGroupee(ctx, principal, orId, entree.ligneIds, async (tx, _or, cibles) => {
      for (const ligne of cibles) {
        await this.transitionnerLigne(tx, ctx, ligne, 'annulee', { motifAnnulation: entree.motif });
      }
    });
  }

  /**
   * `POST /ordres-reparation/{orId}/soumettre-lignes-a-devis` — `proposee -> a_valider`,
   * `blocage = 'accord'` : marque les lignes en attente d'une décision client, préalable à
   * `POST .../devis-complementaires` (`ServiceDevis`), pas la création du devis lui-même
   * (INTERPRÉTATION SIGNALÉE — voir l'en-tête de ce fichier).
   */
  async soumettreLignesADevis(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeSoumissionLignesADevis,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executerActionGroupee(ctx, principal, orId, entree.ligneIds, async (tx, _or, cibles) => {
      for (const ligne of cibles) {
        await this.transitionnerLigne(tx, ctx, ligne, 'a_valider', { blocage: 'accord' });
      }
    });
  }

  // -----------------------------------------------------------------------------------------
  // Infrastructure interne
  // -----------------------------------------------------------------------------------------

  /** Verrouille l'OR et les lignes ciblées, exécute `travail`, rend le document OR complet —
   *  point d'entrée UNIQUE des quatre actions groupées (§7.7). */
  private async executerActionGroupee(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    ligneIds: readonly string[],
    travail: (tx: TransactionDfa, or: LigneOrdreReparation, cibles: readonly LigneLigneOr[]) => Promise<void>,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const or = await chargerOrPourEcriture(tx, ctx, orId);
      this.garantirNonVerrouille(or, orId);
      const cibles = await chargerLignesPourEcriture(tx, ctx, orId, ligneIds);
      await travail(tx, or, cibles);
      const document = await this.serviceOr.assemblerDocument(tx, ctx, principal.role, orId);
      return { donnees: document, avertissements: [] };
    });
  }

  /** Écrit `ligne_or.statut` — traduit le SQLSTATE `ZDFA1` en `ErreurMetier` exploitable, comme
   *  `ServiceTransitions.transitionner` le fait pour `ordre_reparation`. */
  private async transitionnerLigne(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneLigneOr,
    versStatut: LigneLigneOr['statut'],
    champs: Partial<Omit<LigneLigneOr, 'id' | 'tenantId' | 'statut'>>,
  ): Promise<LigneLigneOr> {
    try {
      const [misAJour] = await tx
        .update(ligneOr)
        .set({ statut: versStatut, ...champs })
        .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligne.id)))
        .returning();
      if (!misAJour) {
        throw new ErreurMetier('ERREUR_INTERNE', "La mise à jour de la ligne n'a rendu aucune ligne.");
      }
      return misAJour;
    } catch (erreur) {
      const traduite = traduireErreurTransition(erreur, ligne.id, ligne.designation ?? '');
      if (traduite) throw traduite;
      throw erreur;
    }
  }

  private garantirNonVerrouille(or: LigneOrdreReparation, orId: string): void {
    if (estOrVerrouille(or.statut)) {
      throw new ErreurMetier('OR_LIGNE_VERROUILLEE', `Ordre de réparation verrouillé (statut ${or.statut}).`, {
        blocages: [{ type: 'ordre_reparation', id: orId, libelle: or.numero, donnees: { statutActuel: or.statut } }],
        actionsProposees: [{ code: 'RAFRAICHIR' }],
      });
    }
  }

  /** Une ligne déjà `facturee`/`annulee` est figée même si l'OR reste ouvert (I-15 s'applique à
   *  l'OR, pas à la ligne — garde locale, interprétation signalée). */
  private garantirLigneModifiable(ligne: LigneLigneOr): void {
    if (ligne.statut === 'facturee' || ligne.statut === 'annulee') {
      throw new ErreurMetier('OR_LIGNE_VERROUILLEE', `Ligne verrouillée (statut ${ligne.statut}).`, {
        blocages: [{ type: 'ligne_or', id: ligne.id, libelle: ligne.designation ?? '', donnees: { statutActuel: ligne.statut } }],
        actionsProposees: [{ code: 'RAFRAICHIR' }],
      });
    }
  }

  private blocageLigne(ligne: LigneLigneOr, voitMontants: boolean): ElementBloquant {
    return {
      type: 'ligne_or',
      id: ligne.id,
      libelle: ligne.designation ?? '',
      donnees: {
        numeroLigne: ligne.numeroOrdre,
        origine: ligne.origine,
        ...(voitMontants ? { totalTtcCentimes: ligne.montantTtcCentimes } : {}),
      },
    };
  }

  private estMainOeuvre(type: string): boolean {
    return type === 'main_oeuvre_bareme' || type === 'main_oeuvre_temps_reel';
  }

  /**
   * RM-65 : le taux horaire est FIGÉ à la création depuis le code porté par les conditions
   * commerciales figées de l'OR (`or.conditionsFigees.tauxHoraireCode`, capturées par
   * `ServiceSnapshotOr` à l'ouverture). Lecture directe de `taux_horaire`, même doctrine que
   * `references.ts` pour `parametre_atelier` : pas de jeton pour une lecture de table.
   */
  private async resoudreTauxHoraireCentimes(tx: TransactionDfa, ctx: ContexteTenant, or: LigneOrdreReparation): Promise<number | null> {
    const conditions = (or.conditionsFigees as { tauxHoraireCode?: string | null } | null) ?? null;
    const code = conditions?.tauxHoraireCode;
    if (!code) return null;

    const lignes: readonly LigneTauxHoraire[] = await tx
      .select()
      .from(tauxHoraire)
      .where(and(eq(tauxHoraire.tenantId, ctx.tenantId), eq(tauxHoraire.code, code)));

    const dateJour = new Date().toISOString().slice(0, 10);
    const valide = lignes.find((l) => l.valideDu <= dateJour && (l.valideAu === null || l.valideAu >= dateJour));
    return valide?.montantCentimes ?? null;
  }

  /**
   * INTERPRÉTATION SIGNALÉE (voir l'en-tête de ce fichier) : `constatee` -> `proposee` (un constat
   * technicien n'est jamais pré-accordé) ; `garage` -> `validee` (valorisée à 0, RM-70, aucune
   * décision de paiement à attendre) ; sinon, `a_valider` si le plafond de l'OR serait dépassé
   * (Δ1/Q-02 : `0` = accord requis pour toute validation payante, `n>0` = plafond nominal, `null` =
   * aucune garde), `validee` sinon.
   */
  private determinerStatutInitial(
    origine: string,
    payeur: string,
    or: LigneOrdreReparation,
    montantTtcCentimes: number,
  ): 'proposee' | 'a_valider' | 'validee' {
    if (payeur === 'garage') return 'validee';
    if (origine === 'constatee') return 'proposee';
    if (or.plafondCentimes !== null && or.totalValideCentimes + montantTtcCentimes > or.plafondCentimes) return 'a_valider';
    return 'validee';
  }
}
