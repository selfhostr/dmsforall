import { schemaCreationClient, type Langue, type TypeOrdreReparation } from '@dfa/shared';

import { telephoneValide, type EntreeVehiculeRapide } from '@/hooks/atelier/ordre-depuis-plaque';
import type { PlanOrdreDepuisPlaque } from '@/hooks/atelier/useOrdreDepuisPlaque';

import type { CandidatVehicule } from './candidats';
import type { ClientChoisi } from './SectionClientRapide';

export const KILOMETRAGE_MAX = 9_999_999;

export interface SaisieOrdreDepuisPlaque {
  readonly siteId: string;
  readonly plaque: string;
  readonly vehicule: CandidatVehicule | null;
  readonly vehiculeNouveau: boolean;
  readonly marque: string;
  readonly modele: string;
  readonly client: ClientChoisi | null;
  readonly clientNouveau: boolean;
  readonly nom: string;
  readonly telephone: string;
  readonly langue: Langue;
  readonly type: TypeOrdreReparation;
  readonly demande: string;
  readonly kilometrage: number | null;
  readonly restitution: string;
  readonly numeroCommande: string;
}

export interface ContrainteOrdreDepuisPlaque {
  readonly kilometrageObligatoire: boolean;
  readonly poObligatoire: boolean;
}

/** Codes, jamais des phrases : l'écran traduit (`validation:requis`, etc.). */
export type ErreurSaisie = 'requis' | 'invalide';

export interface ErreursSaisie {
  site?: ErreurSaisie;
  vehicule?: ErreurSaisie;
  marque?: ErreurSaisie;
  modele?: ErreurSaisie;
  client?: ErreurSaisie;
  nom?: ErreurSaisie;
  telephone?: ErreurSaisie;
  kilometrage?: ErreurSaisie;
  numeroCommande?: ErreurSaisie;
}

export type ResultatPlan =
  | { readonly ok: true; readonly plan: PlanOrdreDepuisPlaque }
  | { readonly ok: false; readonly erreurs: ErreursSaisie };

const vide = (texte: string) => texte.trim() === '';

/**
 * Transforme la saisie d'UN écran en plan de création (client, véhicule, OR) ou en erreurs champ
 * par champ. Ne rend obligatoire que le minimum du contrat : véhicule existant OU marque+modèle,
 * client existant OU nom+téléphone ; le kilométrage et le bon de commande seulement si le garage ou
 * le client l'exigent.
 */
export function construirePlan(
  saisie: SaisieOrdreDepuisPlaque,
  contrainte: ContrainteOrdreDepuisPlaque,
): ResultatPlan {
  const erreurs: ErreursSaisie = {};
  if (vide(saisie.siteId)) erreurs.site = 'requis';

  let plan: Pick<PlanOrdreDepuisPlaque, 'vehicule' | 'client'> | null = null;
  let vehicule: PlanOrdreDepuisPlaque['vehicule'] | null = null;
  let client: PlanOrdreDepuisPlaque['client'] | null = null;

  if (saisie.vehicule) {
    vehicule = { mode: 'existant', id: saisie.vehicule.id };
  } else if (saisie.vehiculeNouveau) {
    if (vide(saisie.marque)) erreurs.marque = 'requis';
    if (vide(saisie.modele)) erreurs.modele = 'requis';
    if (!erreurs.marque && !erreurs.modele) {
      const entree: EntreeVehiculeRapide = {
        marque: saisie.marque.trim(),
        modele: saisie.modele.trim(),
        plaque: vide(saisie.plaque) ? undefined : saisie.plaque.trim(),
        importe: false,
      };
      vehicule = { mode: 'nouveau', entree };
    }
  } else {
    erreurs.vehicule = 'requis';
  }

  if (saisie.client) {
    client = { mode: 'existant', id: saisie.client.id };
  } else if (saisie.clientNouveau) {
    if (vide(saisie.nom)) erreurs.nom = 'requis';
    if (!telephoneValide(saisie.telephone)) {
      erreurs.telephone = vide(saisie.telephone) ? 'requis' : 'invalide';
    }
    if (!erreurs.nom && !erreurs.telephone) {
      const analyse = schemaCreationClient.safeParse({
        type: 'particulier',
        nom: saisie.nom.trim(),
        langueCorrespondance: saisie.langue,
        telephones: [{ valeur: saisie.telephone.trim(), principal: true }],
      });
      if (analyse.success) client = { mode: 'nouveau', entree: analyse.data };
      else erreurs.nom = 'invalide';
    }
  } else {
    erreurs.client = 'requis';
  }

  if (contrainte.kilometrageObligatoire && saisie.kilometrage === null) {
    erreurs.kilometrage = 'requis';
  } else if (
    saisie.kilometrage !== null &&
    (saisie.kilometrage < 0 || saisie.kilometrage > KILOMETRAGE_MAX)
  ) {
    erreurs.kilometrage = 'invalide';
  }
  if (contrainte.poObligatoire && vide(saisie.numeroCommande)) erreurs.numeroCommande = 'requis';

  if (Object.keys(erreurs).length > 0 || vehicule === null || client === null) {
    return { ok: false, erreurs };
  }
  plan = { vehicule, client };

  const demande = saisie.demande.trim();
  return {
    ok: true,
    plan: {
      ...plan,
      ordre: {
        siteId: saisie.siteId,
        type: saisie.type,
        statutInitial: 'ouvert',
        kilometrageEntree: saisie.kilometrage,
        uniteKilometrage: 'km',
        demandes: demande === '' ? [] : [{ verbatim: demande }],
        restitutionPromiseLe: vide(saisie.restitution) ? undefined : saisie.restitution,
        numeroCommandeInterne: vide(saisie.numeroCommande)
          ? undefined
          : saisie.numeroCommande.trim(),
      },
    },
  };
}
