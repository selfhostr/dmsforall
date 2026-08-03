import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  EntreeActionConfirmerFinancement,
  EntreeActionRefuserFinancement,
  EntreeCreationFinancement,
  ReponseAvecAvertissements,
  ReponseFinancement,
  RoleUtilisateur,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { financementVente, type LigneFinancementVente } from '../db/schema';
import { chargerClientLigne, versClientResume } from '../atelier/references';
import { CollecteurAvertissements } from '../common/avertissements';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import { JETON_IDEMPOTENCE, type ReponseMemorisable, type ResultatIdempotent, type ServiceIdempotence } from '../common/idempotence';

import { versFinancementResponse } from './mappers';
import { chargerDossierVente, chargerFinancementPourEcriture } from './references';
import { traduireErreurTransitionVente } from './traducteur-transition-ventes';

/**
 * Financement/leasing (RV-39→RV-45) — sous-ressource COLLECTION d'un dossier, APPEND-ONLY (CV-03,
 * un refus est TERMINAL, jamais rouvert — un nouveau mode de financement est une NOUVELLE ligne).
 */
@Injectable()
export class ServiceFinancement {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
  ) {}

  /** `POST /dossiers-vente/{dossierVenteId}/financements` — `Idempotency-Key` obligatoire.
   *  `statutConfirmation` initial DÉRIVÉ : `confirme` immédiat pour `comptant`, `en_attente` sinon. */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    dossierVenteId: string,
    entree: EntreeCreationFinancement,
    cleIdempotence: string,
  ): Promise<ResultatIdempotent<ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseFinancement> }>> {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/dossiers-vente/{dossierVenteId}/financements', cle: cleIdempotence, corps: entree },
      async (tx) => {
        await chargerDossierVente(tx, ctx, dossierVenteId);

        if (entree.type !== 'comptant' && !entree.organismeId) {
          throw new ErreurMetier('VALIDATION_ECHOUEE', "L'organisme de financement est obligatoire pour un crédit ou un leasing (RV-40/RV-44).", {
            erreurs: [{ champ: 'organismeId', code: 'requis', message: 'Organisme de financement requis pour ce type.' }],
          });
        }
        if (entree.organismeId) await chargerClientLigne(tx, ctx, entree.organismeId);

        const maintenant = this.horloge.maintenant();
        const [ligne] = await tx
          .insert(financementVente)
          .values({
            tenantId: ctx.tenantId,
            dossierVenteId,
            type: entree.type,
            organismeId: entree.organismeId ?? null,
            referenceContrat: entree.referenceContrat ?? null,
            statut: entree.type === 'comptant' ? 'confirme' : 'en_attente',
            confirmeLe: entree.type === 'comptant' ? maintenant : null,
          })
          .returning();
        if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', "La création du financement n'a rendu aucune ligne.");

        const reponse = await this.assembler(tx, ctx, principal.role, ligne);
        return { statutHttp: 201, corps: new CollecteurAvertissements().envelopper(reponse) };
      },
    );
  }

  /** `POST /dossiers-vente/{dossierVenteId}/financements/{id}/confirmer` — `en_attente -> confirme`. */
  async confirmer(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    financementId: string,
    _entree: EntreeActionConfirmerFinancement,
  ): Promise<ReponseAvecAvertissements<ReponseFinancement>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerFinancementPourEcriture(tx, ctx, dossierVenteId, financementId);
      await this.transitionner(tx, ligne, { statut: 'confirme', confirmeLe: this.horloge.maintenant() });
      const misAJour = await chargerFinancementPourEcriture(tx, ctx, dossierVenteId, financementId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  /** `POST /dossiers-vente/{dossierVenteId}/financements/{id}/refuser` — `en_attente -> refuse`,
   *  TERMINAL, motif obligatoire (CV-03). */
  async refuser(
    ctx: ContexteTenant,
    role: RoleUtilisateur,
    dossierVenteId: string,
    financementId: string,
    entree: EntreeActionRefuserFinancement,
  ): Promise<ReponseAvecAvertissements<ReponseFinancement>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerFinancementPourEcriture(tx, ctx, dossierVenteId, financementId);
      await this.transitionner(tx, ligne, { statut: 'refuse', refuseLe: this.horloge.maintenant(), motifRefus: entree.motif });
      const misAJour = await chargerFinancementPourEcriture(tx, ctx, dossierVenteId, financementId);
      const reponse = await this.assembler(tx, ctx, role, misAJour);
      return new CollecteurAvertissements().envelopper(reponse);
    });
  }

  private async assembler(tx: TransactionDfa, ctx: ContexteTenant, role: RoleUtilisateur, ligne: LigneFinancementVente): Promise<ReponseFinancement> {
    const organisme = ligne.organismeId ? await versClientResume(tx, ctx, await chargerClientLigne(tx, ctx, ligne.organismeId)) : null;
    return versFinancementResponse(ligne, organisme, role);
  }

  private async transitionner(
    tx: TransactionDfa,
    ligne: LigneFinancementVente,
    champs: Partial<Omit<LigneFinancementVente, 'id' | 'tenantId'>> & { readonly statut: LigneFinancementVente['statut'] },
  ): Promise<void> {
    try {
      await tx.update(financementVente).set(champs).where(and(eq(financementVente.tenantId, ligne.tenantId), eq(financementVente.id, ligne.id)));
    } catch (erreur) {
      const traduite = traduireErreurTransitionVente(erreur, ligne.id, ligne.id);
      if (traduite) throw traduite;
      throw erreur;
    }
  }
}
