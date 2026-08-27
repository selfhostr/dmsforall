import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type {
  ContenuMessageClient,
  Langue,
  ReponseEnvoiMessageClient,
  ReponseEnvoiRelances,
  ReponsePlanificationRelances,
  StatutDocumentVente,
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
import { EXPEDITEUR_DFA_PAR_DEFAUT } from '../courriel/config-courriel';
import { ServiceCourriel } from '../courriel/service-courriel';
import type { PieceJointeCourriel } from '../courriel/transport-courriel.interface';
import { JETON_CONFIG, type Config } from '../config';
import { JETON_STOCKAGE_PDF } from '../facturation/impression/impression.jetons';
import { sha256Hex, type StockagePdf } from '../facturation/impression/stockage-pdf';

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
 * Un ordonnanceur BullMQ horaire existe désormais (`relances/relances-job.module.ts`, gaté par
 * `MODE_PROCESSUS` — voir sa doc) et invoque `planifier()` PUIS `envoyerPretes()` pour chaque
 * tenant actif — voir `orchestration-job-relances.ts` pour le détail. Les deux méthodes restent
 * aussi APPELABLES À LA DEMANDE (`relances.controller.ts`, `POST .../planifier`/`.../envoyer`),
 * idempotentes, traitant chacune un LOT BORNÉ par
 * appel (jamais un balayage complet sans limite — même raisonnement que la pagination par
 * curseur : un tenant avec 5 ans d'historique et 50 OR/jour a potentiellement des milliers de
 * factures en souffrance, un seul appel ne doit jamais tenter de toutes les traiter d'un coup) :
 *
 *  - `planifier()` — calcule les paliers dus (§6.1) et les insère (`ON CONFLICT DO NOTHING` sur
 *    `relance_planifiee_tenant_type_objet_palier_uk`, RA-05).
 *  - `envoyerPretes()` — fait passer à l'envoi les lignes `prete`, réclamées une par une par
 *    mise à jour conditionnelle (`WHERE statut = 'prete'`, §6.1) avant l'envoi effectif, dont le
 *    chemin dépend du CANAL choisi par `choisirCanalEtDestinataire` (RA-03) :
 *      - `email` → `ServiceCourriel.envoyer()` (socle SMTP/capture, `courriel/`) — envoi RÉEL
 *        depuis l'issue #136, voir `envoyerEmailReel()` ci-dessous.
 *      - `sms` → l'adaptateur `NotificationSender` (résolu via `RegistreConnecteursService`,
 *        étape 5) — INCHANGÉ, toujours sans prestataire câblé à ce jour (`resoudre()` rend
 *        systématiquement `null`, voir `connecteurs.module.ts`) : une ligne `sms` sans adaptateur
 *        actif est un REJET tracé (`canal_non_supporte`), jamais un blocage du lot entier.
 *
 * Droits posés définitivement dans `auth/matrice-droits.ts` (`relances.facturation.planifier`/
 * `.envoyer`) : l'autorisation est portée EXCLUSIVEMENT par `@ExigerDroit(...)` + `GardeDroit` sur
 * `relances.controller.ts` — ce service ne prend PLUS de rôle en paramètre (retiré avec le
 * palliatif `relances/droits-provisoires.ts`, même patron que `service-regle-relance.ts` et
 * `pneus/service-depot-pneus.ts`).
 *
 * ISSUE #136 — CE QUI A CHANGÉ : avant cette issue, `envoyerPretes()` résolvait `NotificationSender`
 * UNE SEULE FOIS pour tout le lot et rendait un lot vide dès que `resoudre()` rendait `null` — ce
 * qui arrive TOUJOURS aujourd'hui (`SourceActivationsConnecteurAucune`), donc AUCUNE relance, e-mail
 * compris, ne partait jamais réellement (le connecteur factice n'était même pas atteint). Le canal
 * SMS reste dans cet état (`sms`), documenté, pas régressé. Le canal `email`, lui, ne dépend plus
 * de ce registre : voir `envoyerEmailReel()`.
 *
 * ADRESSE DE RÉPONSE DU GARAGE (`adresseReponseGarage`, `resoudreExpediteurGarage()`) — AUCUN champ
 * dédié n'existe dans le modèle de données (`tenant`, `site`, bloc créancier de facturation) pour
 * « l'adresse de contact du garage » : signalé à @laupernoe (rapport de livraison de cette issue), plutôt
 * qu'une supposition à l'aveugle. En attendant un champ dédié, ce service retient l'e-mail du
 * premier compte `direction` actif du tenant (à défaut `comptable`), repli défensif sur
 * `SMTP_EXPEDITEUR`/`EXPEDITEUR_DFA_PAR_DEFAUT` si aucun des deux n'existe (jamais un envoi
 * bloqué pour cette seule raison).
 *
 * DÉCLENCHEUR PÉRIODIQUE — RÉSOLU : `relances/relances-job.module.ts` (BullMQ, cron horaire) l'a
 * ajouté. L'IDENTITÉ DE L'APPELANT SYSTÈME, elle, est tranchée comme pour les trois autres jobs du
 * dépôt (`pointage/orchestration-job-cloture-automatique-pointage.ts`, § « IDENTITÉ DE L'APPELANT
 * SYSTÈME ») : `ContexteTenant.utilisateurId = null` (convention `db/db.types.ts`), JAMAIS un
 * compte `direction`/`comptable` fabriqué — voir `orchestration-job-relances.ts`.
 *
 * PIÈCE JOINTE (PDF de facture) — l'e-mail de rappel part désormais AVEC la facture en pièce
 * jointe, lue en LECTURE SEULE sur le PDF déjà mis en cache (`document_vente.pdf_cle`), jamais
 * régénérée : ce service n'a pas de `PrincipalAuthentifie` pour faire valider RF-116. Voir le
 * constructeur ci-dessous et `resoudrePieceJointeFacture()`. Pour un envoi DÉCLENCHÉ PAR UN
 * UTILISATEUR (droits RF-116 réels, génération paresseuse si besoin), voir
 * `facturation/impression/service-envoi-facture-courriel.ts`
 * (`POST /documents-vente/{id}/envoyer-courriel`).
 */
@Injectable()
export class ServiceRelancesFacture {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly registre: RegistreConnecteursService,
    private readonly horloge: Horloge,
    private readonly journal: ServiceJournal,
    private readonly serviceCourriel: ServiceCourriel,
    @Inject(JETON_CONFIG) private readonly config: Config,
    // PDF de facture — lecture SEULE, jamais de régénération (arbitrage du coordinateur,
    // rapport de livraison de cette issue) : ce job n'a pas de `PrincipalAuthentifie`, donc
    // aucun moyen de faire valider RF-116 par `ServiceDocumentsVente`. Le fichier déjà mis en
    // cache par `ServiceImpressionFacture` (`document_vente.pdf_cle`, immuable une fois posé —
    // une facture émise ne change jamais) est, lui, garanti identique par construction : ce sont
    // EXACTEMENT les mêmes octets que ceux déjà servis à un utilisateur habilité. Voir
    // `resoudrePieceJointeFacture` ci-dessous.
    @Inject(JETON_STOCKAGE_PDF) private readonly stockagePdf: StockagePdf,
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
      // `d.statut = 'emis'` : même condition que l'index partiel canonique du grand livre des
      // débiteurs (`0010_facturation.sql`, `statut = 'emis'`). Sans ce filtre, une facture
      // `annule_par_avoir` (RF-32) — dont `statutReglement` reste `non_regle` et `dateEcheance`
      // n'est jamais nettoyée — reste candidate et continue d'être planifiée pour une créance qui
      // n'existe plus. Défense en profondeur : `verifierArretAutomatiqueFacture` (via
      // `factureEligibleRelance`) applique la même règle à l'exécution, pour une relance déjà
      // planifiée AVANT que la facture soit annulée par avoir.
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
          and d.statut = 'emis'
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
    // Résolution OPTIONNELLE — canal `sms` UNIQUEMENT (voir la doc d'en-tête de cette classe). Ne
    // bloque JAMAIS le lot : contrairement à avant l'issue #136, `null` ici ne rend plus un lot
    // vide immédiat — seules les lignes qui choisissent effectivement `sms` en dépendent (voir
    // `traiterUneRelance`/`envoyerSmsViaConnecteur`).
    const resolu = await this.registre.resoudre(ctx, 'NotificationSender');
    if (!resolu) {
      // Cas NORMAL (§6.3, en-tête de `notification-sender.ts` : « aucun vrai prestataire n'est
      // câblé nulle part aujourd'hui ») — jamais une erreur bloquante, voir
      // `RegistreConnecteursService.resoudre` (cas 1/2 de son en-tête).
      this.journal.warn('relances.envoi.connecteur_sms_absent', { tenantId: ctx.tenantId });
    }
    // Narrowing sûr : le registre résout PAR `nomInterface`, seul un adaptateur déclarant
    // `nomInterface: 'NotificationSender'` peut être renvoyé ici (voir `adaptateur-notification-
    // sender.ts`, en-tête : « le registre … ne connaissent que le port générique »). `envoyer()`
    // n'existe que sur `AdaptateurNotificationSender`, jamais sur `AdaptateurConnecteur`.
    const adaptateurSms = resolu
      ? (resolu.adaptateur as unknown as AdaptateurNotificationSender)
      : null;

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

    if (idsATraiter.length === 0) {
      return { envoyees: 0, echouees: 0, annulees: 0, encoreATraiter };
    }

    // Une seule résolution par appel (constante pour tout le lot, un seul tenant) — jamais une
    // requête par ligne. Voir la doc d'en-tête de la classe : aucun champ dédié n'existe encore
    // pour « l'adresse de contact du garage », ce repli est un ARBITRAGE SIGNALÉ, pas une donnée
    // stable.
    const expediteurGarage = await this.resoudreExpediteurGarage(ctx);

    let envoyees = 0;
    let echouees = 0;
    let annulees = 0;

    // Séquentiel, volontairement : une ligne à la fois, jamais `Promise.all` — chaque itération
    // ouvre ses propres transactions courtes (réclamation, puis trace) et un seul appel réseau
    // (SMTP réel ou capture pour l'e-mail, factice pour le SMS) à la fois, borné par LOT_ENVOI. Un
    // futur worker réel peut paralléliser par PROCESSUS (plusieurs appels concurrents à cette
    // méthode), la réclamation conditionnelle (`WHERE statut = 'prete'`) reste alors la seule
    // protection nécessaire contre un double traitement — jamais une hypothèse d'exclusivité côté
    // application.
    for (const id of idsATraiter) {
      const issue = await this.traiterUneRelance(ctx, id, adaptateurSms, canaux, expediteurGarage);
      if (issue === 'envoyee') envoyees += 1;
      else if (issue === 'echouee') echouees += 1;
      else if (issue === 'annulee') annulees += 1;
      // 'ignoree' : réclamée entre-temps par un autre appel/processus — ne compte nulle part,
      // ce n'est pas un événement de CE traitement.
    }

    return { envoyees, echouees, annulees, encoreATraiter };
  }

  /**
   * Identité d'expédition e-mail des relances — `nomGarage` (nom affiché) et `adresseReponseGarage`
   * (`Reply-To`, arbitrage de @laupernoe du 14.08.2026 : « le client répond au garagiste, pas au néant »).
   * `raisonSociale` est TOUJOURS présente (`tenant.raisonSociale`, colonne `NOT NULL`) ; l'adresse
   * de réponse, elle, n'a AUCUNE colonne dédiée aujourd'hui (`tenant`, `site`, bloc créancier de
   * facturation) — signalé au coordinateur plutôt qu'une supposition non vérifiable. Repli, dans
   * l'ordre : e-mail du premier compte `direction` actif du tenant, puis `comptable`, puis
   * `SMTP_EXPEDITEUR`/`EXPEDITEUR_DFA_PAR_DEFAUT` (jamais un envoi bloqué pour cette seule raison).
   */
  private async resoudreExpediteurGarage(ctx: ContexteTenant): Promise<ExpediteurGarage> {
    return this.acces.enTenant(ctx, async (tx) => {
      const resultat = await tx.execute<LigneExpediteurGarage>(sql`
        select
          t.raison_sociale as "raisonSociale",
          (
            select u.email
              from public.utilisateur u
             where u.tenant_id = t.id
               and u.statut = 'actif'
               and u.role in ('direction', 'comptable')
             order by (u.role = 'direction') desc, u.cree_le asc
             limit 1
          ) as "emailContactGarage"
        from public.tenant t
        where t.id = ${ctx.tenantId}
      `);
      const ligne = resultat.rows[0];
      /* c8 ignore next 3 -- invariant : `ctx.tenantId` référence toujours un tenant existant
       * (session authentifiée sur ce tenant), jamais un identifiant arbitraire. */
      if (!ligne) {
        throw new Error(`tenant ${ctx.tenantId} introuvable (invariant rompu).`);
      }
      return {
        nomGarage: ligne.raisonSociale,
        adresseReponseGarage:
          ligne.emailContactGarage ?? this.config.SMTP_EXPEDITEUR ?? EXPEDITEUR_DFA_PAR_DEFAUT,
      };
    });
  }

  private async traiterUneRelance(
    ctx: ContexteTenant,
    relancePlanifieeId: string,
    adaptateurSms: AdaptateurNotificationSender | null,
    canaux: readonly ('sms' | 'email')[],
    expediteurGarage: ExpediteurGarage,
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
      // `palier` n'est nullable en base que pour un marqueur de reprise (0072,
      // relance_planifiee_palier_requis_actif_chk : palier is null => statut = 'annulee'). La
      // réclamation ci-dessus vient de faire passer CETTE ligne de 'prete' à 'en_cours_envoi' —
      // 'prete' <> 'annulee', donc l'invariant garantit palier non NULL ici. Assertion défensive
      // (même patron que le contrôle `tenant introuvable` ci-dessus) plutôt qu'un `as number` :
      // si l'invariant se rompt un jour, ce doit être une erreur explicite, pas un `undefined`
      // silencieux dans le message envoyé au client.
      if (ligne.palier === null) {
        throw new Error(
          `relance_planifiee ${ligne.id} : palier NULL sur une ligne 'en_cours_envoi' — ` +
            `invariant relance_planifiee_palier_requis_actif_chk rompu.`,
        );
      }

      const resultat = await tx.execute<LigneFactureEtClientFraiche>(sql`
        select
          d.numero as "numero",
          d.statut::text as "statut",
          d.contentieux as "contentieux",
          d.statut_reglement::text as "statutReglement",
          d.total_ttc_centimes as "totalTtcCentimes",
          d.solde_centimes as "soldeCentimes",
          d.date_echeance::text as "dateEcheance",
          d.pdf_cle as "pdfCle",
          d.pdf_sha256 as "pdfSha256",
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

      // RA-08/RA-14 vérifiées À L'EXÉCUTION, pas seulement à la planification (§9 cas n°1, n°8) —
      // `statut` couvre le cas d'une facture annulée par avoir (RF-32) ENTRE la planification et
      // l'envoi : voir le commentaire de `planifier()` et de `factureEligibleRelance`.
      const arret = verifierArretAutomatiqueFacture(
        {
          statut: infos.statut as StatutDocumentVente,
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
        pdfCle: infos.pdfCle,
        pdfSha256: infos.pdfSha256,
      };
    });

    if (claim.statut !== 'a_envoyer') {
      return claim.statut;
    }

    // Appel au transport HORS transaction — jamais de connexion base tenue ouverte pendant un
    // appel réseau (SMTP réel, capture, ou le connecteur SMS factice), voir la note de
    // séquentialité dans `envoyerPretes()`.
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

    // Deux chemins d'envoi, un seul point de bifurcation (voir la doc d'en-tête de la classe) :
    // `email` part RÉELLEMENT via le socle courriel (`ServiceCourriel`), `sms` reste derrière le
    // connecteur générique `NotificationSender` (aucun prestataire câblé à ce jour). Ni l'un ni
    // l'autre ne laisse une exception remonter jusqu'ici — chacun absorbe son échec transitoire et
    // rend un `ReponseEnvoiMessageClient`, seul type que `enregistrerIssueEnvoi` connaît.
    const reponse: ReponseEnvoiMessageClient =
      contenu.canal === 'email'
        ? await this.envoyerEmailReel(
            ctx,
            relancePlanifieeId,
            contenu,
            expediteurGarage,
            cleIdempotence,
            claim.numero,
            claim.pdfCle,
            claim.pdfSha256,
          )
        : await this.envoyerSmsViaConnecteur(
            ctx,
            relancePlanifieeId,
            adaptateurSms,
            claim.langue,
            contenu,
            cleIdempotence,
          );

    return this.enregistrerIssueEnvoi(ctx, relancePlanifieeId, claim, contenu, reponse);
  }

  /**
   * Canal `email` — envoi RÉEL (issue #136), via `ServiceCourriel.envoyer()` (socle `courriel/`,
   * déjà responsable du verrou à deux clés `courrielDoitEnvoyerReellement` : SMTP réel UNIQUEMENT
   * si `NODE_ENV === 'production'` ET `COURRIEL_ENVOI_REEL === true`, capture sinon — ce service
   * ne réimplémente ni ne contourne ce verrou, il consomme `ServiceCourriel` tel quel).
   *
   * `ServiceCourriel.envoyer()` ne rejette JAMAIS sa promesse en pratique (chaque transport
   * encapsule son échec dans `ResultatEnvoiCourriel.succes`) — le `try/catch` reste une garde
   * défensive, même doctrine que `envoyerSmsViaConnecteur` : un appelant de ce service ne doit
   * jamais dépendre d'une implémentation particulière de transport pour rester robuste.
   */
  private async envoyerEmailReel(
    ctx: ContexteTenant,
    relancePlanifieeId: string,
    contenu: Extract<ContenuMessageClient, { readonly canal: 'email' }>,
    expediteurGarage: ExpediteurGarage,
    cleIdempotence: string,
    numero: string,
    pdfCle: string | null,
    pdfSha256: string | null,
  ): Promise<ReponseEnvoiMessageClient> {
    // Pièce jointe AVANT tout appel SMTP — voir `resoudrePieceJointeFacture` : jamais un envoi
    // « amputé » (arbitrage du coordinateur, rapport de livraison) — soit la facture part avec
    // son PDF, soit elle ne part pas du tout à cette tentative (retentée au prochain passage
    // horaire, voir `statutApresEchecEnvoi`).
    const piece = await this.resoudrePieceJointeFacture(
      ctx,
      relancePlanifieeId,
      numero,
      pdfCle,
      pdfSha256,
    );
    if (!piece.trouvee) {
      return { statut: 'rejete', raison: 'contenu_refuse', message: piece.motif };
    }

    try {
      const resultat = await this.serviceCourriel.envoyer({
        destinataires: [contenu.destinataire],
        sujet: contenu.sujet,
        corpsTexte: contenu.texte,
        corpsHtml: contenu.html ?? undefined,
        nomGarage: expediteurGarage.nomGarage,
        adresseReponseGarage: expediteurGarage.adresseReponseGarage,
        piecesJointes: [piece.piece],
      });
      if (resultat.succes) {
        // `identifiantMessagePrestataire` ne doit JAMAIS être vide (contrat, décision 1) — repli
        // sur `cleIdempotence` si le transport n'en rend aucun (le transport de capture en rend
        // toujours un, `TransportSmtp` aussi via le `Message-Id` nodemailer ; défensif seulement).
        return {
          statut: 'accepte',
          identifiantMessagePrestataire: resultat.idMessage ?? cleIdempotence,
        };
      }
      // Aucun des quatre codes `RaisonRejetMessageClient` (`destinataire_invalide`,
      // `canal_non_supporte`, `contenu_refuse`, `quota_depasse`) ne nomme littéralement « échec de
      // transport SMTP » — cet enum est un contrat GELÉ du domaine `connecteurs`, hors périmètre
      // d'écriture de cette issue (voir CONTRIBUTING.md : périmètres disjoints). `quota_depasse` est déjà
      // le code de repli établi par ce même fichier pour toute exception transitoire de connecteur
      // (voir `envoyerSmsViaConnecteur` ci-dessous) — repris ici pour la même famille de panne
      // (tiers indisponible), jamais un jugement sur la cause réelle. Signalé au coordinateur :
      // un code dédié (`erreur_transport` ou équivalent) serait plus lisible dans l'historique.
      return {
        statut: 'rejete',
        raison: 'quota_depasse',
        message: resultat.erreur ?? 'Échec d’envoi du courriel (transport).',
      };
    } catch (erreur) {
      // Jamais journalisé avec le contenu (PII) — même garde que `envoyerSmsViaConnecteur`.
      this.journal.warn('relances.envoi.exception_courriel', {
        tenantId: ctx.tenantId,
        relancePlanifieeId,
        erreurNom: erreur instanceof Error ? erreur.name : 'inconnue',
      });
      return {
        statut: 'rejete',
        raison: 'quota_depasse',
        message:
          erreur instanceof Error ? erreur.message : 'Erreur inconnue du transport courriel.',
      };
    }
  }

  /**
   * Résout le PDF de facture déjà mis en cache — LECTURE SEULE, jamais de régénération (voir la
   * doc du constructeur pour l'arbitrage complet : ce service n'a pas de `PrincipalAuthentifie`
   * pour faire valider RF-116). Deux cas de refus, tous deux journalisés en clair (jamais en
   * silence — piège explicitement évité, voir `copierPdfDocumentsEnCache`,
   * `exploitation/cycle-vie-tenant/service-copie-pdf-documents.ts`, qui distingue déjà « aucun
   * fichier jamais généré » d'une vraie erreur de lecture) :
   *
   *   1. `pdfCle` est `null` — cette facture n'a JAMAIS été consultée/imprimée dans l'application
   *      (génération PARESSEUSE, voir `service-impression-facture.ts`). État NORMAL et courant,
   *      journalisé en `warn` : la relance repasse `prete` (voir `statutApresEchecEnvoi`) et sera
   *      retentée au prochain passage horaire — le temps qu'un utilisateur habilité consulte la
   *      facture une première fois (ou qu'un futur endpoint dédié la génère).
   *   2. `pdfCle` est posé mais le fichier est illisible, ou son empreinte SHA-256 ne correspond
   *      plus à `pdfSha256` figé en base — INCOHÉRENCE de stockage, jamais un état attendu :
   *      journalisé en `error`. Refuse d'attacher un contenu dont on ne peut plus garantir qu'il
   *      est celui réellement émis, même doctrine que `ServiceImpressionFacture.obtenirPdf`.
   *
   * Dans les deux cas : PAS d'envoi amputé. La relance échoue proprement pour cette tentative,
   * jamais un courriel qui prétend porter la facture sans qu'elle y soit.
   */
  private async resoudrePieceJointeFacture(
    ctx: ContexteTenant,
    relancePlanifieeId: string,
    numero: string,
    pdfCle: string | null,
    pdfSha256: string | null,
  ): Promise<
    | { readonly trouvee: true; readonly piece: PieceJointeCourriel }
    | { readonly trouvee: false; readonly motif: string }
  > {
    if (!pdfCle) {
      this.journal.warn('relances.envoi.pdf_absent', {
        tenantId: ctx.tenantId,
        relancePlanifieeId,
      });
      return {
        trouvee: false,
        motif: `Facture ${numero} : aucun PDF encore mis en cache (jamais consultée dans l’application) — relance non envoyée sans sa pièce jointe.`,
      };
    }

    let contenu: Buffer;
    try {
      contenu = await this.stockagePdf.lire(pdfCle);
    } catch (erreur) {
      this.journal.error('relances.envoi.pdf_illisible', erreur, {
        tenantId: ctx.tenantId,
        relancePlanifieeId,
        pdfCle,
      });
      return {
        trouvee: false,
        motif: `Facture ${numero} : PDF mis en cache introuvable ou illisible (${pdfCle}) — relance non envoyée sans sa pièce jointe.`,
      };
    }

    if (pdfSha256 && sha256Hex(contenu) !== pdfSha256) {
      // Même doctrine que `ServiceImpressionFacture.obtenirPdf` : jamais servir un contenu dont
      // l'empreinte ne correspond plus à celle figée en base au moment de sa mise en cache.
      this.journal.error('relances.envoi.pdf_empreinte_invalide', undefined, {
        tenantId: ctx.tenantId,
        relancePlanifieeId,
        pdfCle,
      });
      return {
        trouvee: false,
        motif: `Facture ${numero} : le PDF mis en cache (${pdfCle}) ne correspond plus à son empreinte figée en base — relance non envoyée sans sa pièce jointe.`,
      };
    }

    const nomFichier = `Facture-${numero.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    return { trouvee: true, piece: { nomFichier, contenu, typeMime: 'application/pdf' } };
  }

  /**
   * Canal `sms` — INCHANGÉ par l'issue #136 : toujours derrière le connecteur générique
   * `NotificationSender` (résolu une fois par lot dans `envoyerPretes()`), toujours sans
   * prestataire réel câblé (`RegistreConnecteursService.resoudre()` rend `null`, voir la doc
   * d'en-tête de la classe). `adaptateurSms === null` est un REJET tracé, jamais un blocage
   * silencieux — avant l'issue #136, ce cas empêchait même les lignes `email` d'être traitées.
   */
  private async envoyerSmsViaConnecteur(
    ctx: ContexteTenant,
    relancePlanifieeId: string,
    adaptateurSms: AdaptateurNotificationSender | null,
    langue: Langue,
    contenu: ContenuMessageClient,
    cleIdempotence: string,
  ): Promise<ReponseEnvoiMessageClient> {
    if (!adaptateurSms) {
      return {
        statut: 'rejete',
        raison: 'canal_non_supporte',
        message: 'Aucun connecteur SMS actif pour ce tenant.',
      };
    }
    try {
      return await adaptateurSms.envoyer({
        cleIdempotence,
        langue,
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
      return {
        statut: 'rejete',
        raison: 'quota_depasse',
        message: erreur instanceof Error ? erreur.message : 'Erreur inconnue du connecteur.',
      };
    }
  }

  private async enregistrerIssueEnvoi(
    ctx: ContexteTenant,
    relancePlanifieeId: string,
    claim: InfosAEnvoyer,
    contenu: ContenuMessageClient,
    reponse: ReponseEnvoiMessageClient,
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

/** Identité d'expédition e-mail résolue pour UN lot (`resoudreExpediteurGarage`) — voir la doc
 *  d'en-tête de la classe pour l'arbitrage signalé sur `adresseReponseGarage`. */
interface ExpediteurGarage {
  readonly nomGarage: string;
  readonly adresseReponseGarage: string;
}

interface LigneExpediteurGarage {
  readonly [cle: string]: unknown;
  readonly raisonSociale: string;
  /** `null` si le tenant n'a aucun compte `direction`/`comptable` actif — voir le repli dans
   *  `resoudreExpediteurGarage`. */
  readonly emailContactGarage: string | null;
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
  readonly statut: string;
  readonly contentieux: boolean;
  readonly statutReglement: string;
  readonly totalTtcCentimes: string | number;
  readonly soldeCentimes: string | number;
  readonly dateEcheance: string;
  /** `null` tant que personne n'a jamais consulté/imprimé cette facture — génération PARESSEUSE,
   *  voir `facturation/impression/service-impression-facture.ts`. Ce service ne régénère JAMAIS
   *  ce PDF (§ en-tête de la classe), il se contente de lire ce qui existe déjà. */
  readonly pdfCle: string | null;
  readonly pdfSha256: string | null;
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
  /** Voir `LigneFactureEtClientFraiche.pdfCle` — non pertinent pour le canal `sms`, toujours
   *  porté ici pour éviter un second type distinct par canal. */
  readonly pdfCle: string | null;
  readonly pdfSha256: string | null;
}

type ClaimAEnvoyer = { readonly statut: 'ignoree' | 'annulee' } | InfosAEnvoyer;

function serialiserContenuFige(contenu: ContenuMessageClient): string {
  if (contenu.canal === 'sms') {
    return contenu.texte;
  }
  return `${contenu.sujet}\n\n${contenu.texte}`;
}
