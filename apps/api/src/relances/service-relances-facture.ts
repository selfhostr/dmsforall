import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type {
  ContenuMessageClient,
  Langue,
  ReponseEnvoiRelances,
  ReponsePlanificationRelances,
  StatutReglementDocument,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { JETON_DB } from '../db';
import { regleRelance, relancePlanifiee } from '../db/schema';
import type { NouvelleRelancePlanifiee } from '../db/schema';
import { Horloge } from '../common/horloge';
import { ServiceJournal } from '../common/journal';
import type { AdaptateurNotificationSender } from '../connecteurs';
import { RegistreConnecteursService } from '../connecteurs';

import {
  calculerPaliersDus,
  choisirCanalEtDestinataire,
  construireContenuRappelFacture,
  statutApresEchecEnvoi,
  statutInitialPlanification,
  verifierArretAutomatiqueFacture,
} from './regles-planification';

/**
 * Service du LOT 1 (facturation, rappel #2 — `docs/specification-relances-automatiques.md`).
 * Aucun ordonnanceur n'existe dans ce dépôt (§6 de la spec : « zéro usage de BullMQ vérifié ») —
 * ce service expose deux OPÉRATIONS APPELABLES, idempotentes, traitant chacune un LOT BORNÉ par
 * appel (jamais un balayage complet sans limite — même raisonnement que la pagination par
 * curseur : un tenant avec 5 ans d'historique et 50 OR/jour a potentiellement des milliers de
 * factures en souffrance, un seul appel ne doit jamais tenter de toutes les traiter d'un coup) :
 *
 *  - `planifier()` — calcule les paliers dus (§6.1) et les insère (`ON CONFLICT DO NOTHING` sur
 *    `relance_planifiee_tenant_type_objet_palier_uk`, RA-05).
 *  - `envoyerPretes()` — fait passer à l'envoi les lignes `prete`, réclamées une par une par
 *    mise à jour conditionnelle (`WHERE statut = 'prete'`, §6.1) avant tout appel au connecteur
 *    `NotificationSender` (résolu via `RegistreConnecteursService`, étape 5).
 *
 * Droits posés définitivement dans `auth/matrice-droits.ts` (`relances.facturation.planifier`/
 * `.envoyer`) : l'autorisation est portée EXCLUSIVEMENT par `@ExigerDroit(...)` + `GardeDroit` sur
 * `relances.controller.ts` — ce service ne prend PLUS de rôle en paramètre (retiré avec le
 * palliatif `relances/droits-provisoires.ts`, même patron que `service-regle-relance.ts` et
 * `pneus/service-depot-pneus.ts`).
 *
 * CE QUI RESTE À FAIRE (signalé, pas fait ici, hors périmètre déclaré de cette tâche) : un
 * déclencheur PÉRIODIQUE (cron applicatif, job BullMQ répété, ou appel externe programmé) qui
 * invoque ces deux méthodes à intervalle régulier — voir le rapport de livraison. Un tel
 * déclencheur n'a PAS de session utilisateur ; ni `direction` ni `comptable` (les deux seuls rôles
 * qui détiennent `relances.facturation.planifier`/`.envoyer`) ne désignent un compte de service,
 * voir le rapport de livraison pour l'arbitrage à trancher avec @laupernoe.
 */
@Injectable()
export class ServiceRelancesFacture {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly registre: RegistreConnecteursService,
    private readonly horloge: Horloge,
    private readonly journal: ServiceJournal,
  ) {}

  /** Nombre de documents candidats examinés par appel — voir l'en-tête. */
  private static readonly LOT_PLANIFICATION = 200;
  /** Nombre de lignes `prete` traitées par appel. */
  private static readonly LOT_ENVOI = 100;

  async planifier(ctx: ContexteTenant): Promise<ReponsePlanificationRelances> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [regle] = await tx
        .select()
        .from(regleRelance)
        .where(
          and(
            eq(regleRelance.tenantId, ctx.tenantId),
            eq(regleRelance.typeRelance, 'facture_echue'),
          ),
        );

      // Fail-closed (§5, commentaire de table `regle_relance`) : sans config, ou désactivée, ou
      // sans aucun palier défini, rien ne se planifie — jamais un défaut « actif » implicite.
      if (!regle || !regle.actif || (regle.delaisJours ?? []).length === 0) {
        return { creees: 0, ignorees: 0, encoreATraiter: false };
      }
      const delaisJours = regle.delaisJours ?? [];
      const canaux = regle.canaux ?? [];

      const maintenant = this.horloge.maintenant();
      const limite = ServiceRelancesFacture.LOT_PLANIFICATION;
      const resultat = await tx.execute<LigneFactureCandidate>(sql`
        select
          d.id::text as "id",
          d.client_id::text as "clientId",
          d.date_echeance::text as "dateEcheance",
          c.email as "email",
          c.telephone_e164 as "telephoneE164"
        from public.document_vente d
        join public.client c on c.tenant_id = d.tenant_id and c.id = d.client_id
        where d.tenant_id = ${ctx.tenantId}
          and d.type_document = 'facture'
          and d.contentieux = false
          and d.statut_reglement <> 'regle'
          and d.date_echeance is not null
        order by d.date_echeance asc, d.id asc
        limit ${limite + 1}
      `);

      const lignes = resultat.rows;
      const encoreATraiter = lignes.length > limite;
      const candidats = lignes.slice(0, limite);

      const nouvellesLignes: NouvelleRelancePlanifiee[] = [];
      for (const doc of candidats) {
        const dateEcheance = new Date(doc.dateEcheance);
        const paliers = calculerPaliersDus(dateEcheance, delaisJours, maintenant);
        for (const palier of paliers) {
          const destinataire = choisirCanalEtDestinataire(canaux, {
            email: doc.email,
            telephoneE164: doc.telephoneE164,
          });
          nouvellesLignes.push({
            tenantId: ctx.tenantId,
            typeRelance: 'facture_echue',
            objetType: 'document_vente',
            objetId: doc.id,
            palier: palier.palier,
            clientId: doc.clientId,
            echeancePrevue: palier.echeancePrevue,
            statut: statutInitialPlanification(destinataire),
            annuleRaison: null,
          });
        }
      }

      if (nouvellesLignes.length === 0) {
        return { creees: 0, ignorees: 0, encoreATraiter };
      }

      const inserees = await tx
        .insert(relancePlanifiee)
        .values(nouvellesLignes)
        .onConflictDoNothing({
          target: [
            relancePlanifiee.tenantId,
            relancePlanifiee.typeRelance,
            relancePlanifiee.objetId,
            relancePlanifiee.palier,
          ],
        })
        .returning({ id: relancePlanifiee.id });

      return {
        creees: inserees.length,
        ignorees: nouvellesLignes.length - inserees.length,
        encoreATraiter,
      };
    });
  }

  async envoyerPretes(ctx: ContexteTenant): Promise<ReponseEnvoiRelances> {
    const resolu = await this.registre.resoudre(ctx, 'NotificationSender');
    if (!resolu) {
      // Cas NORMAL (§6.3, en-tête de `notification-sender.ts` : « aucun vrai prestataire n'est
      // câblé nulle part aujourd'hui ») — jamais une erreur bloquante, voir
      // `RegistreConnecteursService.resoudre` (cas 1/2 de son en-tête).
      this.journal.warn('relances.envoi.connecteur_absent', { tenantId: ctx.tenantId });
      return { envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false };
    }
    // Narrowing sûr : le registre résout PAR `nomInterface`, seul un adaptateur déclarant
    // `nomInterface: 'NotificationSender'` peut être renvoyé ici (voir `adaptateur-notification-
    // sender.ts`, en-tête : « le registre … ne connaissent que le port générique »). `envoyer()`
    // n'existe que sur `AdaptateurNotificationSender`, jamais sur `AdaptateurConnecteur`.
    const adaptateur = resolu.adaptateur as unknown as AdaptateurNotificationSender;

    const [regle] = await this.acces.enTenant(ctx, async (tx) =>
      tx
        .select()
        .from(regleRelance)
        .where(
          and(
            eq(regleRelance.tenantId, ctx.tenantId),
            eq(regleRelance.typeRelance, 'facture_echue'),
          ),
        ),
    );
    const canaux = regle?.canaux ?? [];

    const limite = ServiceRelancesFacture.LOT_ENVOI;
    const candidatIds = await this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<{ id: string }>(sql`
        select id::text as "id"
          from public.relance_planifiee
         where tenant_id = ${ctx.tenantId}
           and type_relance = 'facture_echue'
           and statut = 'prete'
         order by echeance_prevue asc, id asc
         limit ${limite + 1}
      `);
      return resultat.rows.map((r) => r.id);
    });

    const encoreATraiter = candidatIds.length > limite;
    const idsATraiter = candidatIds.slice(0, limite);

    let envoyees = 0;
    let echouees = 0;
    let annulees = 0;

    // Séquentiel, volontairement : une ligne à la fois, jamais `Promise.all` — chaque itération
    // ouvre ses propres transactions courtes (réclamation, puis trace) et un seul appel réseau
    // (factice ici) à la fois, borné par LOT_ENVOI. Un futur worker réel peut paralléliser par
    // PROCESSUS (plusieurs appels concurrents à cette méthode), la réclamation conditionnelle
    // (`WHERE statut = 'prete'`) reste alors la seule protection nécessaire contre un double
    // traitement — jamais une hypothèse d'exclusivité côté application.
    for (const id of idsATraiter) {
      const issue = await this.traiterUneRelance(ctx, id, adaptateur, canaux);
      if (issue === 'envoyee') envoyees += 1;
      else if (issue === 'echouee') echouees += 1;
      else if (issue === 'annulee') annulees += 1;
      // 'ignoree' : réclamée entre-temps par un autre appel/processus — ne compte nulle part,
      // ce n'est pas un événement de CE traitement.
    }

    return { envoyees, echouees, annulees, encoreATraiter };
  }

  private async traiterUneRelance(
    ctx: ContexteTenant,
    relancePlanifieeId: string,
    adaptateur: AdaptateurNotificationSender,
    canaux: readonly ('sms' | 'email')[],
  ): Promise<'envoyee' | 'echouee' | 'annulee' | 'ignoree'> {
    const claim = await this.acces.enTenant(ctx, async (tx): Promise<ClaimAEnvoyer> => {
      // Réclamation conditionnelle — §6.1 : « le job d'envoi ne traite qu'une ligne dont il vient
      // de gagner le passage a_planifier → en_cours par une mise à jour conditionnelle ».
      const reclamees = await tx
        .update(relancePlanifiee)
        .set({ statut: 'en_cours_envoi' })
        .where(
          and(
            eq(relancePlanifiee.tenantId, ctx.tenantId),
            eq(relancePlanifiee.id, relancePlanifieeId),
            eq(relancePlanifiee.statut, 'prete'),
          ),
        )
        .returning();
      const ligne = reclamees[0];
      if (!ligne) {
        return { statut: 'ignoree' as const };
      }

      const resultat = await tx.execute<LigneFactureEtClientFraiche>(sql`
        select
          d.numero as "numero",
          d.contentieux as "contentieux",
          d.statut_reglement::text as "statutReglement",
          d.total_ttc_centimes as "totalTtcCentimes",
          d.solde_centimes as "soldeCentimes",
          d.date_echeance::text as "dateEcheance",
          c.email as "email",
          c.telephone_e164 as "telephoneE164",
          c.plus_aucun_contact as "plusAucunContact",
          c.langue::text as "langue"
        from public.relance_planifiee r
        join public.document_vente d on d.tenant_id = r.tenant_id and d.id = r.objet_id
        join public.client c on c.tenant_id = r.tenant_id and c.id = r.client_id
        where r.tenant_id = ${ctx.tenantId} and r.id = ${relancePlanifieeId}
      `);
      const infos = resultat.rows[0];
      /* c8 ignore next 5 -- invariant : une relance_planifiee de type document_vente référence
       * toujours un document et un client existants (FK client, objet_id jamais nettoyé) ; ce
       * garde-fou protège contre une corruption de données, jamais un chemin normal. */
      if (!infos) {
        throw new Error(
          `relance_planifiee ${relancePlanifieeId} : document ou client introuvable (invariant rompu).`,
        );
      }

      // RA-08/RA-14 vérifiées À L'EXÉCUTION, pas seulement à la planification (§9 cas n°1, n°8).
      const arret = verifierArretAutomatiqueFacture(
        {
          contentieux: infos.contentieux,
          statutReglement: infos.statutReglement as StatutReglementDocument,
        },
        { plusAucunContact: infos.plusAucunContact },
      );
      if (arret) {
        await tx
          .update(relancePlanifiee)
          .set({ statut: 'annulee', annuleRaison: arret.raison })
          .where(
            and(
              eq(relancePlanifiee.tenantId, ctx.tenantId),
              eq(relancePlanifiee.id, relancePlanifieeId),
            ),
          );
        return { statut: 'annulee' as const };
      }

      // RA-03 recalculé À L'ENVOI (coordonnées les plus fraîches possibles) plutôt que figé à la
      // planification — cohérent avec RA-11 (langue lue à l'envoi, rien de contractuel ici).
      const destinataire = choisirCanalEtDestinataire(canaux, {
        email: infos.email,
        telephoneE164: infos.telephoneE164,
      });
      if (!destinataire) {
        await tx
          .update(relancePlanifiee)
          .set({ statut: 'annulee', annuleRaison: 'contact_absent' })
          .where(
            and(
              eq(relancePlanifiee.tenantId, ctx.tenantId),
              eq(relancePlanifiee.id, relancePlanifieeId),
            ),
          );
        return { statut: 'annulee' as const };
      }

      const compteTentatives = await tx.execute<{
        readonly [cle: string]: unknown;
        readonly n: number;
      }>(sql`
        select count(*)::int as "n" from public.relance_envoi
         where tenant_id = ${ctx.tenantId} and relance_planifiee_id = ${relancePlanifieeId}
      `);
      // `count(*)` rend TOUJOURS exactement une ligne — jamais de garde nécessaire au-delà du
      // typage (`noUncheckedIndexedAccess`), mais `?? 0` documente l'intention sans `as`.
      const tentativesExistantes = compteTentatives.rows[0]?.n ?? 0;

      return {
        statut: 'a_envoyer' as const,
        objetId: ligne.objetId,
        palier: ligne.palier,
        tentative: tentativesExistantes + 1,
        canal: destinataire.canal,
        destinataireCible: destinataire.destinataire,
        langue: infos.langue as Langue,
        numero: infos.numero ?? '',
        totalTtcCentimes: Number(infos.totalTtcCentimes),
        soldeCentimes: Number(infos.soldeCentimes),
        dateEcheance: new Date(infos.dateEcheance),
      };
    });

    if (claim.statut !== 'a_envoyer') {
      return claim.statut;
    }

    // Appel au connecteur HORS transaction — jamais de connexion base tenue ouverte pendant un
    // appel réseau (même le factice), voir la note de séquentialité dans `envoyerPretes()`.
    const contenu: ContenuMessageClient = construireContenuRappelFacture({
      palier: claim.palier,
      numero: claim.numero,
      totalTtcCentimes: claim.totalTtcCentimes,
      soldeCentimes: claim.soldeCentimes,
      dateEcheance: claim.dateEcheance,
      langue: claim.langue,
      canal: claim.canal,
      destinataire: claim.destinataireCible,
    });
    const cleIdempotence = `${relancePlanifieeId}:${claim.tentative}`;

    let reponse: Awaited<ReturnType<AdaptateurNotificationSender['envoyer']>>;
    try {
      reponse = await adaptateur.envoyer({
        cleIdempotence,
        langue: claim.langue,
        contenu,
        referenceExterne: relancePlanifieeId,
      });
    } catch (erreur) {
      // Échec TRANSITOIRE (réseau, timeout) — jamais journalisé avec le contenu (PII), voir
      // l'avertissement de `notification-sender.ts`.
      this.journal.warn('relances.envoi.exception_adaptateur', {
        tenantId: ctx.tenantId,
        relancePlanifieeId,
        erreurNom: erreur instanceof Error ? erreur.name : 'inconnue',
      });
      reponse = {
        statut: 'rejete',
        raison: 'quota_depasse',
        message: erreur instanceof Error ? erreur.message : 'Erreur inconnue du connecteur.',
      };
    }

    return this.enregistrerIssueEnvoi(ctx, relancePlanifieeId, claim, contenu, reponse);
  }

  private async enregistrerIssueEnvoi(
    ctx: ContexteTenant,
    relancePlanifieeId: string,
    claim: InfosAEnvoyer,
    contenu: ContenuMessageClient,
    reponse: Awaited<ReturnType<AdaptateurNotificationSender['envoyer']>>,
  ): Promise<'envoyee' | 'echouee'> {
    const contenuFige = serialiserContenuFige(contenu);

    return this.acces.enTenant(ctx, async (tx) => {
      if (reponse.statut === 'accepte') {
        await tx.execute(sql`
          insert into public.relance_envoi
            (tenant_id, relance_planifiee_id, tentative, canal, destinataire_fige, langue_figee,
             contenu_fige, statut_envoi, fournisseur_message_id, erreur, envoye_le)
          values
            (${ctx.tenantId}, ${relancePlanifieeId}, ${claim.tentative}, ${claim.canal},
             ${claim.destinataireCible}, ${claim.langue}, ${contenuFige}, 'envoye',
             ${reponse.identifiantMessagePrestataire}, null, now())
        `);
        await tx
          .update(relancePlanifiee)
          .set({ statut: 'envoyee' })
          .where(
            and(
              eq(relancePlanifiee.tenantId, ctx.tenantId),
              eq(relancePlanifiee.id, relancePlanifieeId),
            ),
          );

        // Lot 1 : « Alimente enfin relanceNiveau/relanceLe » (§10 de la spec) — colonnes posées en
        // 0010, jamais écrites automatiquement avant ce lot.
        await tx.execute(sql`
          update public.document_vente
             set relance_niveau = greatest(relance_niveau, ${claim.palier}),
                 relance_le = now()
           where tenant_id = ${ctx.tenantId} and id = ${claim.objetId}
        `);

        return 'envoyee' as const;
      }

      const erreurTexte = `${reponse.raison}: ${reponse.message}`;
      await tx.execute(sql`
        insert into public.relance_envoi
          (tenant_id, relance_planifiee_id, tentative, canal, destinataire_fige, langue_figee,
           contenu_fige, statut_envoi, fournisseur_message_id, erreur, envoye_le)
        values
          (${ctx.tenantId}, ${relancePlanifieeId}, ${claim.tentative}, ${claim.canal},
           ${claim.destinataireCible}, ${claim.langue}, ${contenuFige}, 'echoue',
           null, ${erreurTexte}, now())
      `);
      const statutSuivant = statutApresEchecEnvoi(claim.tentative);
      await tx
        .update(relancePlanifiee)
        .set({ statut: statutSuivant })
        .where(
          and(
            eq(relancePlanifiee.tenantId, ctx.tenantId),
            eq(relancePlanifiee.id, relancePlanifieeId),
          ),
        );

      return 'echouee' as const;
    });
  }
}

/** `[key: string]: unknown` : requis par la contrainte générique de `TransactionDfa.execute<T>`
 *  (`T extends Record<string, unknown>`), même patron que les projections `tx.execute<...>` de
 *  `pneus/service-depot-pneus.ts`. N'affaiblit aucun typage : chaque colonne réellement lue
 *  garde son type précis ci-dessous, l'index signature ne fait qu'satisfaire la contrainte. */
interface LigneFactureCandidate {
  readonly [cle: string]: unknown;
  readonly id: string;
  readonly clientId: string;
  readonly dateEcheance: string;
  readonly email: string | null;
  readonly telephoneE164: string | null;
}

interface LigneFactureEtClientFraiche {
  readonly [cle: string]: unknown;
  readonly numero: string | null;
  readonly contentieux: boolean;
  readonly statutReglement: string;
  readonly totalTtcCentimes: string | number;
  readonly soldeCentimes: string | number;
  readonly dateEcheance: string;
  readonly email: string | null;
  readonly telephoneE164: string | null;
  readonly plusAucunContact: boolean;
  readonly langue: string;
}

interface InfosAEnvoyer {
  readonly statut: 'a_envoyer';
  readonly objetId: string;
  readonly palier: number;
  readonly tentative: number;
  readonly canal: 'sms' | 'email';
  readonly destinataireCible: string;
  readonly langue: Langue;
  readonly numero: string;
  readonly totalTtcCentimes: number;
  readonly soldeCentimes: number;
  readonly dateEcheance: Date;
}

type ClaimAEnvoyer = { readonly statut: 'ignoree' | 'annulee' } | InfosAEnvoyer;

function serialiserContenuFige(contenu: ContenuMessageClient): string {
  if (contenu.canal === 'sms') {
    return contenu.texte;
  }
  return `${contenu.sujet}\n\n${contenu.texte}`;
}
