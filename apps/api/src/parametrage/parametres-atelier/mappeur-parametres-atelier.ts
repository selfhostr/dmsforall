// Import de VALEUR (pas `import type`) : `typeof schema.parametreAtelier.$inferInsert` a besoin
// que `schema` résolve un espace de noms réel, pas seulement des types réexportés.
import { schema } from '../../db';
import type { EntreeModificationParametresAtelierEtendue } from './schema-modification-parametres-atelier-etendu';

/**
 * Projection publique de `parametre_atelier` (contrats-api-etape-1.md §8.2). Structure IDENTIQUE
 * à `ReponseParametresAtelier` (`@dfa/shared`), à UNE exception documentée :
 *
 * ÉCART DE CONTRAT SIGNALÉ — `reception.plafondDefautCentimes` : le type gelé le déclare
 * `number` (jamais `null`), mais la colonne `parametre_atelier.plafond_defaut_centimes` porte une
 * troisième valeur métier délibérée (Q-02 du plan d'exécution) : `NULL` = « aucun plafond
 * convenu, la garde RM-54 ne s'exécute jamais » — distincte de `0` = « accord requis pour TOUTE
 * validation payante ». Restituer `0` à la place de `NULL` changerait silencieusement le sens
 * métier pour tout tenant sans plafond configuré (le pire des deux mensonges possibles ici). Ce
 * DTO expose donc `number | null` ; `ReponseParametresAtelier` (`packages/shared`) doit être
 * élargi au même type — signalé dans la réponse de tâche L1-07, à corriger par l'équipe API/
 * l'équipe backend, PAS par ce module (le shared est gelé, hors de mon périmètre d'écriture).
 *
 * DEUXIÈME ÉCART, MÊME NATURE — `reception.plafondAvoirReceptionnaireCentimes` (`RF-117`, 0018) :
 * champ ABSENT de `ReponseParametresAtelier`/`schemaModificationParametresAtelier` gelés, exposé
 * ici localement (lecture ET écriture, voir `schema-modification-parametres-atelier-etendu.ts`
 * pour le schéma zod étendu côté entrée). Signalé dans la réponse de tâche RF-117.
 */
export interface DtoParametresAtelier {
  readonly or: {
    readonly prefixe: string;
    readonly porteeNumerotation: schema.LigneParametreAtelier['orPorteeNumerotation'];
    readonly resetAnnuel: boolean;
    readonly etatPlanifieActif: boolean;
    readonly sansRdvAutorise: boolean;
    readonly rdvRetroactifAuto: boolean;
    readonly deuxOrMemeVehicule: schema.LigneParametreAtelier['deuxOrMemeVehicule'];
  };
  readonly reception: {
    readonly kmEntreeObligatoire: boolean;
    readonly kmSortieObligatoire: boolean;
    readonly signature: schema.LigneParametreAtelier['signatureReception'];
    readonly plafondDefautCentimes: number | null;
    /**
     * `RF-117` (0018) : plafond d'émission d'avoir par un `receptionnaire` seul, MÊME sémantique
     * que `plafondDefautCentimes` juste au-dessus (`null` = aucun plafond convenu, dégradé
     * documenté préservé — `0` = toute émission doit escalader, n>0 = plafond nominal). Champ
     * ABSENT du contrat gelé `ReponseParametresAtelier` (`packages/shared`) — voir l'écart signalé
     * en tête de ce fichier et dans `schema-modification-parametres-atelier-etendu.ts`.
     */
    readonly plafondAvoirReceptionnaireCentimes: number | null;
  };
  readonly travaux: {
    readonly uniteTemps: schema.LigneParametreAtelier['uniteTemps'];
    readonly arrondiPointage: schema.LigneParametreAtelier['arrondiPointage'];
    readonly chevauchementPointageAutorise: boolean;
    readonly pointageObligatoirePourTerminer: boolean;
    readonly controleQualite: schema.LigneParametreAtelier['controleQualite'];
    readonly dureeMaxPointageHeures: number;
  };
  readonly facturation: {
    readonly multiPayeursAutorise: boolean;
    readonly restitutionAvantPaiement: boolean;
    /** Aucune colonne dédiée en base — domaine inerte au lot 1 (`fonctionnalites.facturation`
     *  false), valeur par défaut posée en attendant le schéma de l'étape 2. Voir
     *  `gouvernance-fonctionnalites.ts`. */
    readonly piecesClientAutorisees: boolean;
    readonly politiqueDemontageRefuse: schema.LigneParametreAtelier['politiqueDemontageRefuse'];
    /** Idem : aucune colonne dédiée en base. */
    readonly seuilDemontageCentimes: number | null;
    readonly produitsAtelier: {
      readonly mode: string;
      readonly pourmille: number | null;
      readonly plafondCentimes: number | null;
    };
  };
  readonly documents: {
    readonly langue: schema.LigneParametreAtelier['langueDocuments'];
    readonly mentionSecurite: schema.LigneParametreAtelier['mentionSecurite'];
  };
  readonly vehicule: {
    readonly expertiseAlerteMois: number;
    readonly visibiliteHistoriqueNouveauDetenteur: schema.LigneParametreAtelier['visibiliteHistoriqueNouveauDetenteur'];
  };
  readonly planning: {
    readonly noShowSeuilAlerte: number;
    readonly tamponPretMinutes: number;
    /** Aucune colonne en base (`rappel.canal`/`joursAvant`) — domaine `planning` inerte au lot 1 ;
     *  valeur par défaut de contrats-api-etape-1.md §8.2, posée en attendant le schéma RDV. */
    readonly rappel: { readonly canal: 'sms' | 'email'; readonly joursAvant: number };
  };
  readonly fonctionnalites: {
    readonly facturation: boolean;
    readonly stockPieces: boolean;
    readonly depotPneus: boolean;
    readonly prets: boolean;
  };
  /** `modifieLe.getTime()` — voir la justification dans `service-parametres-atelier.ts`. */
  readonly version: number;
}

const PRODUITS_ATELIER_DEFAUT = {
  mode: 'desactive',
  pourmille: null,
  plafondCentimes: null,
} as const;
const RAPPEL_DEFAUT = { canal: 'sms', joursAvant: 1 } as const;

/** `fonctionnalites` — calculé, jamais stocké (Δ3, `db/migrations/0005_parametrage.sql`). Fixe au
 *  lot 1 : aucune des quatre fonctionnalités gelées dans `ReponseParametresAtelier` n'existe encore. */
export const FONCTIONNALITES_REPONSE_LOT1 = {
  facturation: false,
  stockPieces: false,
  depotPneus: false,
  prets: false,
} as const;

export function versDtoParametresAtelier(
  ligne: schema.LigneParametreAtelier,
): DtoParametresAtelier {
  const produitsAtelier = (ligne.produitsAtelier ?? {}) as Partial<typeof PRODUITS_ATELIER_DEFAUT>;

  return {
    or: {
      // `orPrefixe` est nullable en base (aucune valeur imposée par défaut) ; chaîne vide pour
      // rester conforme au type `string` non nullable du contrat gelé.
      prefixe: ligne.orPrefixe ?? '',
      porteeNumerotation: ligne.orPorteeNumerotation,
      resetAnnuel: ligne.orResetAnnuel,
      etatPlanifieActif: ligne.etatPlanifieActif,
      sansRdvAutorise: ligne.orSansRdvAutorise,
      rdvRetroactifAuto: ligne.rdvRetroactifAuto,
      deuxOrMemeVehicule: ligne.deuxOrMemeVehicule,
    },
    reception: {
      kmEntreeObligatoire: ligne.kmEntreeObligatoire,
      kmSortieObligatoire: ligne.kmSortieObligatoire,
      signature: ligne.signatureReception,
      plafondDefautCentimes: ligne.plafondDefautCentimes,
      plafondAvoirReceptionnaireCentimes: ligne.plafondAvoirReceptionnaireCentimes,
    },
    travaux: {
      uniteTemps: ligne.uniteTemps,
      arrondiPointage: ligne.arrondiPointage,
      chevauchementPointageAutorise: ligne.chevauchementPointageAutorise,
      pointageObligatoirePourTerminer: ligne.pointageObligatoirePourTerminer,
      controleQualite: ligne.controleQualite,
      dureeMaxPointageHeures: ligne.pointageDureeMaxHeures,
    },
    facturation: {
      multiPayeursAutorise: ligne.multiPayeursAutorise,
      restitutionAvantPaiement: ligne.restitutionAvantPaiement,
      piecesClientAutorisees: false,
      politiqueDemontageRefuse: ligne.politiqueDemontageRefuse,
      seuilDemontageCentimes: null,
      produitsAtelier: {
        mode: produitsAtelier.mode ?? PRODUITS_ATELIER_DEFAUT.mode,
        pourmille: produitsAtelier.pourmille ?? PRODUITS_ATELIER_DEFAUT.pourmille,
        plafondCentimes: produitsAtelier.plafondCentimes ?? PRODUITS_ATELIER_DEFAUT.plafondCentimes,
      },
    },
    documents: {
      langue: ligne.langueDocuments,
      mentionSecurite: ligne.mentionSecurite,
    },
    vehicule: {
      expertiseAlerteMois: ligne.expertiseAlerteMois,
      visibiliteHistoriqueNouveauDetenteur: ligne.visibiliteHistoriqueNouveauDetenteur,
    },
    planning: {
      noShowSeuilAlerte: ligne.noShowSeuilAlerte,
      tamponPretMinutes: ligne.tamponPretMinutes,
      rappel: RAPPEL_DEFAUT,
    },
    fonctionnalites: FONCTIONNALITES_REPONSE_LOT1,
    version: ligne.modifieLe.getTime(),
  };
}

/**
 * Traduit le corps `PATCH` (déjà vérifié actif par `verifierChampsActifsParametresAtelier`, déjà
 * validé par le schéma zod gelé) en colonnes à écrire. Seuls les domaines/champs RÉELLEMENT
 * backés par une colonne sont traduits — `facturation.piecesClientAutorisees` et
 * `facturation.seuilDemontageCentimes` n'apparaissent jamais ici : ils sont de toute façon bloqués
 * en amont par la gouvernance (domaine `facturation` inerte), donc cette fonction ne les
 * atteint jamais en pratique, mais ne prétend pas non plus savoir où les écrire.
 */
export function versColonnesMiseAJour(
  entree: EntreeModificationParametresAtelierEtendue,
): Partial<typeof schema.parametreAtelier.$inferInsert> {
  const colonnes: Partial<typeof schema.parametreAtelier.$inferInsert> = {};

  if (entree.or) {
    if (entree.or.prefixe !== undefined) colonnes.orPrefixe = entree.or.prefixe;
    if (entree.or.porteeNumerotation !== undefined)
      colonnes.orPorteeNumerotation = entree.or.porteeNumerotation;
    if (entree.or.resetAnnuel !== undefined) colonnes.orResetAnnuel = entree.or.resetAnnuel;
    if (entree.or.etatPlanifieActif !== undefined)
      colonnes.etatPlanifieActif = entree.or.etatPlanifieActif;
    if (entree.or.sansRdvAutorise !== undefined)
      colonnes.orSansRdvAutorise = entree.or.sansRdvAutorise;
    if (entree.or.rdvRetroactifAuto !== undefined)
      colonnes.rdvRetroactifAuto = entree.or.rdvRetroactifAuto;
    if (entree.or.deuxOrMemeVehicule !== undefined)
      colonnes.deuxOrMemeVehicule = entree.or.deuxOrMemeVehicule;
  }
  if (entree.reception) {
    if (entree.reception.kmEntreeObligatoire !== undefined)
      colonnes.kmEntreeObligatoire = entree.reception.kmEntreeObligatoire;
    if (entree.reception.kmSortieObligatoire !== undefined)
      colonnes.kmSortieObligatoire = entree.reception.kmSortieObligatoire;
    if (entree.reception.signature !== undefined)
      colonnes.signatureReception = entree.reception.signature;
    if (entree.reception.plafondDefautCentimes !== undefined) {
      colonnes.plafondDefautCentimes = entree.reception.plafondDefautCentimes;
    }
    // `!== undefined` (pas de vérité négative sur `null`) : `null` est la valeur qui remet le
    // plafond à « aucun plafond convenu » (RF-117, même sémantique que `plafondDefautCentimes`
    // juste au-dessus) — l'omettre du corps laisse la colonne inchangée, l'envoyer explicitement
    // à `null` doit pouvoir l'effacer.
    if (entree.reception.plafondAvoirReceptionnaireCentimes !== undefined) {
      colonnes.plafondAvoirReceptionnaireCentimes =
        entree.reception.plafondAvoirReceptionnaireCentimes;
    }
  }
  if (entree.travaux) {
    if (entree.travaux.uniteTemps !== undefined) colonnes.uniteTemps = entree.travaux.uniteTemps;
    if (entree.travaux.arrondiPointage !== undefined)
      colonnes.arrondiPointage = entree.travaux.arrondiPointage;
    if (entree.travaux.chevauchementPointageAutorise !== undefined) {
      colonnes.chevauchementPointageAutorise = entree.travaux.chevauchementPointageAutorise;
    }
    if (entree.travaux.pointageObligatoirePourTerminer !== undefined) {
      colonnes.pointageObligatoirePourTerminer = entree.travaux.pointageObligatoirePourTerminer;
    }
    if (entree.travaux.controleQualite !== undefined)
      colonnes.controleQualite = entree.travaux.controleQualite;
    if (entree.travaux.dureeMaxPointageHeures !== undefined) {
      colonnes.pointageDureeMaxHeures = entree.travaux.dureeMaxPointageHeures;
    }
  }
  if (entree.facturation) {
    if (entree.facturation.multiPayeursAutorise !== undefined) {
      colonnes.multiPayeursAutorise = entree.facturation.multiPayeursAutorise;
    }
    if (entree.facturation.restitutionAvantPaiement !== undefined) {
      colonnes.restitutionAvantPaiement = entree.facturation.restitutionAvantPaiement;
    }
    if (entree.facturation.politiqueDemontageRefuse !== undefined) {
      colonnes.politiqueDemontageRefuse = entree.facturation.politiqueDemontageRefuse;
    }
    if (entree.facturation.produitsAtelier !== undefined) {
      colonnes.produitsAtelier = entree.facturation.produitsAtelier;
    }
    // `piecesClientAutorisees` / `seuilDemontageCentimes` : pas de colonne, voir le commentaire
    // de fonction — jamais atteints ici en pratique (domaine inerte, bloqué en amont).
  }
  if (entree.documents) {
    if (entree.documents.langue !== undefined) colonnes.langueDocuments = entree.documents.langue;
    if (entree.documents.mentionSecurite !== undefined)
      colonnes.mentionSecurite = entree.documents.mentionSecurite;
  }
  if (entree.vehicule) {
    if (entree.vehicule.expertiseAlerteMois !== undefined)
      colonnes.expertiseAlerteMois = entree.vehicule.expertiseAlerteMois;
    if (entree.vehicule.visibiliteHistoriqueNouveauDetenteur !== undefined) {
      colonnes.visibiliteHistoriqueNouveauDetenteur =
        entree.vehicule.visibiliteHistoriqueNouveauDetenteur;
    }
  }
  if (entree.planning) {
    if (entree.planning.noShowSeuilAlerte !== undefined)
      colonnes.noShowSeuilAlerte = entree.planning.noShowSeuilAlerte;
    if (entree.planning.tamponPretMinutes !== undefined)
      colonnes.tamponPretMinutes = entree.planning.tamponPretMinutes;
    // `rappel` : pas de colonne, voir le commentaire de `DtoParametresAtelier.planning.rappel`.
  }

  return colonnes;
}
