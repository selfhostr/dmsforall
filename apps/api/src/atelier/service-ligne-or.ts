import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  schemaModificationLigneOr,
  type CodeActionProposee,
  type ElementBloquant,
  type EntreeAnnulationLignes,
  type EntreeCreationLigneOr,
  type EntreeMarquageRealisee,
  type EntreeModificationLigneOr,
  type EntreeRefusLignes,
  type EntreeSoumissionLignesADevis,
  type EntreeValidationLignes,
  type FiltresLignesOr,
  type PageCurseur,
  type PayeurLigneOr,
  type ReponseAvecAvertissements,
  type ReponseLigneOr,
  type ReponseOrdreReparation,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  ligneOr,
  reservationPiece,
  type LigneLigneOr,
  type LigneOrdreReparation,
  type NouvelleReservationPiece,
} from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { neGarderQueChampsEnvoyes, PipeZod } from '../common/validation';
import { remonterCausePg } from '../common/erreurs-pg/remonter-cause-pg';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../common/evenements';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';
import { ServiceConsigne } from '../pieces/service-consigne';
import { ServiceReservation } from '../pieces/service-reservation';

import {
  JETON_CALCUL_LIGNE,
  JETON_CREATION_TRAVAIL_REPORTE,
  type CalculLigne,
  type CreationTravailReporte,
} from './atelier.jetons';
import { roleVoitLesMontants, mapperLigneOr } from './mappeurs';
import {
  chargerLigneOrPourEcriture,
  chargerLignesPourEcriture,
  chargerOr,
  chargerOrPourEcriture,
  listerLignesOr,
} from './or-requetes';
import { chargerArticleLigne, chargerClientLigne } from './references';
import {
  decoderCurseurOffset,
  encoderCurseurOffset,
  estOrVerrouille,
  ServiceOr,
} from './service-or';
import {
  chargerToutesTauxHoraire,
  resoudreTauxHorairePourDate,
  type ResolutionTauxHoraire,
} from './taux-horaire';
import { traduireErreurTransition } from './traducteur-transition';

/** `AC-08`/`MD-62`/`MD-67` : `payeurClientId` obligatoire et UNIQUEMENT pour ces trois payeurs —
 *  règle SERVEUR (pas zod, voir le commentaire de `ReponseLigneOr.payeurClientId` dans le
 *  contrat) : `schemaCreationLigneOr` doit rester un `ZodObject` nu pour que
 *  `schemaModificationLigneOr` continue à l'`.omit()`/`.partial()`. */
const PAYEURS_AVEC_TIERS: ReadonlySet<PayeurLigneOr> = new Set([
  'constructeur',
  'assurance',
  'tiers',
]);

/**
 * Réexporté depuis `taux-horaire.ts` (#72) — déplacé là pour devenir le mécanisme PARTAGÉ de
 * résolution RM-65, réutilisé aussi par `clients/service-client-sous-collections.ts` pour afficher
 * le taux horaire lisible d'une condition commerciale. Réexporté ICI pour ne rien casser côté
 * imports existants (`service-ligne-or.spec.ts` : `import { CODE_TAUX_HORAIRE_DEFAUT } from
 * './service-ligne-or'`).
 */
export { CODE_TAUX_HORAIRE_DEFAUT } from './taux-horaire';

/** Statuts depuis lesquels une ligne peut être marquée réalisée (0076) : `validee` (sans
 *  pointage) et `en_cours` (après un pointage). */
const STATUTS_REALISABLES: ReadonlySet<string> = new Set(['validee', 'en_cours']);

/** Libellé garagiste d'un statut de ligne + la marche à suivre quand on tente de la réaliser. */
const CONSIGNE_REALISATION_PAR_STATUT: Readonly<
  Record<
    string,
    { readonly libelle: string; readonly marche: string; readonly action: CodeActionProposee }
  >
> = {
  proposee: {
    libelle: 'proposée',
    marche: 'Validez d’abord la ligne, puis marquez-la réalisée.',
    action: 'VALIDER_LIGNES',
  },
  a_valider: {
    libelle: 'en attente de l’accord du client',
    marche: 'Validez la ligne une fois l’accord reçu, puis marquez-la réalisée.',
    action: 'VALIDER_LIGNES',
  },
  refusee: {
    libelle: 'refusée par le client',
    marche: 'Une ligne refusée ne peut pas être réalisée : demandez un nouvel accord au client.',
    action: 'RAFRAICHIR',
  },
  realisee: {
    libelle: 'déjà réalisée',
    marche: 'Rien à faire : la ligne est déjà réalisée.',
    action: 'RAFRAICHIR',
  },
  facturee: {
    libelle: 'déjà facturée',
    marche: 'Une ligne facturée est figée : corrigez par un avoir.',
    action: 'RAFRAICHIR',
  },
  annulee: {
    libelle: 'annulée',
    marche: 'Une ligne annulée ne peut plus être réalisée : ajoutez une nouvelle ligne.',
    action: 'RAFRAICHIR',
  },
};

/**
 * Garde applicative de `marquerRealisee` : le trigger ZDFA1 dit seulement « transition interdite » ;
 * ici le `detail` du problème dit le statut actuel, les statuts acceptés et ce qu'il faut faire.
 */
export function refuserSiRealisationImpossible(ligne: LigneLigneOr, voitMontants: boolean): void {
  if (STATUTS_REALISABLES.has(ligne.statut)) return;
  const consigne = CONSIGNE_REALISATION_PAR_STATUT[ligne.statut];
  const libelle = consigne?.libelle ?? ligne.statut;
  throw new ErreurMetier(
    'LIGNE_TRANSITION_INTERDITE',
    `Transition ${ligne.statut} → realisee interdite.`,
    {
      detail:
        `La ligne est ${libelle} : seule une ligne validée ou en cours peut être marquée réalisée. ` +
        (consigne?.marche ?? 'Actualisez l’ordre de réparation.'),
      blocages: [
        {
          type: 'ligne_or',
          id: ligne.id,
          libelle: ligne.designation ?? '',
          donnees: {
            statutActuel: ligne.statut,
            statutDemande: 'realisee',
            statutsAcceptes: ['validee', 'en_cours'],
            numeroLigne: ligne.numeroOrdre,
            origine: ligne.origine,
            ...(voitMontants ? { totalTtcCentimes: ligne.montantTtcCentimes } : {}),
          },
        },
      ],
      actionsProposees: [{ code: consigne?.action ?? 'RAFRAICHIR' }],
    },
  );
}

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
    @Inject(JETON_CREATION_TRAVAIL_REPORTE) private readonly travailReporte: CreationTravailReporte,
    private readonly serviceOr: ServiceOr,
    private readonly serviceReservation: ServiceReservation,
    private readonly serviceConsigne: ServiceConsigne,
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
        if (filtres.statut && filtres.statut.length > 0 && !filtres.statut.includes(l.statut))
          return false;
        if (filtres.origine && l.origine !== filtres.origine) return false;
        if (filtres.payeur && l.payeur !== filtres.payeur) return false;
        if (filtres.technicienId && l.technicienId !== filtres.technicienId) return false;
        return true;
      });
      if (filtres.tri === 'ordreAffichage:desc') filtrees.reverse();

      const decalage = decoderCurseurOffset(curseur);
      const page = filtrees.slice(decalage, decalage + limite);
      const curseurSuivant =
        decalage + limite < filtrees.length ? encoderCurseurOffset(decalage + limite) : null;

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
  ): Promise<
    ResultatIdempotent<ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseLigneOr> }>
  > {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/ordres-reparation/:orId/lignes',
        cle: cleIdempotence,
        corps: { orId, ...entree },
      },
      async (tx) => {
        const or = await chargerOrPourEcriture(tx, ctx, orId);
        this.garantirNonVerrouille(or, orId);

        const existantes = await listerLignesOr(tx, ctx, orId);
        const numeroOrdre = (existantes.at(-1)?.numeroOrdre ?? 0) + 1;

        const tauxHoraireCentimes = this.estMainOeuvre(entree.type)
          ? this.exigerTauxHoraire(await this.resoudreTauxHoraireCentimes(tx, ctx, or))
          : null;

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

        // `AC-08`/`MD-62`/`MD-67` : `payeurClientId` obligatoire pour un payeur tiers réel, refusé
        // sinon — règle SERVEUR (voir `PAYEURS_AVEC_TIERS` en tête de fichier). Vérifie aussi
        // l'existence du client désigné, tenant-scopée (`chargerClientLigne` lève
        // `RESSOURCE_INTROUVABLE` sinon) : la FK composite (migration 0017) le garantirait de
        // toute façon en base, mais un rejet lisible AVANT l'écriture vaut mieux qu'une violation
        // de contrainte traduite après coup.
        const payeurAttendTiers = PAYEURS_AVEC_TIERS.has(entree.payeur);
        if (payeurAttendTiers && !entree.payeurClientId) {
          throw new ErreurMetier(
            'VALIDATION_ECHOUEE',
            `payeurClientId est obligatoire pour payeur = « ${entree.payeur} » (AC-08, MD-62).`,
            {
              erreurs: [
                {
                  champ: 'payeurClientId',
                  code: 'requis',
                  message: 'Le tiers payeur doit être désigné.',
                },
              ],
            },
          );
        }
        if (!payeurAttendTiers && entree.payeurClientId) {
          throw new ErreurMetier(
            'VALIDATION_ECHOUEE',
            `payeurClientId doit être absent pour payeur = « ${entree.payeur} » (AC-08, MD-62).`,
            {
              erreurs: [
                {
                  champ: 'payeurClientId',
                  code: 'interdit',
                  message: "Seuls 'constructeur', 'assurance' et 'tiers' portent un tiers payeur.",
                },
              ],
            },
          );
        }
        if (entree.payeurClientId) await chargerClientLigne(tx, ctx, entree.payeurClientId);
        if (entree.articleId) await this.garantirArticleUtilisable(tx, ctx, entree.articleId);

        const statutInitial = this.determinerStatutInitial(
          entree.origine,
          entree.payeur,
          or,
          montants.montantTtcCentimes,
        );
        const blocage =
          entree.blocage !== 'aucun'
            ? entree.blocage
            : statutInitial === 'a_valider'
              ? 'accord'
              : 'aucun';

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
            payeurClientId: entree.payeurClientId ?? null,
            blocage,
            designation: entree.designation,
            referenceTexte: entree.referenceTexte ?? null,
            articleId: entree.articleId ?? null,
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
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "L'insertion de la ligne n'a rendu aucune ligne.",
          );
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

        const ligneFinale = await this.reserverPieceSiApplicable(tx, ctx, ligne, or);

        return {
          statutHttp: 201,
          corps: { donnees: mapperLigneOr(ligneFinale, principal.role), avertissements: [] },
        };
      },
    );
  }

  /**
   * `PATCH /ordres-reparation/{orId}/lignes/{ligneId}` — champs libres. Recalcule les montants
   * SI un champ de tarification change (quantité, temps barème, prix unitaire, rabais, payeur).
   * Garde `OR_PLAFOND_DEPASSE` (ligne.ts : « sur une ligne déjà `validee`, une hausse de montant
   * peut produire 409 ») quand la ligne a dépassé le stade de validation (`validee`, `en_cours`,
   * `realisee`) et que le nouveau total dépasserait le plafond de l'OR.
   *
   * F-01-bis (même défaut que `client/service-client-sous-collections.ts` — voir
   * `neGarderQueChampsEnvoyes`) : `schemaModificationLigneOr` porte SIX `.default(...)` que
   * `.partial()` ne neutralise PAS (`quantiteMillieme(1000)`, `rabaisPourmille(0)`,
   * `payeur('client')`, `securite(false)`, `fournieParClient(false)`, `pieceARestituer(false)`).
   * Reçoit donc le corps BRUT (jamais pré-parsé par le contrôleur, voir `ligne-or.controller.ts`)
   * et fait le `.parse()` ICI, puis filtre par présence réelle dans `corpsBrut` — sinon un `PATCH
   * { designation }` isolé ressortirait avec les six défauts injectés et les écrirait tels quels :
   * payeur rebasculé sur `'client'` (une ligne prise en charge par l'assurance/le constructeur/le
   * garage repasse silencieusement à la charge du client), quantité/rabais remis à zéro, drapeaux
   * `securite`/`fournieParClient`/`pieceARestituer` effacés. Voir le test "F-01-bis" de
   * `service-ligne-or.spec.ts` pour la preuve rouge → verte (ligne `payeur = 'garage'`, geste
   * commercial à 0.-, qui se remettait silencieusement à facturer le client).
   */
  async modifier(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    ligneId: string,
    corpsBrut: Record<string, unknown>,
  ): Promise<ReponseAvecAvertissements<ReponseLigneOr>> {
    const entreeParsee = new PipeZod(schemaModificationLigneOr).transform(corpsBrut);
    const entree: EntreeModificationLigneOr = neGarderQueChampsEnvoyes(corpsBrut, entreeParsee);
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
      // Le taux DÉJÀ figé sur la ligne prime (RM-65 : figé à la création, il ne bouge plus) ; il
      // n'est résolu ici que pour une ligne qui DEVIENT de la main-d'œuvre par ce `PATCH`. Même
      // garde explicite qu'à la création : sans elle, un taux non résoluble descendait jusqu'à
      // l'`UPDATE` et se traduisait par une violation de `ligne_or_taux_horaire_requis_chk`
      // (migration 0008) — soit une erreur serveur illisible au lieu d'un 400 actionnable.
      const tauxHoraireCentimes = this.estMainOeuvre(typeEffectif)
        ? (ligne.tauxHoraireCentimes ??
          this.exigerTauxHoraire(await this.resoudreTauxHoraireCentimes(tx, ctx, or)))
        : ligne.tauxHoraireCentimes;

      const montants = !champsTarifRenseignes
        ? {
            montantHtCentimes: ligne.montantHtCentimes,
            montantTvaCentimes: ligne.montantTvaCentimes,
            montantTtcCentimes: ligne.montantTtcCentimes,
          }
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

      // Même règle SERVEUR qu'à la création (AC-08/MD-62/MD-67), évaluée sur le payeur EFFECTIF
      // (après fusion avec l'existant) — un `PATCH { payeur: 'assurance' }` sans `payeurClientId`
      // (ni sur la ligne existante ni dans ce corps) doit être refusé, pas silencieusement accepté
      // avec un tiers `null`.
      const payeurClientIdEffectif =
        entree.payeurClientId !== undefined ? entree.payeurClientId : ligne.payeurClientId;
      const payeurEffectifAttendTiers = PAYEURS_AVEC_TIERS.has(payeurEffectif);
      if (payeurEffectifAttendTiers && !payeurClientIdEffectif) {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          `payeurClientId est obligatoire pour payeur = « ${payeurEffectif} » (AC-08, MD-62).`,
          {
            erreurs: [
              {
                champ: 'payeurClientId',
                code: 'requis',
                message: 'Le tiers payeur doit être désigné.',
              },
            ],
          },
        );
      }
      if (!payeurEffectifAttendTiers && payeurClientIdEffectif) {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          `payeurClientId doit être absent pour payeur = « ${payeurEffectif} » (AC-08, MD-62).`,
          {
            erreurs: [
              {
                champ: 'payeurClientId',
                code: 'interdit',
                message: "Seuls 'constructeur', 'assurance' et 'tiers' portent un tiers payeur.",
              },
            ],
          },
        );
      }
      if (entree.payeurClientId) await chargerClientLigne(tx, ctx, entree.payeurClientId);
      // `articleId` : mêmes garanties qu'à la création (tenant, désactivation) — mais AUCUN effet
      // de bord sur `reservation_piece` ici. RP-19/RP-20 (`pieces/reservation.ts`, GELÉ) ne fait
      // naître une réservation qu'à `POST …/lignes` ; un `PATCH` qui pose ou change `articleId`
      // après coup laisse donc la ligne sans réservation correspondante — écart SIGNALÉ au rapport
      // de livraison, pas tranché ici (aucune consigne du contrat pour ce cas).
      if (entree.articleId) await this.garantirArticleUtilisable(tx, ctx, entree.articleId);

      const STATUTS_COMPTES_DANS_PLAFOND: ReadonlySet<LigneLigneOr['statut']> = new Set([
        'validee',
        'en_cours',
        'realisee',
        'facturee',
      ]);
      if (or.plafondCentimes !== null && STATUTS_COMPTES_DANS_PLAFOND.has(ligne.statut)) {
        const nouveauTotal =
          or.totalValideCentimes - ligne.montantTtcCentimes + montants.montantTtcCentimes;
        if (nouveauTotal > or.plafondCentimes) {
          throw new ErreurMetier(
            'OR_PLAFOND_DEPASSE',
            `Le plafond autorisé (${String(or.plafondCentimes)} centimes) serait dépassé.`,
            {
              blocages: [this.blocageLigne(ligne, roleVoitLesMontants(principal.role))],
              actionsProposees: [
                {
                  code: 'CREER_DEVIS_COMPLEMENTAIRE',
                  methode: 'POST',
                  parametres: { ligneIds: [ligneId] },
                },
              ],
            },
          );
        }
      }

      const [misAJour] = await tx
        .update(ligneOr)
        .set({
          ...(entree.type !== undefined ? { type: entree.type } : {}),
          ...(entree.designation !== undefined ? { designation: entree.designation } : {}),
          ...(entree.referenceTexte !== undefined
            ? { referenceTexte: entree.referenceTexte ?? null }
            : {}),
          ...(entree.articleId !== undefined ? { articleId: entree.articleId ?? null } : {}),
          ...(entree.quantiteMillieme !== undefined
            ? { quantiteMillieme: entree.quantiteMillieme }
            : {}),
          ...(entree.tempsBaremeCentiemes !== undefined
            ? { tempsBaremeCentiemes: entree.tempsBaremeCentiemes ?? null }
            : {}),
          ...(entree.prixUnitaireCentimes !== undefined
            ? { prixUnitaireCentimes: entree.prixUnitaireCentimes ?? null }
            : {}),
          ...(entree.rabaisPourmille !== undefined
            ? { rabaisPourmille: entree.rabaisPourmille }
            : {}),
          ...(entree.payeur !== undefined ? { payeur: entree.payeur } : {}),
          ...(entree.payeurClientId !== undefined ||
          (entree.payeur !== undefined && !payeurEffectifAttendTiers)
            ? { payeurClientId: payeurEffectifAttendTiers ? payeurClientIdEffectif : null }
            : {}),
          ...(entree.technicienId !== undefined
            ? { technicienId: entree.technicienId ?? null }
            : {}),
          ...(entree.urgence !== undefined ? { urgence: entree.urgence ?? null } : {}),
          ...(entree.securite !== undefined ? { securite: entree.securite } : {}),
          ...(entree.fournieParClient !== undefined
            ? { fourniParClient: entree.fournieParClient }
            : {}),
          ...(entree.pieceARestituer !== undefined ? { aRestituer: entree.pieceARestituer } : {}),
          ...(entree.codeOperation !== undefined
            ? { codeOperation: entree.codeOperation ?? null }
            : {}),
          ...(entree.codeDefaut !== undefined ? { codeDefaut: entree.codeDefaut ?? null } : {}),
          ...(entree.numeroSinistre !== undefined
            ? { numeroSinistre: entree.numeroSinistre ?? null }
            : {}),
          ...(entree.numeroAccord !== undefined
            ? { numeroAccord: entree.numeroAccord ?? null }
            : {}),
          ...(entree.blocage !== undefined ? { blocage: entree.blocage } : {}),
          ...(tauxHoraireCentimes !== ligne.tauxHoraireCentimes ? { tauxHoraireCentimes } : {}),
          montantHtCentimes: montants.montantHtCentimes,
          montantTvaCentimes: montants.montantTvaCentimes,
          montantTtcCentimes: montants.montantTtcCentimes,
        })
        .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligneId)))
        .returning();
      if (!misAJour) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "La mise à jour de la ligne n'a rendu aucune ligne.",
        );
      }

      return { donnees: mapperLigneOr(misAJour, principal.role), avertissements: [] };
    });
  }

  /**
   * `POST .../lignes/{ligneId}/marquer-realisee` (§7.9) — `validee|en_cours -> realisee`, pour
   * TOUS les types de ligne et SANS pointage (0076) : un garage qui ne pointe pas doit pouvoir
   * facturer ses heures. Depuis tout autre statut (`refusee -> realisee` n'existe pas, RM-72,
   * CT-28), `LIGNE_TRANSITION_INTERDITE` dont le `detail` dit le statut actuel, les statuts
   * acceptés et l'action à faire (`refuserTransitionRealisation`). Le trigger ZDFA1 reste le
   * filet si le statut change entre la lecture et l'écriture.
   *
   * RP-21/RP-38 (`pieces/reservation.ts`, `pieces/consigne.ts`) : une ligne `piece` réservée sort
   * PHYSIQUEMENT du stock (`sortie_or`) et, si l'article est d'échange standard, pose la consigne
   * — DANS LA MÊME TRANSACTION `tx` que le passage à `realisee`, composée via
   * `ServiceReservation.satisfairePourLigneTx`/`ServiceConsigne.creerDepuisRealisationTx` (voir
   * `satisfaireReservationSiApplicable` ci-dessous).
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
      refuserSiRealisationImpossible(ligne, roleVoitLesMontants(principal.role));

      const misAJour = await this.transitionnerLigne(tx, ctx, ligne, 'realisee', {});
      // `temps_reel_centiemes` n'a nulle part où se poser en base au lot 1 (Δ4, module pointage
      // absent) — voir `mappeurs.ts` : le champ du contrat reste exposé à `null`, jamais omis.
      void entree.tempsReelCentiemes;

      await this.satisfaireReservationSiApplicable(tx, ctx, misAJour);

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
    return this.executerActionGroupee(
      ctx,
      principal,
      orId,
      entree.ligneIds,
      async (tx, or, cibles) => {
        const eligibles = cibles.filter((l) => l.statut === 'proposee' || l.statut === 'a_valider');
        if (or.plafondCentimes !== null) {
          const totalCandidat =
            or.totalValideCentimes + eligibles.reduce((s, l) => s + l.montantTtcCentimes, 0);
          if (totalCandidat > or.plafondCentimes) {
            throw new ErreurMetier(
              'OR_PLAFOND_DEPASSE',
              `Le plafond autorisé (${String(or.plafondCentimes)} centimes) serait dépassé.`,
              {
                blocages: eligibles.map((l) =>
                  this.blocageLigne(l, roleVoitLesMontants(principal.role)),
                ),
                actionsProposees: [
                  {
                    code: 'CREER_DEVIS_COMPLEMENTAIRE',
                    methode: 'POST',
                    parametres: { ligneIds: eligibles.map((l) => l.id) },
                  },
                ],
              },
            );
          }
        }
        for (const ligne of eligibles) {
          // `blocage: 'aucun'` — sans quoi une ligne soumise à accord (`blocage: 'accord'`, posé
          // par `soumettreLignesADevis` ci-dessous) resterait bloquée après sa propre validation :
          // le trigger `recalculer_drapeaux_ordre_reparation` lit `ligne_or.blocage`, pas son
          // `statut`, pour maintenir `ordre_reparation.attente_accord` — valider la décision EST
          // ce qui lève le blocage, exactement comme `annulerLignesAccord` (`service-transitions.ts`
          // ~L197) le fait pour un refus/une annulation de la demande.
          await this.transitionnerLigne(tx, ctx, ligne, 'validee', { blocage: 'aucun' });
        }
      },
    );
  }

  /**
   * `POST /ordres-reparation/{orId}/refuser-lignes` — `a_valider -> refusee` (CT-33). Un refus
   * fait naître un travail reporté sur le véhicule pour CHAQUE ligne refusée (RM-73), via le port
   * `CreationTravailReporte` (`atelier.jetons.ts`, fourni par `VehiculesModule`) — appelé DANS LA
   * MÊME TRANSACTION `tx` que le passage de la ligne à `refusee` : un refus qui réussit et un
   * travail reporté qui échoue laisseraient l'information perdue en silence.
   *
   * `designation: ligne.designation ?? ''` : `ligne_or.designation` est nullable en base, mais le
   * contrat d'entrée (`schemaCreationLigneOr`) l'exige non vide à la création — même coalescence
   * défensive que `mappeurs.ts::mapperLigneOr`, jamais censée se déclencher en pratique.
   *
   * `motifRefus: entree.motif ?? null` : voir `atelier.jetons.ts` (commentaire de
   * `EntreeCreationTravailReporteDepuisRefus`) — persistance réelle côté `vehicules/`, pas encore
   * confirmée au moment d'écrire ce fichier malgré la colonne `vehicule_travail_reporte.motif_refus`
   * désormais présente en base.
   */
  async refuserLignes(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeRefusLignes,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executerActionGroupee(
      ctx,
      principal,
      orId,
      entree.ligneIds,
      async (tx, or, cibles) => {
        const maintenant = new Date();
        for (const ligne of cibles) {
          await this.transitionnerLigne(tx, ctx, ligne, 'refusee', {});
          // RP-23 (`pieces/reservation.ts`), deuxième cas : une ligne refusée en décision de
          // devis libère AUTOMATIQUEMENT sa réservation active, DANS LA MÊME transaction `tx`.
          await this.serviceReservation.libererPourLigneTx(tx, ctx, ligne.id, 'refus_devis');
          await this.travailReporte.creerDepuisRefus(
            tx,
            ctx,
            {
              vehiculeId: or.vehiculeId,
              ordreReparationId: orId,
              ligneOrId: ligne.id,
              designation: ligne.designation ?? '',
              urgence: ligne.urgence,
              montantEstimeCentimes: ligne.montantTtcCentimes,
              securite: ligne.securite,
              motifRefus: entree.motif ?? null,
            },
            maintenant,
          );
        }
      },
    );
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
    return this.executerActionGroupee(
      ctx,
      principal,
      orId,
      entree.ligneIds,
      async (tx, _or, cibles) => {
        for (const ligne of cibles) {
          await this.transitionnerLigne(tx, ctx, ligne, 'annulee', {
            motifAnnulation: entree.motif,
          });
          // RP-23 (`pieces/reservation.ts`), premier cas : une ligne annulée libère
          // AUTOMATIQUEMENT sa réservation active, DANS LA MÊME transaction `tx`.
          await this.serviceReservation.libererPourLigneTx(tx, ctx, ligne.id, 'annulation_ligne');
        }
      },
    );
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
    return this.executerActionGroupee(
      ctx,
      principal,
      orId,
      entree.ligneIds,
      async (tx, _or, cibles) => {
        for (const ligne of cibles) {
          await this.transitionnerLigne(tx, ctx, ligne, 'a_valider', { blocage: 'accord' });
        }
      },
    );
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
    travail: (
      tx: TransactionDfa,
      or: LigneOrdreReparation,
      cibles: readonly LigneLigneOr[],
    ) => Promise<void>,
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
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "La mise à jour de la ligne n'a rendu aucune ligne.",
        );
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
      throw new ErreurMetier(
        'OR_LIGNE_VERROUILLEE',
        `Ordre de réparation verrouillé (statut ${or.statut}).`,
        {
          blocages: [
            {
              type: 'ordre_reparation',
              id: orId,
              libelle: or.numero,
              donnees: { statutActuel: or.statut },
            },
          ],
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        },
      );
    }
  }

  /** Une ligne déjà `facturee`/`annulee` est figée même si l'OR reste ouvert (I-15 s'applique à
   *  l'OR, pas à la ligne — garde locale, interprétation signalée). */
  private garantirLigneModifiable(ligne: LigneLigneOr): void {
    if (ligne.statut === 'facturee' || ligne.statut === 'annulee') {
      throw new ErreurMetier(
        'OR_LIGNE_VERROUILLEE',
        `Ligne verrouillée (statut ${ligne.statut}).`,
        {
          blocages: [
            {
              type: 'ligne_or',
              id: ligne.id,
              libelle: ligne.designation ?? '',
              donnees: { statutActuel: ligne.statut },
            },
          ],
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        },
      );
    }
  }

  /**
   * `articleId` (création ET modification) : mêmes garanties que `payeurClientId` — existence
   * tenant-scopée (`chargerArticleLigne` lève `RESSOURCE_INTROUVABLE` sinon) et refus explicite
   * d'un article `desactive` (RP-07 : la désactivation empêche déjà toute NOUVELLE réservation
   * active, cohérence symétrique côté saisie de ligne). `obsolete` reste accepté : un article
   * obsolète peut encore être vendu jusqu'à épuisement de son reliquat, seule sa désactivation
   * ferme définitivement la porte. Pas de code `ARTICLE_INACTIF` dédié dans `CODES_ERREUR`
   * (`probleme.ts`, hors périmètre de ce module) — `VALIDATION_ECHOUEE` structuré, même patron
   * que les gardes `payeurClientId` de ce fichier.
   */
  private async garantirArticleUtilisable(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    articleId: string,
  ): Promise<void> {
    const articleLigne = await chargerArticleLigne(tx, ctx, articleId);
    if (articleLigne.statut === 'desactive') {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        `Article ${articleId} désactivé : impossible de l'utiliser sur une nouvelle ligne.`,
        {
          erreurs: [
            {
              champ: 'articleId',
              code: 'article_desactive',
              message: 'Cet article est désactivé.',
            },
          ],
        },
      );
    }
  }

  /**
   * RP-19/RP-20 (`pieces/reservation.ts`, GELÉ, en-tête) : une ligne `type = 'piece'` avec
   * `articleId` renseigné et `fournieParClient = false` réserve la pièce DANS LA MÊME TRANSACTION
   * que sa création — jamais un second appel HTTP. Le trigger `reservation_piece_verrouiller_stock`
   * (migration 0026) porte la garantie de concurrence CP-02 (verrou de ligne sur `stock_article`)
   * ET la vérification de capacité (SQLSTATE personnalisé `ZDFA4`) : cette méthode se contente
   * d'un INSERT typé, toute la logique de verrouillage/refus vit en base.
   *
   * ZDFA4 N'EST PAS UNE ERREUR HTTP ICI, à la différence de `STOCK_INSUFFISANT` dans
   * `pieces/service-mouvement.ts` : le `hint` du trigger 0026 est explicite — « la ligne d'OR doit
   * basculer blocage='pieces' plutôt que de forcer cette réservation » (RP-24). La ligne reste
   * donc créée SANS réservation, avec son `blocage` forcé à `'pieces'` (visible par le client dans
   * la réponse 201, sans avertissement dédié — aucun code `CODES_AVERTISSEMENT` existant ne
   * convient et `probleme.ts` est hors périmètre de ce module ; signalé au rapport de livraison).
   *
   * N'EST PAS APPELÉE PAR `modifier()` : le contrat (`reservation.ts`, en-tête) ne fait naître la
   * réservation qu'à la création — voir la note sur `entree.articleId` dans `modifier()`.
   *
   * DÉFAUT CORRIGÉ (mesuré en exécution — `pont-atelier-pieces.spec.ts`, section RP-24) : sans
   * précaution, un `INSERT` qui échoue en `ZDFA4` laisse la transaction PostgreSQL dans un état
   * « aborted » (`current transaction is aborted, commands ignored until end of transaction
   * block`, SQLSTATE `25P02`) — TOUTE instruction suivante y est rejetée, MÊME parfaitement valide
   * par ailleurs, tant qu'aucun `ROLLBACK`/`ROLLBACK TO SAVEPOINT` n'a eu lieu. Le `catch`
   * ci-dessous attrapait bien l'exception ZDFA4 côté application, mais l'`UPDATE` de rattrapage
   * (`blocage = 'pieces'`) échouait alors À SON TOUR avec cette erreur DIFFÉRENTE, non reconnue —
   * remontée telle quelle en `500 ERREUR_INTERNE` au lieu du `201` documenté par RP-24. Reproduit
   * par isolation SQL directe (rapport de livraison) : l'`INSERT` seul échoue bien en `ZDFA4`, un
   * `UPDATE ligne_or` seul (sa PROPRE transaction) réussit sans problème — c'est leur combinaison
   * DANS LA MÊME transaction qui casse tout.
   *
   * CORRECTIF : `tx.transaction(...)`, appelé SUR un `tx` DÉJÀ ouvert (à la différence
   * d'`AccesBase.enTenant`, qui ouvrirait une connexion NEUVE et briserait l'atomicité — voir la
   * doc de `ServiceEmissionDocument.marquerVehiculeVenduSiApplicable`), pose un vrai `SAVEPOINT`
   * PostgreSQL (`NodePgTransaction.transaction()`, `drizzle-orm/node-postgres/session.js`) : en cas
   * d'erreur dans le callback, drizzle exécute lui-même `ROLLBACK TO SAVEPOINT` puis relance
   * l'erreur D'ORIGINE (celle que `remonterCausePg` sait déjà déballer) — la transaction externe
   * redevient utilisable, l'`UPDATE` de rattrapage peut s'exécuter normalement.
   */
  private async reserverPieceSiApplicable(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneLigneOr,
    or: LigneOrdreReparation,
  ): Promise<LigneLigneOr> {
    if (ligne.type !== 'piece' || !ligne.articleId || ligne.fourniParClient) return ligne;

    const valeurs: NouvelleReservationPiece = {
      tenantId: ctx.tenantId,
      articleId: ligne.articleId,
      siteId: or.siteId,
      ligneOrId: ligne.id,
      ordreReparationId: ligne.ordreReparationId,
      quantiteMillieme: ligne.quantiteMillieme ?? 1000,
    };

    try {
      await tx.transaction(async (tx2) => {
        await tx2.insert(reservationPiece).values(valeurs);
      });
      return ligne;
    } catch (erreur) {
      if (remonterCausePg(erreur)?.code !== 'ZDFA4') throw erreur;

      const [misAJour] = await tx
        .update(ligneOr)
        .set({ blocage: 'pieces' })
        .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligne.id)))
        .returning();
      if (!misAJour) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "La mise à jour du blocage de la ligne n'a rendu aucune ligne.",
        );
      }
      return misAJour;
    }
  }

  /**
   * RP-21/RP-38 (`pieces/service-reservation.ts`, `pieces/service-consigne.ts`) : la réalisation
   * d'une ligne `piece` portant une réservation `active` remet PHYSIQUEMENT la pièce et, si
   * l'article est d'échange standard, pose la consigne — DANS LA MÊME TRANSACTION `tx` que le
   * passage de la ligne à `realisee`. Dette technique soldée (rapport de livraison étape 3-4) :
   * l'ancienne version répliquait le SQL de `ServiceReservation`/`ServiceConsigne` directement ici,
   * faute d'une variante de ces services acceptant un `tx` externe (`AccesBase.enTenant`, appelé
   * depuis l'intérieur d'un `tx` déjà ouvert, aurait ouvert une connexion NEUVE et cassé
   * l'atomicité). `satisfairePourLigneTx`/`creerDepuisRealisationTx` reçoivent maintenant ce `tx`
   * directement : la règle métier vit à un seul endroit, dans `pieces/`.
   *
   * Aucune réservation `active` trouvée (jamais créée, stock insuffisant à la pose,
   * `blocage = 'pieces'`, RP-24 ; ou déjà `satisfaite`/`liberee`) → `satisfairePourLigneTx` rend
   * `null`, aucun mouvement généré : il n'y a rien à satisfaire. Forcer une sortie de stock sans
   * réservation sortirait du périmètre documenté de cette tâche — signalé, pas tranché.
   */
  private async satisfaireReservationSiApplicable(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneLigneOr,
  ): Promise<void> {
    if (ligne.type !== 'piece' || !ligne.articleId) return;

    const reservation = await this.serviceReservation.satisfairePourLigneTx(tx, ctx, ligne.id);
    if (!reservation) return;

    await this.serviceConsigne.creerDepuisRealisationTx(tx, ctx, {
      ligneOrId: ligne.id,
      ordreReparationId: ligne.ordreReparationId,
      articleId: reservation.articleId,
      siteId: reservation.siteId,
      quantiteMillieme: reservation.quantiteMillieme,
      auteurId: ctx.utilisateurId,
    });
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
   * RM-65 : le taux horaire est FIGÉ à la création de la ligne. RM-07 précise que le client porte
   * un « taux horaire spécifique ÉVENTUEL » — c'est un ARRANGEMENT PARTICULIER, pas la source
   * normale du tarif : le référentiel `taux_horaire` appartient au GARAGE (§7.9 « Taux horaires :
   * par catégorie de travail, par marque, par catégorie de véhicule, avec dates de validité
   * (RM-65) », P-02 « un seul, ou par type de travail / marque / … »), et RM-50 énumère bien DEUX
   * choses figées distinctes à l'ouverture de l'OR : « les conditions commerciales ET les taux
   * horaires applicables ».
   *
   * D'où la cascade ci-dessous. Sans elle (état antérieur : lecture du seul
   * `conditionsFigees.tauxHoraireCode`, `null` sinon), AUCUNE ligne de main-d'œuvre n'était
   * saisissable pour un client sans condition commerciale négociée — c'est-à-dire pour l'immense
   * majorité des clients d'un garage, qui n'en négocie qu'avec une poignée de comptes flotte.
   *
   *  1. le taux NÉGOCIÉ du client (`or.conditionsFigees.tauxHoraireCode`, capturé par
   *     `ServiceSnapshotOr` à l'ouverture) ;
   *  2. à défaut, le taux STANDARD du garage (`CODE_TAUX_HORAIRE_DEFAUT`) ;
   *  3. à défaut, l'unique taux en vigueur s'il n'y en a qu'un — configuration P-02 « un seul
   *     taux », où le garage l'a nommé autrement (`MO`, `HORAIRE`, `STANDARD`…).
   *
   * Un code client qui ne résout RIEN n'est PAS rattrapé par le taux standard : facturer au tarif
   * public un client à qui on a promis un tarif flotte est une erreur silencieuse et coûteuse. Le
   * garage doit voir que la période de validité de SON taux négocié est expirée — d'où le refus
   * explicite, avec le code fautif dans le message.
   *
   * Lecture directe de `taux_horaire` (une poignée de lignes par tenant), même doctrine que
   * `references.ts` pour `parametre_atelier` : pas de jeton pour une lecture de table.
   *
   * DÉLÈGUE désormais à `taux-horaire.ts` (#72) — même algorithme mot pour mot (voir son
   * commentaire pour le détail de la cascade et de la borne haute exclusive), extrait pour être
   * réutilisable par `clients/service-client-sous-collections.ts` (résolution d'une condition
   * commerciale à SA date `valideDuLe`, plutôt qu'à « aujourd'hui »). `dateJour` reste calculé ICI,
   * pas dans la fonction pure : résoudre le taux d'une ligne d'OR se fait toujours à la date de
   * LECTURE, jamais à une date figée.
   */
  private async resoudreTauxHoraireCentimes(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    or: LigneOrdreReparation,
  ): Promise<ResolutionTauxHoraire> {
    const conditions = (or.conditionsFigees as { tauxHoraireCode?: string | null } | null) ?? null;
    const codeClient = conditions?.tauxHoraireCode ?? null;
    const lignes = await chargerToutesTauxHoraire(tx, ctx);
    const dateJour = new Date().toISOString().slice(0, 10);
    return resoudreTauxHorairePourDate(lignes, codeClient, dateJour);
  }

  /** Traduit une résolution en échec (RM-65) en `400 VALIDATION_ECHOUEE` lisible au comptoir. */
  private exigerTauxHoraire(resolution: ResolutionTauxHoraire): number {
    if (resolution.centimes !== null) return resolution.centimes;
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      'Aucun taux horaire résoluble pour cette ligne de main d’œuvre.',
      {
        erreurs: [{ champ: 'type', code: 'taux_horaire_introuvable', message: resolution.motif }],
      },
    );
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
    if (
      or.plafondCentimes !== null &&
      or.totalValideCentimes + montantTtcCentimes > or.plafondCentimes
    )
      return 'a_valider';
    return 'validee';
  }
}
