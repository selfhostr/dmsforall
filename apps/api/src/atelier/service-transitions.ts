import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  ElementBloquant,
  EntreeActionAnnuler,
  EntreeActionReceptionner,
  EntreeActionRefuserControle,
  EntreeActionRestituer,
  EntreeActionRetention,
  EntreeActionReprendreTravaux,
  EntreeActionRouvrir,
  EntreeActionTerminer,
  EntreeActionValiderControle,
  ReponseAvecAvertissements,
  ReponseOrdreReparation,
  RoleUtilisateur,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  auditAtelier,
  ligneOr,
  orControleQualite,
  ordreReparation,
  vehiculeKilometrage,
  type LigneLigneOr,
  type LigneOrdreReparation,
} from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../common/evenements';
import { ServiceReservation } from '../pieces/service-reservation';

import { JETON_LECTURE_POINTAGE, type LecturePointage } from './atelier.jetons';
import { convertirEnKm } from './kilometrage';
import { roleVoitLesMontants } from './mappeurs';
import { chargerOrPourEcriture, listerLignesOr } from './or-requetes';
import {
  chargerClientLigne,
  chargerDernierKilometrage,
  chargerParametresAtelier,
} from './references';
import { ServiceOr, estOrVerrouille } from './service-or';
import { traduireErreurTransition } from './traducteur-transition';

/**
 * Les 11 actions de transition de l'OR (§7.7) — chacune : gardes conditionnelles couche 4 (§3.3
 * du plan backend) PUIS écriture du statut, DANS LA MÊME TRANSACTION, avec `select … for update`
 * (posé par `chargerOrPourEcriture`). Aucune autre voie n'écrit `ordre_reparation.statut` —
 * `AtelierModule` ne câble aucun autre service sur cette colonne.
 *
 * Chaque méthode renvoie l'OR COMPLET à jour (§7.7 « toutes renvoient l'OR complet »), assemblé
 * par `ServiceOr.assemblerDocument` DANS la même transaction — pas de refetch après commit.
 */
@Injectable()
export class ServiceTransitions {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_EVENEMENTS) private readonly evenements: ServiceEvenements,
    @Inject(JETON_LECTURE_POINTAGE) private readonly pointage: LecturePointage,
    private readonly horloge: Horloge,
    private readonly serviceOr: ServiceOr,
    private readonly serviceReservation: ServiceReservation,
  ) {}

  /** T-03 `planifie -> ouvert`. RM-51 : le kilométrage d'entrée est le geste métier. */
  async receptionner(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeActionReceptionner,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        const kmKm = convertirEnKm(entree.kilometrageEntree, entree.unite);
        const dernier = await chargerDernierKilometrage(tx, ctx, or.vehiculeId);
        // `valeurKm` est une colonne GENERATED côté base (cf. schéma) donc typée nullable par
        // Drizzle ; un relevé existant SANS valeur km comparable n'a rien à opposer à la saisie —
        // c'est le même cas métier qu'« aucun relevé antérieur », pas un relevé à zéro km.
        const dernierKm = dernier?.valeurKm ?? null;
        if (dernierKm !== null && kmKm < dernierKm) {
          throw new ErreurMetier(
            'VEHICULE_KILOMETRAGE_REGRESSIF',
            'Le kilométrage saisi est inférieur au dernier relevé connu.',
            {
              blocages: [
                {
                  type: 'champ',
                  id: 'kilometrageEntree',
                  libelle: `Dernier relevé connu : ${String(dernierKm)} km`,
                  donnees: { dernierConnuKm: dernierKm, saisiKm: kmKm },
                },
              ],
              actionsProposees: [
                {
                  code: 'FOURNIR_MOTIF',
                  parametres: {
                    motifsAcceptes: [
                      'compteur_remplace',
                      'erreur_saisie',
                      'changement_unite',
                      'correction',
                    ],
                  },
                },
              ],
            },
          );
        }

        const maintenant = this.horloge.maintenant();
        await this.transitionner(tx, or, 'ouvert', {
          kmEntree: kmKm,
          ouvertLe: maintenant,
          receptionnaireId: principal.utilisateurId,
        });
        await tx.insert(vehiculeKilometrage).values({
          tenantId: ctx.tenantId,
          vehiculeId: or.vehiculeId,
          valeur: entree.kilometrageEntree,
          unite: entree.unite,
          releveLe: maintenant,
          source: 'reception',
          ordreReparationId: orId,
          saisiParId: principal.utilisateurId,
        });
        await this.evenements.publier(tx, ctx, {
          type: 'ordre_reparation.ouvert',
          versionSchema: 1,
          siteId: or.siteId,
          ressource: { type: 'ordre_reparation', id: orId, numero: or.numero },
          donnees: { statut: 'ouvert' },
        });
      },
      principal.role,
    );
  }

  /** T-04 `ouvert -> en_cours`. I-07 (CT-18) : proposée en amont, plus lisible que le ZDFA1 générique. */
  async demarrer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        if (or.statut === 'planifie') {
          throw new ErreurMetier(
            'OR_RECEPTION_REQUISE',
            'Le véhicule doit être réceptionné avant de démarrer les travaux (I-07).',
            {
              blocages: [
                {
                  type: 'ordre_reparation',
                  id: orId,
                  libelle: or.numero,
                  donnees: { statutActuel: or.statut },
                },
              ],
              actionsProposees: [{ code: 'RECEPTIONNER_VEHICULE' }],
            },
          );
        }
        await this.transitionner(tx, or, 'en_cours', {});
      },
      principal.role,
    );
  }

  /** T-06/T-08/T-10 — lève les blocages sur tout ou partie des lignes. Pas une transition de
   *  statut : `attente_*` sont des drapeaux (A-03), recalculés par trigger. */
  async reprendreTravaux(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeActionReprendreTravaux,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, _or) => {
        const conditions = entree.ligneIds
          ? and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.ordreReparationId, orId))
          : and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.ordreReparationId, orId));
        void conditions;
        const lignes = await listerLignesOr(tx, ctx, orId);
        const ciblees = entree.ligneIds
          ? lignes.filter((l) => entree.ligneIds?.includes(l.id))
          : lignes.filter((l) => l.blocage !== 'aucun');
        for (const ligne of ciblees) {
          // eslint-disable-next-line no-await-in-loop -- petit lot borné (200 lignes max par OR)
          await tx
            .update(ligneOr)
            .set({ blocage: 'aucun' })
            .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligne.id)));
        }
      },
      principal.role,
    );
  }

  /** T-11 `en_cours -> controle` (aussi `ouvert -> controle` si le garage saute le pointage).
   *  Gardes I-08 (lignes à valider) et I-09 (pointage ouvert). */
  async passerEnControle(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        await this.verifierLignesAValider(tx, ctx, orId, principal.role);
        await this.verifierPointageOuvert(tx, ctx, orId);
        await this.transitionner(tx, or, 'controle', {});
      },
      principal.role,
    );
  }

  /** T-12 `controle -> en_cours` — motif obligatoire (déjà imposé par le schéma zod). */
  async refuserControle(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeActionRefuserControle,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        await this.transitionner(tx, or, 'en_cours', {});
        await tx.insert(orControleQualite).values({
          tenantId: ctx.tenantId,
          ordreReparationId: orId,
          controleurId: principal.utilisateurId,
          controleLe: this.horloge.maintenant(),
          conforme: false,
          motifNonConformite: entree.motif,
        });
      },
      principal.role,
    );
  }

  /** T-13 `controle -> termine`. Garde I-09 : un contrôle qualité ne clôt pas un pointage ouvert. */
  async validerControle(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeActionValiderControle,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        await this.verifierPointageOuvert(tx, ctx, orId);
        const maintenant = this.horloge.maintenant();
        await this.transitionner(tx, or, 'termine', { termineLe: maintenant });
        await tx.insert(orControleQualite).values({
          tenantId: ctx.tenantId,
          ordreReparationId: orId,
          controleurId: entree.controleurId,
          controleLe: maintenant,
          conforme: true,
          motifNonConformite: null,
        });
        await this.evenements.publier(tx, ctx, {
          type: 'ordre_reparation.termine',
          versionSchema: 1,
          siteId: or.siteId,
          ressource: { type: 'ordre_reparation', id: orId, numero: or.numero },
          donnees: { statut: 'termine' },
        });
      },
      principal.role,
    );
  }

  /**
   * T-14 `{ouvert,en_cours} -> termine` — REFUSÉE si le contrôle qualité est obligatoire pour ce
   * garage (P-08 ≠ `jamais`) : le chemin devient `/passer-en-controle` puis `/valider-controle`.
   * Gardes I-08, I-09, I-10, RM-14 (CT-49).
   */
  async terminer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeActionTerminer,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        const parametres = await chargerParametresAtelier(tx, ctx);
        if (parametres.controleQualite !== 'jamais') {
          throw new ErreurMetier(
            'OR_TRANSITION_INTERDITE',
            'Le contrôle qualité est obligatoire pour ce garage avant de terminer (P-08).',
            {
              blocages: [
                {
                  type: 'ordre_reparation',
                  id: orId,
                  libelle: or.numero,
                  donnees: { statutActuel: or.statut },
                },
              ],
              actionsProposees: [{ code: 'COMPLETER_CONTROLE_QUALITE' }],
            },
          );
        }
        await this.verifierLignesAValider(tx, ctx, orId, principal.role);
        await this.verifierPointageOuvert(tx, ctx, orId);
        await this.verifierLignesNonRealisees(tx, ctx, orId, principal.role);
        await this.verifierPoRequis(tx, ctx, or);

        const kmSortieKm =
          entree.kilometrageSortie != null
            ? convertirEnKm(entree.kilometrageSortie, entree.unite)
            : null;
        const maintenant = this.horloge.maintenant();
        await this.transitionner(tx, or, 'termine', {
          termineLe: maintenant,
          ...(kmSortieKm !== null ? { kmSortie: kmSortieKm } : {}),
        });
        await this.evenements.publier(tx, ctx, {
          type: 'ordre_reparation.termine',
          versionSchema: 1,
          siteId: or.siteId,
          ressource: { type: 'ordre_reparation', id: orId, numero: or.numero },
          donnees: { statut: 'termine' },
        });
      },
      principal.role,
    );
  }

  /**
   * T-15 `termine -> en_cours` — motif obligatoire. Depuis `facture`, la DB rejette (I-02) et le
   * traducteur propose `CREER_OR_RETOUCHE` — volontairement PAS reproduit ici en amont.
   *
   * GARDE D'ORIGINE APPLICATIVE, en plus du contrôle DB : `transition_autorisee` autorise aussi
   * `ouvert -> en_cours` (T-04, un tout autre geste métier — premier pointage/déclenchement
   * manuel) et `controle -> en_cours` (T-12, `refuserControle`, sa propre action). Sans cette
   * garde, appeler `rouvrir` sur un OR `ouvert` réussirait (201) en empruntant SILENCIEUSEMENT la
   * ligne T-04 de la machine à états — un comportement correct pour `receptionner`, faux pour
   * `rouvrir`, que le trigger SQL ne peut pas distinguer puisqu'il ne connaît que `(depuis, vers)`,
   * jamais quelle ACTION applicative les a demandés. `rouvrir` n'a de sens que depuis `termine`.
   */
  async rouvrir(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeActionRouvrir,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        if (or.statut !== 'termine') {
          throw new ErreurMetier(
            'OR_TRANSITION_INTERDITE',
            `Transition ${or.statut} → en_cours interdite : rouvrir (T-15) n'est valide que depuis « termine ».`,
            {
              detail: `entite=ordre_reparation;depuis=${or.statut};vers=en_cours`,
              blocages: [
                {
                  type: 'ordre_reparation',
                  id: or.id,
                  libelle: or.numero,
                  donnees: { statutActuel: or.statut, statutDemande: 'en_cours' },
                },
              ],
              actionsProposees: [{ code: 'RAFRAICHIR' }],
            },
          );
        }

        await this.transitionner(tx, or, 'en_cours', { termineLe: null });

        // Pas de colonne dédiée sur `ordre_reparation` pour ce motif, et aucun type
        // `TypeEvenementMetier` (`@dfa/shared`, contrat gelé hors périmètre de ce module) ne
        // couvre « OR rouvert » — l'ajouter est une décision de contrat à négocier, pas à prendre
        // ici. INSERT direct dans `audit_atelier`, mécanisme explicitement prévu pour journaliser
        // UN champ précis sans faire porter une colonne dédiée à la table (migration `0004`
        // §objet, même motif que CT-31) : c'est ce qui rend le motif visible au journal (`champ`
        // + `valeurApres`, lus par `ServiceOr.journal`).
        await tx.insert(auditAtelier).values({
          tenantId: ctx.tenantId,
          entite: 'ordre_reparation',
          entiteId: orId,
          action: 'transition',
          champ: 'motif',
          valeurApres: entree.motif,
          utilisateurId: principal.utilisateurId,
          requeteId: ctx.requeteId,
        });
      },
      principal.role,
    );
  }

  /** T-17 `facture -> restitue` / T-18 `termine -> restitue`. Garde §6.12/CT-52 : une ligne de
   *  sécurité refusée exige une réserve signée avant restitution. */
  async restituer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeActionRestituer,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        const parametres = await chargerParametresAtelier(tx, ctx);
        if (parametres.mentionSecurite === 'obligatoire') {
          const lignes = await listerLignesOr(tx, ctx, orId);
          const refuseesSecurite = lignes.filter((l) => l.securite && l.statut === 'refusee');
          if (refuseesSecurite.length > 0) {
            throw new ErreurMetier(
              'OR_RESERVE_SECURITE_REQUISE',
              'Une réserve de sécurité doit être signée avant restitution (§6.12).',
              {
                blocages: refuseesSecurite.slice(0, 50).map((l): ElementBloquant => ({
                  type: 'ligne_or',
                  id: l.id,
                  libelle: l.designation ?? '',
                  donnees: { numeroLigne: l.numeroOrdre },
                })),
                actionsProposees: [
                  {
                    code: 'SIGNER_RESERVE_SECURITE',
                    parametres: { typeSignature: 'reserve-securite' },
                  },
                ],
              },
            );
          }
        }

        const kmSortieKm =
          entree.kilometrageSortie != null
            ? convertirEnKm(entree.kilometrageSortie, entree.unite)
            : null;
        const maintenant = this.horloge.maintenant();
        await this.transitionner(tx, or, 'restitue', {
          restitueLe: maintenant,
          ...(kmSortieKm !== null ? { kmSortie: kmSortieKm } : {}),
        });
        await this.evenements.publier(tx, ctx, {
          type: 'ordre_reparation.restitue',
          versionSchema: 1,
          siteId: or.siteId,
          ressource: { type: 'ordre_reparation', id: orId, numero: or.numero },
          donnees: { statut: 'restitue' },
        });
      },
      principal.role,
    );
  }

  /** T-19 `restitue -> cloture`. */
  async cloturer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        const maintenant = this.horloge.maintenant();
        await this.transitionner(tx, or, 'cloture', { clotureLe: maintenant });
        await this.evenements.publier(tx, ctx, {
          type: 'ordre_reparation.cloture',
          versionSchema: 1,
          siteId: or.siteId,
          ressource: { type: 'ordre_reparation', id: orId, numero: or.numero },
          donnees: { statut: 'cloture' },
        });
      },
      principal.role,
    );
  }

  /**
   * T-20 `{planifie,ouvert} -> annule` — motif obligatoire (RM-62). Refusée s'il existe des
   * pointages, des pièces PHYSIQUEMENT sorties ou une facture (CT-25, CT-26, RM-62 : « aucun
   * pointage, aucune pièce sortie, aucune facture »).
   *
   * ISSUE #11 — CAUSE RACINE : `annulerLignes`/`refuserLignes` (`ServiceLigneOr`) appellent déjà
   * `ServiceReservation.libererPourLigneTx` ligne par ligne (RP-23) ; cette méthode-ci, qui annule
   * l'OR ENTIER (T-20, un tout autre geste métier), n'appelait JUSQU'ICI AUCUN des deux — elle se
   * contentait d'écrire `ordre_reparation.statut = 'annule'` et ne touchait jamais
   * `reservation_piece`. Toute ligne `piece` encore réservée restait donc `active` pour de bon : le
   * stock qu'elle bloquait ne se libérait plus jamais spontanément (seul `POST
   * /reservations/{id}/liberer`, geste manuel du magasinier, pouvait la débloquer). CORRIGÉ ci-
   * dessous en deux volets, dans la MÊME transaction que le passage à `annule` :
   *
   *   1. GARDE (RM-62, nouvelle ici) : une réservation `satisfaite` de cet OR — pièce déjà sortie
   *      physiquement du stock — bloque l'annulation, au même titre qu'un pointage ouvert ou une
   *      ligne facturée. Symétrique de `ServiceLigneOr` : une ligne `realisee` dont la pièce est
   *      SORTIE ne peut plus être neutralisée par une simple annulation d'OR (aucun mouvement de
   *      retour n'est généré ici) — l'utilisateur doit statuer autrement (avoir, retour manuel).
   *      Une ligne `realisee` SANS pièce sortie (`fourniParClient = true`, aucune réservation créée)
   *      ne déclenche PAS cette garde : rien n'a quitté le stock du garage.
   *   2. LIBÉRATION : une fois la garde passée, PAR CONSTRUCTION aucune réservation de cet OR n'est
   *      `satisfaite` — chaque réservation encore `active` (ligne `proposee`/`a_valider`/`validee`/
   *      `en_cours`, jamais réalisée) peut être libérée sans risque. `libererToutesActivesPourOrTx`
   *      le fait en un seul aller-retour verrouillé (`select … for update`) plutôt qu'un appel par
   *      ligne, et reste dans CETTE transaction : si la libération échouait à mi-chemin, PostgreSQL
   *      annule tout — l'OR annulé et les réservations libérées commitent ensemble ou pas du tout,
   *      jamais un état intermédiaire où l'OR serait `annule` avec des réservations encore actives.
   *
   * Motif transmis : `'annulation_ligne'` — le catalogue `MotifLiberationReservation`
   * (`@dfa/shared`, contrat gelé pour cette tâche) ne porte aucune valeur dédiée à « OR annulé dans
   * son ensemble » ; c'est la valeur la plus proche sémantiquement (la réservation est libérée parce
   * que la ligne qui la porte est neutralisée par l'annulation, exactement comme
   * `annulerLignes`). SIGNALÉ, pas tranché : un motif `annulation_or` distinct rendrait l'audit plus
   * lisible, à ajouter au contrat dans un lot séparé si souhaité.
   */
  async annuler(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeActionAnnuler,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.executer(
      ctx,
      orId,
      async (tx, or) => {
        const lignes = await listerLignesOr(tx, ctx, orId);
        const pointagesOuverts = await this.pointage.pointagesOuvertsPourOr(tx, orId);
        const lignesFacturees = lignes.filter(
          (l) => l.statut === 'facturee' || l.factureId !== null,
        );
        const piecesSorties = await this.serviceReservation.listerPiecesSortiesPourOrTx(
          tx,
          ctx,
          orId,
        );
        const lignesParId = new Map(lignes.map((l) => [l.id, l] as const));

        const blocages: ElementBloquant[] = [
          ...pointagesOuverts.map((p): ElementBloquant => ({
            type: 'pointage',
            id: p.pointageId,
            libelle: p.technicienNomAffiche,
          })),
          ...lignesFacturees.slice(0, 50).map((l): ElementBloquant => ({
            type: 'ligne_or',
            id: l.id,
            libelle: l.designation ?? '',
            donnees: { numeroLigne: l.numeroOrdre },
          })),
          ...piecesSorties.slice(0, 50).map((r): ElementBloquant => {
            const ligne = lignesParId.get(r.ligneOrId);
            return {
              type: 'ligne_or',
              id: r.ligneOrId,
              libelle: ligne?.designation ?? '',
              donnees: { numeroLigne: ligne?.numeroOrdre ?? null, reservationId: r.id },
            };
          }),
        ];
        if (blocages.length > 0) {
          throw new ErreurMetier(
            'OR_ANNULATION_IMPOSSIBLE',
            'Annulation impossible : des pointages, des pièces sorties ou des lignes facturées existent (RM-62).',
            {
              blocages,
              actionsProposees: [{ code: 'RAFRAICHIR' }],
            },
          );
        }

        await this.transitionner(tx, or, 'annule', {
          annuleLe: this.horloge.maintenant(),
          motifAnnulation: entree.motif,
        });
        // Issue #11 : voir le commentaire de méthode ci-dessus (volet 2) — DANS la même transaction
        // que l'écriture du statut, pour rester atomique.
        await this.serviceReservation.libererToutesActivesPourOrTx(
          tx,
          ctx,
          orId,
          'annulation_ligne',
        );
        await this.evenements.publier(tx, ctx, {
          type: 'ordre_reparation.annule',
          versionSchema: 1,
          siteId: or.siteId,
          ressource: { type: 'ordre_reparation', id: orId, numero: or.numero },
          donnees: { statut: 'annule', motif: entree.motif },
        });
      },
      principal.role,
    );
  }

  // -----------------------------------------------------------------------------------------
  // Infrastructure interne — chargement + verrou, écriture du statut, traduction ZDFA1.
  // -----------------------------------------------------------------------------------------

  /** Ouvre la transaction, verrouille l'OR (`for update`), exécute `travail`, assemble et rend le
   *  document complet. Point d'entrée UNIQUE de toute action de transition. */
  private async executer(
    ctx: ContexteTenant,
    orId: string,
    travail: (tx: TransactionDfa, or: LigneOrdreReparation) => Promise<void>,
    role: RoleUtilisateur,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const or = await chargerOrPourEcriture(tx, ctx, orId);
      await travail(tx, or);
      const document = await this.serviceOr.assemblerDocument(tx, ctx, role, orId);
      return { donnees: document, avertissements: [] };
    });
  }

  /** Écrit `ordre_reparation.statut` — SEUL point d'écriture de cette colonne dans tout le module.
   *  Traduit le SQLSTATE `ZDFA1` en `ErreurMetier` exploitable ; relance tel quel sinon. */
  private async transitionner(
    tx: TransactionDfa,
    or: LigneOrdreReparation,
    versStatut: LigneOrdreReparation['statut'],
    champs: Partial<Omit<LigneOrdreReparation, 'id' | 'tenantId' | 'statut'>>,
  ): Promise<void> {
    try {
      await tx
        .update(ordreReparation)
        .set({ statut: versStatut, ...champs })
        .where(and(eq(ordreReparation.tenantId, or.tenantId), eq(ordreReparation.id, or.id)));
    } catch (erreur) {
      const traduite = traduireErreurTransition(erreur, or.id, or.numero);
      if (traduite) throw traduite;
      throw erreur;
    }
  }

  /** I-08 : refuse tant que des lignes attendent une décision d'accord. */
  private async verifierLignesAValider(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    orId: string,
    role: RoleUtilisateur,
  ): Promise<void> {
    const lignes = await tx
      .select()
      .from(ligneOr)
      .where(
        and(
          eq(ligneOr.tenantId, ctx.tenantId),
          eq(ligneOr.ordreReparationId, orId),
          eq(ligneOr.statut, 'a_valider'),
        ),
      );
    if (lignes.length === 0) return;

    const voitMontants = roleVoitLesMontants(role);
    throw new ErreurMetier(
      'OR_LIGNES_A_VALIDER',
      'Des lignes attendent encore une décision (I-08).',
      {
        blocages: lignes.slice(0, 50).map((l) => this.blocageLigne(l, voitMontants)),
        actionsProposees: [
          {
            code: 'CREER_DEVIS_COMPLEMENTAIRE',
            methode: 'POST',
            parametres: { ligneIds: lignes.map((l) => l.id) },
          },
          { code: 'VALIDER_LIGNES' },
        ],
      },
    );
  }

  /** I-10 : refuse tant qu'une ligne validée n'a pas été exécutée. */
  private async verifierLignesNonRealisees(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    orId: string,
    role: RoleUtilisateur,
  ): Promise<void> {
    const lignes = await tx
      .select()
      .from(ligneOr)
      .where(
        and(
          eq(ligneOr.tenantId, ctx.tenantId),
          eq(ligneOr.ordreReparationId, orId),
          eq(ligneOr.statut, 'validee'),
        ),
      );
    if (lignes.length === 0) return;

    const voitMontants = roleVoitLesMontants(role);
    throw new ErreurMetier(
      'OR_LIGNE_NON_REALISEE',
      "Des lignes validées n'ont pas été réalisées (I-10).",
      {
        blocages: lignes.slice(0, 50).map((l) => this.blocageLigne(l, voitMontants)),
        actionsProposees: [{ code: 'MARQUER_LIGNES_REALISEES' }],
      },
    );
  }

  /** I-09 : refuse tant qu'un pointage reste ouvert. Toujours vide au lot 1 (Δ4, module absent). */
  private async verifierPointageOuvert(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    orId: string,
  ): Promise<void> {
    void ctx;
    const ouverts = await this.pointage.pointagesOuvertsPourOr(tx, orId);
    if (ouverts.length === 0) return;
    throw new ErreurMetier('OR_POINTAGE_OUVERT', 'Des pointages sont encore en cours (I-09).', {
      blocages: ouverts.map((p) => ({
        type: 'pointage' as const,
        id: p.pointageId,
        libelle: `${p.technicienNomAffiche} — depuis ${p.debutLe.toISOString()}`,
        donnees: {
          technicienId: p.technicienId,
          technicienPrenom: p.technicienNomAffiche,
          debutLe: p.debutLe.toISOString(),
          ligneOrId: p.ligneOrId,
        },
      })),
      actionsProposees: [{ code: 'ARRETER_POINTAGES' }],
    });
  }

  /** RM-14/CT-49 : un client dont la fiche exige un n° de commande interne ne peut pas voir son
   *  OR terminé sans lui. */
  private async verifierPoRequis(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    or: LigneOrdreReparation,
  ): Promise<void> {
    const clientLigne = await chargerClientLigne(tx, ctx, or.clientId);
    if (clientLigne.poObligatoire && !or.numeroCommandeInterne) {
      throw new ErreurMetier(
        'OR_PO_MANQUANT',
        'Un numéro de commande client est requis pour ce client (RM-14).',
        {
          blocages: [
            {
              type: 'champ',
              id: 'numeroCommandeInterne',
              libelle: 'Numéro de commande client manquant',
            },
          ],
          actionsProposees: [{ code: 'RENSEIGNER_PO' }],
        },
      );
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
}

// Réexports pour les modules qui ne veulent connaître qu'une seule porte d'entrée sur l'état
// verrouillé de l'OR (service-ligne-or.ts, service-devis.ts).
export { estOrVerrouille };
export type { EntreeActionRetention };
