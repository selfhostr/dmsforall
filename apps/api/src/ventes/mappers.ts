import type {
  ActionDossierVente,
  ActionFinancement,
  ActionReprise,
  ActionVehiculeStock,
  ClientResume,
  DocumentRequisDossierVente,
  DocumentVenteResume,
  DossierVenteResume,
  FinancementResume,
  ProvenanceVehiculeStock,
  ReponseDossierVente,
  ReponseFinancement,
  ReponseReprise,
  ReponseVehiculeStock,
  RepriseResume,
  RoleUtilisateur,
  StatutCommercialVehicule,
  StatutConfirmationFinancement,
  StatutDossierVente,
  StatutReprise,
  TypeVehiculeVente,
  VehiculeResume,
  VehiculeStockResume,
} from '@dfa/shared';

import { enDate } from '../db';
import { roleVoitLesMontants } from '../facturation/documents/mappeurs';
import { MATRICE_DROITS, type Action } from '../auth/matrice-droits';
import type {
  LigneDocumentVente,
  LigneDossierVente,
  LigneDossierVenteDocumentRequis,
  LigneFinancementVente,
  LigneReprise,
  LigneVehiculeStock,
} from '../db/schema';
import type { ResumeUtilisateur } from '../atelier/references';

/**
 * FAILLE CORRIGÉE (audit sécurité) : `GET /dossiers-vente/{id}` n'était protégé QUE par
 * `ventes.dossier.lire` et embarquait TOUJOURS la reprise/le financement complets — un rôle qui
 * détient `ventes.dossier.lire` sans `ventes.reprise.lire`/`ventes.financement.lire` (le cas exact
 * de `chef_atelier`, voir `auth/matrice-droits.ts::DROITS_VENTES_PAR_ROLE`) recevait
 * `valeurNegocieeCentimes`/`detteFinancementResiduelleCentimes`/`motifRefus`/
 * `montantFinanceCentimes`/`tauxInteretPourmille` en clair dans le corps JSON — le masquage
 * n'existait QUE côté écran (le front ne les affichait pas), jamais côté serveur.
 *
 * Ces deux fonctions gate l'ENTITÉ reprise/financement ENTIÈRE (id, statut, organisme — pas
 * seulement ses montants), lues directement dans `MATRICE_DROITS` — la SEULE source de vérité de
 * l'autorisation dans ce produit (voir la tête de `auth/matrice-droits.ts`). DISTINCTES de
 * `roleVoitLesMontants` (`facturation/documents/mappeurs.ts`, importé ci-dessous) : ce dernier ne
 * connaît RIEN de `ventes.reprise.lire`/`ventes.financement.lire` — il vaut VRAI pour `chef_atelier`
 * (qui n'est PAS exclu de `ROLES_SANS_MONTANT_FACTURATION`), ce qui est précisément ce qui laissait
 * fuiter le détail monétaire du financement à ce rôle avant cette correction. Les deux gates sont
 * COMPLÉMENTAIRES : `roleVoitFinancement` gouverne si l'entité existe DU TOUT dans la réponse,
 * `roleVoitLesMontants` gouverne, à l'intérieur d'une entité déjà visible, si son détail monétaire
 * l'est aussi (RF-116, `detailMonetaireFinancement` plus bas) — la seconde ne dispense jamais de la
 * première.
 */
export function roleVoitReprise(role: RoleUtilisateur): boolean {
  return (MATRICE_DROITS[role] ?? []).includes('ventes.reprise.lire');
}

export function roleVoitFinancement(role: RoleUtilisateur): boolean {
  return (MATRICE_DROITS[role] ?? []).includes('ventes.financement.lire');
}

const MILLISECONDES_PAR_JOUR = 24 * 60 * 60 * 1000;

/**
 * `joursStock` (RV-07, `contrats/ventes/vehicule-stock.ts::ReponseVehiculeStock.joursStock`) :
 * jours écoulés depuis `dateEntreeStock` jusqu'à `venduLe` (ou `maintenant` si toujours en stock).
 * Calculé à la lecture, jamais stocké — même doctrine que `ecartRepriseVehiculeCentimes` côté
 * reprise. `dateEntreeStock` est une colonne `date` Postgres (pas `timestamptz`) : comparaison au
 * jour calendaire, minuit UTC des deux bords.
 */
export function calculerJoursStock(
  dateEntreeStock: string,
  // `Date | string | null` : le chemin `lister()` (`service-vehicule-stock.ts`) lit `venduLe` par
  // SQL brut (`tx.execute`), où le pilote `pg` rend un `timestamptz` en CHAÎNE, pas en `Date`
  // (piège documenté partout dans le dépôt — cf. `db/acces-amorcage.service.ts::enDate`). Sans
  // cette normalisation, `venduLe.getTime()` levait un `TypeError` -> 500 dès qu'un véhicule était
  // `vendu`/`livre`. Le chemin fiche (`versVehiculeStockResponse`) passe un vrai `Date` (Drizzle
  // `.select()`) : `enDate` est transparent dans ce cas.
  venduLe: Date | string | null,
  maintenant: Date,
): number {
  const debut = new Date(`${dateEntreeStock}T00:00:00.000Z`).getTime();
  const fin = venduLe ? enDate(venduLe).getTime() : maintenant.getTime();
  return Math.max(0, Math.floor((fin - debut) / MILLISECONDES_PAR_JOUR));
}

/**
 * `typeVehicule` (VN/VO) — champ DÉRIVÉ, jamais saisi (`enums.ts::TypeVehiculeVente`, §8.2 de la
 * spécification) : `vn` tant que `provenance = 'neuf_constructeur'` ET que le véhicule n'a jamais
 * été immatriculé (`date1reCirculation` nulle) ; `vo` dans tous les autres cas.
 */
export function calculerTypeVehicule(
  provenance: string,
  date1reCirculation: string | null,
): TypeVehiculeVente {
  return provenance === 'neuf_constructeur' && date1reCirculation === null ? 'vn' : 'vo';
}

/* ------------------------------------------------------------------ */
/* vehicule_stock                                                      */
/* ------------------------------------------------------------------ */

const ACTIONS_DEPUIS_STATUT_VEHICULE_STOCK: Readonly<
  Record<StatutCommercialVehicule, readonly ActionVehiculeStock[]>
> = {
  en_commande: ['mettre_a_jour', 'receptionner'],
  disponible: ['mettre_a_jour'],
  // `remettre_disponible` (RV-10) et `marquer_vendu` (trou comblé, voir enums.ts) : corrections
  // exceptionnelles depuis `reserve`, l'action normale à ce stade étant respectivement
  // `POST /dossiers-vente/{id}/annuler`/`/abandonner` et l'émission de la facture (`facturation/`,
  // effets de bord programmatiques, pas des gestes comptoir).
  reserve: ['mettre_a_jour', 'remettre_disponible', 'marquer_vendu'],
  // Verrouillé après vente (contrat, littéral : « prixAchatCentimes reste modifiable jusqu'à
  // statutCommercial = 'vendu' exclu »).
  vendu: [],
  livre: [],
};

const DROIT_PAR_ACTION_VEHICULE_STOCK: Readonly<Record<ActionVehiculeStock, Action>> = {
  mettre_a_jour: 'ventes.vehicule_stock.modifier',
  receptionner: 'ventes.vehicule_stock.modifier',
  remettre_disponible: 'ventes.vehicule_stock.corriger',
  marquer_vendu: 'ventes.vehicule_stock.corriger',
};

export function calculerActionsDisponiblesVehiculeStock(
  statut: StatutCommercialVehicule,
  role: RoleUtilisateur,
): readonly ActionVehiculeStock[] {
  const droitsDuRole: readonly Action[] = MATRICE_DROITS[role] ?? [];
  return ACTIONS_DEPUIS_STATUT_VEHICULE_STOCK[statut].filter((action) =>
    droitsDuRole.includes(DROIT_PAR_ACTION_VEHICULE_STOCK[action]),
  );
}

export interface EntreeMapperVehiculeStock {
  readonly ligne: LigneVehiculeStock;
  readonly vehicule: VehiculeResume;
  readonly date1reCirculation: string | null;
  readonly role: RoleUtilisateur;
  readonly maintenant: Date;
  readonly modifiePar: ResumeUtilisateur | null;
}

export function versVehiculeStockResponse(e: EntreeMapperVehiculeStock): ReponseVehiculeStock {
  const { ligne } = e;
  return {
    id: ligne.id,
    siteId: ligne.siteId,
    vehicule: e.vehicule,
    provenance: ligne.provenance as ProvenanceVehiculeStock,
    dateEntreeStock: ligne.dateEntreeStock,
    prixAchatCentimes: ligne.prixAchatCentimes,
    // RV-04, [À VALIDER, QV-02] : accroche OR interne -> véhicule en stock non tranchée côté
    // contrat gelé (`vehicule-stock.ts`, littéral : « LECTURE SEULE en attendant »). `0`
    // jusqu'à résolution — jamais une seconde source de vérité en attendant.
    fraisRemiseEtatCumulesCentimes: 0,
    prixVenteAfficheCentimes: ligne.prixVenteAfficheCentimes,
    statutCommercial: ligne.statutCommercial,
    typeVehicule: calculerTypeVehicule(ligne.provenance, e.date1reCirculation),
    vendeurPrecedentAssujetti: ligne.vendeurPrecedentAssujetti,
    origineRepriseDossierVenteId: ligne.origineRepriseDossierVenteId,
    joursStock: calculerJoursStock(ligne.dateEntreeStock, ligne.venduLe, e.maintenant),
    receptionneLe: ligne.receptionneLe ? ligne.receptionneLe.toISOString() : null,
    reserveLe: ligne.reserveLe ? ligne.reserveLe.toISOString() : null,
    venduLe: ligne.venduLe ? ligne.venduLe.toISOString() : null,
    livreLe: ligne.livreLe ? ligne.livreLe.toISOString() : null,
    actionsDisponibles: calculerActionsDisponiblesVehiculeStock(ligne.statutCommercial, e.role),
    version: ligne.version,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
    modifiePar: e.modifiePar,
  };
}

export function versVehiculeStockResume(
  // `venduLe` élargi à `Date | string | null` : ce mapper est alimenté par le chemin `lister()`
  // (SQL brut, `pg` rend le `timestamptz` en CHAÎNE) autant que par les chemins Drizzle (`Date`).
  // La normalisation est faite par `calculerJoursStock` (via `enDate`).
  ligne: Pick<
    LigneVehiculeStock,
    'id' | 'provenance' | 'statutCommercial' | 'prixVenteAfficheCentimes' | 'dateEntreeStock'
  > & { readonly venduLe: Date | string | null },
  vehicule: VehiculeResume,
  date1reCirculation: string | null,
  maintenant: Date,
): VehiculeStockResume {
  return {
    id: ligne.id,
    vehicule,
    provenance: ligne.provenance as ProvenanceVehiculeStock,
    typeVehicule: calculerTypeVehicule(ligne.provenance, date1reCirculation),
    statutCommercial: ligne.statutCommercial,
    prixVenteAfficheCentimes: ligne.prixVenteAfficheCentimes,
    joursStock: calculerJoursStock(ligne.dateEntreeStock, ligne.venduLe, maintenant),
  };
}

/* ------------------------------------------------------------------ */
/* dossier_vente                                                       */
/* ------------------------------------------------------------------ */

const ACTIONS_DEPUIS_STATUT_DOSSIER: Readonly<
  Record<StatutDossierVente, readonly ActionDossierVente[]>
> = {
  prospection: ['modifier', 'engager', 'annuler', 'abandonner'],
  engage: ['modifier', 'preparer', 'annuler', 'abandonner'],
  en_preparation: ['modifier', 'marquer_pret_a_livrer', 'annuler', 'abandonner'],
  // RV-38 : au-delà de `pret_a_livrer`, plus d'annulation/abandon possible (facture au moins en
  // préparation) — voir `migrations/0032_ventes.sql` §9, absence volontaire des transitions
  // `pret_a_livrer -> annule/abandonne`.
  pret_a_livrer: ['modifier', 'livrer'],
  livre: ['cloturer'],
  clos: [],
  annule: [],
  abandonne: [],
};

const DROIT_PAR_ACTION_DOSSIER: Readonly<Record<ActionDossierVente, Action>> = {
  modifier: 'ventes.dossier.modifier',
  engager: 'ventes.dossier.engager',
  preparer: 'ventes.dossier.preparer',
  marquer_pret_a_livrer: 'ventes.dossier.marquer_pret_a_livrer',
  livrer: 'ventes.dossier.livrer',
  cloturer: 'ventes.dossier.cloturer',
  annuler: 'ventes.dossier.annuler',
  abandonner: 'ventes.dossier.abandonner',
};

export function calculerActionsDisponiblesDossierVente(
  statut: StatutDossierVente,
  role: RoleUtilisateur,
): readonly ActionDossierVente[] {
  const droitsDuRole: readonly Action[] = MATRICE_DROITS[role] ?? [];
  return ACTIONS_DEPUIS_STATUT_DOSSIER[statut].filter((action) =>
    droitsDuRole.includes(DROIT_PAR_ACTION_DOSSIER[action]),
  );
}

export function versDocumentRequisResponse(
  ligne: LigneDossierVenteDocumentRequis,
): DocumentRequisDossierVente {
  return {
    code: ligne.code,
    libelle: ligne.libelle,
    fourni: ligne.fourni,
    fourniLe: ligne.fourniLe ? ligne.fourniLe.toISOString() : null,
  };
}

/**
 * `DocumentVenteResume` embarqué (`ReponseDossierVente.documents`) — lecture seule, ce module
 * n'écrit jamais `document_vente`. `roleVoitLesMontants` (RF-116, `facturation/documents/
 * mappeurs.ts`, import en LECTURE) filtre `statutReglement`/`totalTtcCentimes`/`soldeCentimes` —
 * même règle que la facturation applique déjà à `ReponseDocumentVente`, reprise ici pour ne pas
 * exposer un montant à un rôle qui ne le voit nulle part ailleurs dans l'API.
 *
 * `totalTtcCentimesAffiche` est fourni par l'appelant (`totauxTtcAffichesDocumentsDossier`,
 * `references.ts`) — PAS lu directement sur `doc.totalTtcCentimes` (#127, bug corrigé : cette
 * colonne stockée n'est FIGÉE QU'À L'ÉMISSION, `MD-45` — un `brouillon`, tel un bon de commande pas
 * encore transformé en facture, y porte `0`, sa valeur par défaut, jusqu'à l'émission ; ce mapper ne
 * peut pas le savoir seul, faute d'accès aux lignes). `soldeCentimes` reste lu tel quel sur la
 * colonne stockée : `0` par défaut y est une valeur CORRECTE pour un document pas encore émis (rien
 * n'est dû sur un brouillon), à la différence de `totalTtcCentimes`.
 */
export function versDocumentVenteResume(
  doc: LigneDocumentVente,
  role: RoleUtilisateur,
  totalTtcCentimesAffiche: number,
): DocumentVenteResume {
  const voitMontants = roleVoitLesMontants(role);
  return {
    id: doc.id,
    typeDocument: doc.typeDocument,
    natureFacture: doc.typeDocument === 'facture' ? doc.natureFacture : null,
    numero: doc.numero,
    statut: doc.statut,
    ...(voitMontants ? { statutReglement: doc.statutReglement } : {}),
    clientId: doc.clientId,
    clientDesignation: doc.clientDesignationFigee,
    dateDocument: doc.dateDocument ?? '',
    devise: doc.devise,
    ...(voitMontants
      ? {
          totalTtcCentimes: totalTtcCentimesAffiche,
          soldeCentimes: Number(doc.soldeCentimes),
        }
      : {}),
  };
}

export interface EntreeMapperDossierVente {
  readonly ligne: LigneDossierVente;
  readonly vehicule: VehiculeStockResume | null;
  readonly typeVehicule: TypeVehiculeVente | null;
  readonly clientAcheteur: ClientResume;
  readonly clientFacture: ClientResume;
  readonly clientConducteur: ClientResume | null;
  /** `undefined` = le rôle appelant n'a pas `ventes.reprise.lire`, voir `roleVoitReprise` plus bas
   *  et la doctrine d'omission sur `@dfa/shared::ReponseDossierVente.reprise` (FAILLE CORRIGÉE). */
  readonly reprise: RepriseResume | null | undefined;
  /** `undefined` = le rôle appelant n'a pas `ventes.financement.lire`, voir `roleVoitFinancement`
   *  plus bas. Même doctrine que `reprise` ci-dessus pour `financement`/`financements`/
   *  `financementsTronques`. */
  readonly financement: FinancementResume | null | undefined;
  readonly financements: readonly FinancementResume[] | undefined;
  readonly financementsTronques: boolean | undefined;
  readonly documents: readonly DocumentVenteResume[];
  readonly documentsTronques: boolean;
  readonly documentsRequis: readonly DocumentRequisDossierVente[];
  readonly role: RoleUtilisateur;
  readonly modifiePar: ResumeUtilisateur | null;
}

export function versDossierVenteResponse(e: EntreeMapperDossierVente): ReponseDossierVente {
  const { ligne } = e;
  return {
    id: ligne.id,
    siteId: ligne.siteId,
    statut: ligne.statut,
    typeVehicule: e.typeVehicule,
    vehicule: e.vehicule,
    clientAcheteur: e.clientAcheteur,
    clientFacture: e.clientFacture,
    clientConducteur: e.clientConducteur,
    // FAILLE CORRIGÉE (audit sécurité) : `reprise`/`financement`/`financements`/
    // `financementsTronques` étaient TOUJOURS présents, quel que soit le rôle appelant —
    // `ServiceDossierVente.assembler` (`service-dossier-vente.ts`) ne les fournit désormais QUE si
    // le rôle détient respectivement `ventes.reprise.lire`/`ventes.financement.lire`
    // (`roleVoitReprise`/`roleVoitFinancement` ci-dessous). `undefined` ici => clé OMISE de la
    // charge utile (spread conditionnel, jamais une valeur `undefined` assignée en dur) — jamais
    // confondue avec `null` (fait métier « rien ici », pas un masquage).
    ...(e.reprise !== undefined ? { reprise: e.reprise } : {}),
    ...(e.financement !== undefined ? { financement: e.financement } : {}),
    ...(e.financements !== undefined ? { financements: e.financements } : {}),
    ...(e.financementsTronques !== undefined
      ? { financementsTronques: e.financementsTronques }
      : {}),
    documents: e.documents,
    documentsTronques: e.documentsTronques,
    documentsRequis: e.documentsRequis,
    identitePieceType: ligne.identitePieceType,
    identiteVerifieeLe: ligne.identiteVerifieeLe ? ligne.identiteVerifieeLe.toISOString() : null,
    dateLivraisonEstimee: ligne.dateLivraisonEstimee,
    dateLivraisonEffective: ligne.dateLivraisonEffective,
    // RV-55 : renseigné uniquement par l'action `livrer`, via le mécanisme kilométrage véhicule
    // (schema/atelier/vehicule.ts) — pas une colonne locale, voir la tête de `schema/ventes/
    // dossier-vente.ts`. `null` tant que non livré : ce module ne duplique pas le relevé.
    kilometrageDepart: null,
    prospectionLe: ligne.creeLe.toISOString(),
    engageLe: ligne.engageLe ? ligne.engageLe.toISOString() : null,
    enPreparationLe: ligne.enPreparationLe ? ligne.enPreparationLe.toISOString() : null,
    pretALivrerLe: ligne.pretALivrerLe ? ligne.pretALivrerLe.toISOString() : null,
    livreLe: ligne.livreLe ? ligne.livreLe.toISOString() : null,
    closLe: ligne.closLe ? ligne.closLe.toISOString() : null,
    annuleLe: ligne.annuleLe ? ligne.annuleLe.toISOString() : null,
    abandonneLe: ligne.abandonneLe ? ligne.abandonneLe.toISOString() : null,
    motifCloture: ligne.motifCloture,
    actionsDisponibles: calculerActionsDisponiblesDossierVente(ligne.statut, e.role),
    version: ligne.version,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
    modifiePar: e.modifiePar,
  };
}

export function versDossierVenteResume(
  ligne: LigneDossierVente,
  vehicule: VehiculeStockResume | null,
  typeVehicule: TypeVehiculeVente | null,
  clientAcheteur: ClientResume,
): DossierVenteResume {
  return {
    id: ligne.id,
    statut: ligne.statut,
    typeVehicule,
    vehicule,
    clientAcheteur,
    dateLivraisonEstimee: ligne.dateLivraisonEstimee,
    prospectionLe: ligne.creeLe.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* reprise                                                              */
/* ------------------------------------------------------------------ */

const ACTIONS_DEPUIS_STATUT_REPRISE: Readonly<Record<StatutReprise, readonly ActionReprise[]>> = {
  estimee: ['modifier', 'negocier', 'refuser'],
  // RV-27 : renégociable plusieurs fois tant que non confirmée/refusée.
  negociee: ['modifier', 'negocier', 'confirmer', 'refuser'],
  confirmee: [],
  refusee: [],
};

const DROIT_PAR_ACTION_REPRISE: Readonly<Record<ActionReprise, Action>> = {
  modifier: 'ventes.reprise.modifier',
  negocier: 'ventes.reprise.negocier',
  confirmer: 'ventes.reprise.confirmer',
  refuser: 'ventes.reprise.refuser',
};

export function calculerActionsDisponiblesReprise(
  statut: StatutReprise,
  role: RoleUtilisateur,
): readonly ActionReprise[] {
  const droitsDuRole: readonly Action[] = MATRICE_DROITS[role] ?? [];
  return ACTIONS_DEPUIS_STATUT_REPRISE[statut].filter((action) =>
    droitsDuRole.includes(DROIT_PAR_ACTION_REPRISE[action]),
  );
}

/** `ecartRepriseVehiculeCentimes` (RV-21) : DÉRIVÉ, `valeurNegocieeCentimes - valeurEstimeeCentimes`,
 *  `null` tant que `valeurNegocieeCentimes` est `null`. Peut être positif (reprise gonflée, RV-20)
 *  ou négatif — aucune base TVA calculée ici (RV-22/QV-05, non tranché, voir contrat gelé). */
export function calculerEcartRepriseVehicule(
  valeurEstimeeCentimes: number,
  valeurNegocieeCentimes: number | null,
): number | null {
  return valeurNegocieeCentimes === null ? null : valeurNegocieeCentimes - valeurEstimeeCentimes;
}

export interface EntreeMapperReprise {
  readonly ligne: LigneReprise;
  readonly vehiculeRepris: VehiculeResume;
  readonly detteFinancementOrganisme: ClientResume | null;
  readonly role: RoleUtilisateur;
  readonly modifiePar: ResumeUtilisateur | null;
}

export function versRepriseResponse(e: EntreeMapperReprise): ReponseReprise {
  const { ligne } = e;
  return {
    id: ligne.id,
    dossierVenteId: ligne.dossierVenteId,
    vehiculeRepris: e.vehiculeRepris,
    statut: ligne.statut,
    valeurEstimeeCentimes: ligne.valeurEstimeeCentimes,
    valeurNegocieeCentimes: ligne.valeurNegocieeCentimes,
    ecartRepriseVehiculeCentimes: calculerEcartRepriseVehicule(
      ligne.valeurEstimeeCentimes,
      ligne.valeurNegocieeCentimes,
    ),
    detteFinancementResiduelleCentimes: ligne.detteFinancementResiduelleCentimes,
    detteFinancementOrganismeId: ligne.detteFinancementOrganismeId,
    detteFinancementOrganismeNom: ligne.detteFinancementOrganismeNom,
    estimeeLe: ligne.estimeeLe.toISOString(),
    negocieeLe: ligne.negocieeLe ? ligne.negocieeLe.toISOString() : null,
    confirmeeLe: ligne.confirmeeLe ? ligne.confirmeeLe.toISOString() : null,
    refuseeLe: ligne.refuseeLe ? ligne.refuseeLe.toISOString() : null,
    motifRefus: ligne.motifRefus,
    actionsDisponibles: calculerActionsDisponiblesReprise(ligne.statut, e.role),
    version: ligne.version,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
    modifiePar: e.modifiePar,
  };
}

export function versRepriseResume(
  ligne: LigneReprise,
  vehiculeRepris: VehiculeResume,
): RepriseResume {
  return {
    id: ligne.id,
    vehiculeRepris,
    statut: ligne.statut,
    valeurEstimeeCentimes: ligne.valeurEstimeeCentimes,
    valeurNegocieeCentimes: ligne.valeurNegocieeCentimes,
    ecartRepriseVehiculeCentimes: calculerEcartRepriseVehicule(
      ligne.valeurEstimeeCentimes,
      ligne.valeurNegocieeCentimes,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* financement_vente                                                   */
/* ------------------------------------------------------------------ */

const ACTIONS_DEPUIS_STATUT_FINANCEMENT: Readonly<
  Record<StatutConfirmationFinancement, readonly ActionFinancement[]>
> = {
  en_attente: ['confirmer', 'refuser'],
  // CV-03 : `refuse` est TERMINAL, un nouveau mode de financement est une NOUVELLE ligne.
  confirme: [],
  refuse: [],
};

const DROIT_PAR_ACTION_FINANCEMENT: Readonly<Record<ActionFinancement, Action>> = {
  confirmer: 'ventes.financement.confirmer',
  refuser: 'ventes.financement.refuser',
};

export function calculerActionsDisponiblesFinancement(
  statut: StatutConfirmationFinancement,
  role: RoleUtilisateur,
): readonly ActionFinancement[] {
  const droitsDuRole: readonly Action[] = MATRICE_DROITS[role] ?? [];
  return ACTIONS_DEPUIS_STATUT_FINANCEMENT[statut].filter((action) =>
    droitsDuRole.includes(DROIT_PAR_ACTION_FINANCEMENT[action]),
  );
}

/** Détail monétaire (0042) — omis (pas `null`) si `!roleVoitLesMontants(role)`, même doctrine que
 *  `versDocumentVenteResume` (RF-116, `facturation/documents/mappeurs.ts`). Factorisé pour ne pas
 *  dupliquer le spread conditionnel entre `versFinancementResponse` et `versFinancementResume`. */
function detailMonetaireFinancement(
  ligne: LigneFinancementVente,
  role: RoleUtilisateur,
): Pick<
  ReponseFinancement,
  | 'montantFinanceCentimes'
  | 'acompteCentimes'
  | 'mensualiteCentimes'
  | 'tauxInteretPourmille'
  | 'dureeMois'
> {
  if (!roleVoitLesMontants(role)) return {};
  return {
    montantFinanceCentimes: ligne.montantFinanceCentimes,
    acompteCentimes: ligne.acompteCentimes,
    mensualiteCentimes: ligne.mensualiteCentimes,
    tauxInteretPourmille: ligne.tauxInteretPourmille,
    dureeMois: ligne.dureeMois,
  };
}

export function versFinancementResponse(
  ligne: LigneFinancementVente,
  organisme: ClientResume | null,
  role: RoleUtilisateur,
): ReponseFinancement {
  return {
    id: ligne.id,
    dossierVenteId: ligne.dossierVenteId,
    type: ligne.type,
    organisme,
    referenceContrat: ligne.referenceContrat,
    statutConfirmation: ligne.statut,
    confirmeLe: ligne.confirmeLe ? ligne.confirmeLe.toISOString() : null,
    refuseLe: ligne.refuseLe ? ligne.refuseLe.toISOString() : null,
    motifRefus: ligne.motifRefus,
    ...detailMonetaireFinancement(ligne, role),
    actionsDisponibles: calculerActionsDisponiblesFinancement(ligne.statut, role),
    version: ligne.version,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

export function versFinancementResume(
  ligne: LigneFinancementVente,
  organisme: ClientResume | null,
  role: RoleUtilisateur,
): FinancementResume {
  return {
    id: ligne.id,
    type: ligne.type,
    organisme: organisme ? { id: organisme.id, nomAffiche: organisme.nomAffiche } : null,
    statutConfirmation: ligne.statut,
    ...detailMonetaireFinancement(ligne, role),
  };
}

/** Le « financement courant » (`FinancementResume` embarqué dans `ReponseDossierVente.financement`) :
 *  le plus récent dont `statut != 'refuse'`, ou le plus récent tout court si tous sont refusés —
 *  notion PUREMENT DE LECTURE, dérivée par tri (`listerFinancementsDossier`, `creeLe desc`), jamais
 *  un drapeau stocké (voir la doctrine de `schema/ventes/financement.ts`). */
export function selectionnerFinancementCourant(
  financements: readonly LigneFinancementVente[],
): LigneFinancementVente | null {
  return financements.find((f) => f.statut !== 'refuse') ?? financements[0] ?? null;
}
