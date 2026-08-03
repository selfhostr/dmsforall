import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  EntreeActionConfirmerReprise,
  EntreeActionNegocierReprise,
  EntreeActionRefuserReprise,
  EntreeCreationReprise,
  EntreeModificationReprise,
  ReponseAvecAvertissements,
  ReponseReprise,
  RoleUtilisateur,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { reprise, type LigneReprise } from '../db/schema';
import { chargerClientLigne, chargerPlaqueCourante, chargerResumeUtilisateur, chargerVehiculeLigne, construireVehiculeResume, versClientResume } from '../atelier/references';
import { CollecteurAvertissements } from '../common/avertissements';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { JETON_AUDIT, type ServiceAudit } from '../common/audit';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import { JETON_IDEMPOTENCE, type ReponseMemorisable, type ResultatIdempotent, type ServiceIdempotence } from '../common/idempotence';

import { versRepriseResponse } from './mappers';
import { chargerDossierVente, chargerRepriseParDossier, chargerRepriseParDossierOuNull, chargerRepriseParDossierPourEcriture } from './references';
import { extraireVersionETag } from './service-vehicule-stock';
import { traduireErreurTransitionVente } from './traducteur-transition-ventes';

/**
 * La reprise (RV-19→RV-28, §6.3) — sous-ressource SINGULIÈRE d'un dossier de vente (0 ou 1).
 *
 * RAPPEL NON NÉGOCIABLE (voir `contrats/ventes/reprise.ts`, tête de fichier) : `valeurEstimeeCentimes`
 * et `valeurNegocieeCentimes` restent TOUJOURS deux colonnes distinctes. Ce service ne calcule, ne
 * fige et n'expose AUCUNE base TVA — la question RV-22/QV-05 appartient à @laupernoe et à sa fiduciaire.
 */
@Injectable()
export class ServiceReprise {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_AUDIT) private readonly audit: ServiceAudit,
    private readonly horloge: Horloge,
  ) {}

  /** `POST /dossiers-vente/{dossierVenteId}/reprise` — `Idempotency-Key` obligatoire. Au plus une
   *  par dossier (`409 VENTE_REPRISE_DEJA_EXISTANTE`). Statut initial toujours `estimee`. */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    dossierVenteId: string,
    entree: EntreeCreationReprise,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseReprise> }>> {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/dossiers-vente/{dossierVenteId}/reprise', cle: cleIdempotence, corps: entree },
      async (tx) => {
        await chargerDossierVente(tx, ctx, dossierVenteId);

        const existante = await chargerRepriseParDossierOuNull(tx, ctx, dossierVenteId, true);
        if (existante) {
          throw new ErreurMetier('VENTE_REPRISE_DEJA_EXISTANTE', 'Ce dossier de vente porte déjà une reprise.');
        }

        await chargerVehiculeLigne(tx, ctx, entree.vehiculeReprisId);
        if (entree.detteFinancementOrganismeId) await chargerClientLigne(tx, ctx, entree.detteFinancementOrganismeId);

        let ligne: LigneReprise;
        try {
          const inserees = await tx
            .insert(reprise)
            .values({
              tenantId: ctx.tenantId,
              dossierVenteId,
              vehiculeRepriseId: entree.vehiculeReprisId,
              statut: 'estimee',
              valeurEstimeeCentimes: entree.valeurEstimeeCentimes,
              detteFinancementResiduelleCentimes: entree.detteFinancementResiduelleCentimes ?? null,
              detteFinancementOrganismeId: entree.detteFinancementOrganismeId ?? null,
              detteFinancementOrganismeNom: entree.detteFinancementOrganismeNom ?? null,
            })
            .returning();
          const inseree = inserees[0];
          if (!inseree) throw new ErreurMetier('ERREUR_INTERNE', "La création de la reprise n'a rendu aucune ligne.");
          ligne = inseree;
        } catch (erreur) {
          if (estViolationCleUnique(erreur)) {
            throw new ErreurMetier('VENTE_REPRISE_DEJA_EXISTANTE', 'Ce dossier de vente porte déjà une reprise.');
          }
          throw erreur;
        }

        const reponse = await this.assembler(tx, ctx, principal.role, ligne);
        return { statutHttp: 201, corps: new CollecteurAvertissements().envelopper(reponse) };
      },
    );
  }

  async obtenir(ctx: ContexteTenant, role: RoleUtilisateur, dossierVenteId: string): Promise<ReponseReprise> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRepriseParDossier(tx, ctx, dossierVenteId);
      return this.assembler(tx, ctx, role, ligne);
    });
  }

  /** `PATCH /dossiers-vente/{dossierVenteId}/reprise` — `If-Match` obligatoire.
   *  `valeurEstimeeCentimes` modifiable UNIQUEMENT tant que `statut = 'estimee'` (RV-27). */
  async modifier(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    ifMatch: string | undefined,
    entree: EntreeModificationReprise,
  ): Promise<ReponseAvecAvertissements<ReponseReprise>> {
    const versionAttendue = extraireVersionETag(ifMatch);

    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRepriseParDossierPourEcriture(tx, ctx, dossierVenteId);

      if (versionAttendue !== ligne.version) {
        throw new ErreurMetier('CONFLIT', 'La version de la reprise a changé depuis la dernière lecture.', {
          detail: `version_attendue=${String(versionAttendue)};version_actuelle=${String(ligne.version)}`,
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        });
      }

      if (entree.valeurEstimeeCentimes !== undefined && entree.valeurEstimeeCentimes !== ligne.valeurEstimeeCentimes && ligne.statut !== 'estimee') {
        throw new ErreurMetier('CONFLIT', "La valeur estimée n'est plus modifiable au-delà du stade « estimée » (RV-27).", {
          detail: `statutActuel=${ligne.statut}`,
        });
      }

      if (entree.detteFinancementOrganismeId) await chargerClientLigne(tx, ctx, entree.detteFinancementOrganismeId);

      await tx
        .update(reprise)
        .set({
          ...(entree.valeurEstimeeCentimes !== undefined ? { valeurEstimeeCentimes: entree.valeurEstimeeCentimes } : {}),
          ...(entree.detteFinancementResiduelleCentimes !== undefined
            ? { detteFinancementResiduelleCentimes: entree.detteFinancementResiduelleCentimes ?? null }
            : {}),
          ...(entree.detteFinancementOrganismeId !== undefined ? { detteFinancementOrganismeId: entree.detteFinancementOrganismeId ?? null } : {}),
          ...(entree.detteFinancementOrganismeNom !== undefined ? { detteFinancementOrganismeNom: entree.detteFinancementOrganismeNom ?? null } : {}),
        })
        .where(and(eq(reprise.tenantId, ctx.tenantId), eq(reprise.id, ligne.id)));

      const misAJour = await chargerRepriseParDossier(tx, ctx, dossierVenteId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  /** `POST /dossiers-vente/{dossierVenteId}/reprise/negocier` — `{estimee,negociee} -> negociee`,
   *  rejouable tant que non confirmée/refusée (RV-06). */
  async negocier(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    entree: EntreeActionNegocierReprise,
  ): Promise<ReponseAvecAvertissements<ReponseReprise>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRepriseParDossierPourEcriture(tx, ctx, dossierVenteId);
      await this.transitionner(tx, ligne, {
        statut: 'negociee',
        valeurNegocieeCentimes: entree.valeurNegocieeCentimes,
        negocieeLe: this.horloge.maintenant(),
      });
      const misAJour = await chargerRepriseParDossier(tx, ctx, dossierVenteId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  /** `POST /dossiers-vente/{dossierVenteId}/reprise/confirmer` — `negociee -> confirmee`. NORMALEMENT
   *  un effet de bord de `POST /dossiers-vente/{id}/engager` — appel direct réservé à la correction
   *  exceptionnelle (`ventes.reprise.confirmer`, direction seule). */
  async confirmer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    _entree: EntreeActionConfirmerReprise,
  ): Promise<ReponseAvecAvertissements<ReponseReprise>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRepriseParDossierPourEcriture(tx, ctx, dossierVenteId);
      if (ligne.valeurNegocieeCentimes === null) {
        throw new ErreurMetier(
          'VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE',
          'Impossible de confirmer une reprise sans valeur négociée (RV-27).',
        );
      }
      await this.transitionner(tx, ligne, { statut: 'confirmee', confirmeeLe: this.horloge.maintenant() });
      const misAJour = await chargerRepriseParDossier(tx, ctx, dossierVenteId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  /** `POST /dossiers-vente/{dossierVenteId}/reprise/refuser` — `{estimee,negociee} -> refusee`,
   *  motif obligatoire. N'annule PAS le dossier (RV-25). */
  async refuser(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    entree: EntreeActionRefuserReprise,
  ): Promise<ReponseAvecAvertissements<ReponseReprise>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRepriseParDossierPourEcriture(tx, ctx, dossierVenteId);
      await this.transitionner(tx, ligne, { statut: 'refusee', refuseeLe: this.horloge.maintenant(), motifRefus: entree.motif });
      const misAJour = await chargerRepriseParDossier(tx, ctx, dossierVenteId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  private async assembler(tx: TransactionDfa, ctx: ContexteTenant, role: RoleUtilisateur, ligne: LigneReprise): Promise<ReponseReprise> {
    const vehiculeRepriseLigne = await chargerVehiculeLigne(tx, ctx, ligne.vehiculeRepriseId);
    const plaque = await chargerPlaqueCourante(tx, ctx, ligne.vehiculeRepriseId);
    const vehiculeReprisResume = construireVehiculeResume(vehiculeRepriseLigne, plaque);

    const organisme = ligne.detteFinancementOrganismeId
      ? await versClientResume(tx, ctx, await chargerClientLigne(tx, ctx, ligne.detteFinancementOrganismeId))
      : null;

    const journal = await this.audit.pourEntite(ctx, 'reprise', ligne.id);
    const modifiePar = await chargerResumeUtilisateur(tx, ctx, journal.at(-1)?.utilisateurId ?? null);

    return versRepriseResponse({ ligne, vehiculeRepris: vehiculeReprisResume, detteFinancementOrganisme: organisme, role, modifiePar });
  }

  private async transitionner(
    tx: TransactionDfa,
    ligne: LigneReprise,
    champs: Partial<Omit<LigneReprise, 'id' | 'tenantId'>> & { readonly statut: LigneReprise['statut'] },
  ): Promise<void> {
    try {
      await tx.update(reprise).set(champs).where(and(eq(reprise.tenantId, ligne.tenantId), eq(reprise.id, ligne.id)));
    } catch (erreur) {
      const traduite = traduireErreurTransitionVente(erreur, ligne.id, ligne.id);
      if (traduite) throw traduite;
      throw erreur;
    }
  }
}

function estViolationCleUnique(erreur: unknown): boolean {
  return typeof erreur === 'object' && erreur !== null && (erreur as { code?: unknown }).code === '23505';
}
