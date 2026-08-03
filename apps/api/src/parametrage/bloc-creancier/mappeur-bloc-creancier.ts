import { schema } from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import { ErreurQrFacture } from '../../facturation/qr/erreurs-qr';
import { estQrIban, validerIbanCreancier } from '../../facturation/qr/iban';
import type { EntreeModificationBlocCreancier } from './schema-bloc-creancier';

/**
 * DTO de `GET|PATCH /parametres-facturation/creancier`. Toutes les colonnes métier sont
 * nullables en base (`db/schema/facturation/tenant-bloc-creancier.ts`) : ce DTO les reflète
 * telles quelles, `pays` excepté (colonne `not null default 'CH'`).
 */
export interface DtoBlocCreancier {
  readonly nom: string | null;
  readonly rue: string | null;
  readonly numero: string | null;
  readonly npa: string | null;
  readonly localite: string | null;
  readonly pays: string;
  readonly iban: string | null;
  readonly qrIban: string | null;
  readonly version: number;
}

/**
 * Ligne absente = paramétrage vide, jamais un 404 (consigne explicite de la tâche : ce singleton
 * se comporte comme `parametres-atelier`/`parametres-site` pour la FORME de la réponse, mais PAS
 * pour ce point précis — `parametres-atelier` lève `RESSOURCE_INTROUVABLE` en l'absence de ligne
 * parce qu'une ligne y est créée à la création du tenant ; ici, `tenant_bloc_creancier` est vide
 * pour TOUS les tenants après la migration 0014, et rien ne la peuple avant ce module).
 *
 * `version: 0` en l'absence de ligne — jamais atteignable par un `modifie_le` réel
 * (`timestamptz`, epoch ms toujours strictement positif en pratique sur ce produit), donc un
 * sentinel sûr pour l'ETag : la première écriture produit toujours une version supérieure.
 */
export function versDtoBlocCreancier(
  ligne: schema.LigneTenantBlocCreancier | undefined,
): DtoBlocCreancier {
  if (!ligne) {
    return {
      nom: null,
      rue: null,
      numero: null,
      npa: null,
      localite: null,
      pays: 'CH',
      iban: null,
      qrIban: null,
      version: 0,
    };
  }
  return {
    nom: ligne.nom,
    rue: ligne.rue,
    numero: ligne.numero,
    npa: ligne.npa,
    localite: ligne.localite,
    pays: ligne.pays,
    iban: ligne.iban,
    qrIban: ligne.qrIban,
    version: ligne.modifieLe.getTime(),
  };
}

/**
 * Traduit une `ErreurQrFacture` (module pur, sans dépendance NestJS — voir son en-tête) en
 * `ErreurMetier` `VALIDATION_ECHOUEE` : c'est la frontière où le domaine QR redevient un
 * `problem+json` avec un `code` machine stable et un `champ` nommé, pour que le garagiste sache
 * QUOI corriger. Les messages de `facturation/qr/iban.ts` sont déjà rédigés pour un lecteur
 * humain (« Clé de contrôle IBAN (ISO 7064 mod 97-10) fausse — l'IBAN a été mal saisi. ») —
 * repris tels quels, jamais réécrits ici.
 */
function traduireErreurIban(erreur: unknown, champ: 'iban' | 'qrIban'): never {
  if (erreur instanceof ErreurQrFacture) {
    throw new ErreurMetier('VALIDATION_ECHOUEE', erreur.message, {
      erreurs: [{ champ, code: erreur.code, message: erreur.message }],
    });
  }
  throw erreur;
}

/**
 * Valide le champ `iban` (compte ORDINAIRE) : forme + pays + longueur + modulo 97
 * (`validerIbanCreancier`), PLUS le refus d'un QR-IBAN glissé ici par erreur — les deux colonnes
 * ne doivent jamais se mélanger (consigne de la tâche, arbitrage 2 de la migration 0014).
 */
function validerChampIbanOrdinaire(valeur: string): string {
  let compact: string;
  try {
    compact = validerIbanCreancier(valeur);
  } catch (erreur) {
    return traduireErreurIban(erreur, 'iban');
  }
  if (estQrIban(compact)) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      'Cet IBAN est un QR-IBAN (IID réservé 30000–31999) : il doit être saisi dans le champ ' +
        '"qrIban", jamais dans "iban" — les deux comptes sont distincts et ne se mélangent pas.',
      {
        erreurs: [
          {
            champ: 'iban',
            code: 'IBAN_EST_UN_QR_IBAN',
            message:
              'IID dans la plage réservée aux QR-IBAN (30000–31999) : utilisez le champ "qrIban".',
          },
        ],
      },
    );
  }
  return compact;
}

/**
 * Valide le champ `qrIban` : forme + pays + longueur + modulo 97 (`validerIbanCreancier`), PLUS
 * l'exigence symétrique — un IBAN ordinaire glissé ici par erreur est refusé, pas silencieusement
 * accepté.
 */
function validerChampQrIban(valeur: string): string {
  let compact: string;
  try {
    compact = validerIbanCreancier(valeur);
  } catch (erreur) {
    return traduireErreurIban(erreur, 'qrIban');
  }
  if (!estQrIban(compact)) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      "Cet IBAN n'est PAS un QR-IBAN (IID hors de la plage réservée 30000–31999) : il doit être " +
        'saisi dans le champ "iban", jamais dans "qrIban".',
      {
        erreurs: [
          {
            champ: 'qrIban',
            code: 'QR_IBAN_SANS_IID_RESERVE',
            message:
              'IID hors de la plage réservée aux QR-IBAN (30000–31999) : utilisez le champ "iban".',
          },
        ],
      },
    );
  }
  return compact;
}

/**
 * Traduit le corps validé (forme) en colonnes à écrire, validées (métier) : SEULS les champs
 * PRÉSENTS dans `entree` entrent dans le résultat (`undefined` = absent = ne pas toucher au sens
 * SQL du terme, jamais un `null` implicite qui écraserait une valeur existante) — exactement le
 * même principe que `versColonnesMiseAJour`/`versColonnesMiseAJourSite` du reste de `parametrage/`.
 */
export function versColonnesEcriture(
  entree: EntreeModificationBlocCreancier,
): Partial<schema.NouveauTenantBlocCreancier> {
  const colonnes: Partial<schema.NouveauTenantBlocCreancier> = {};

  if (entree.nom !== undefined) colonnes.nom = entree.nom;
  if (entree.rue !== undefined) colonnes.rue = entree.rue;
  if (entree.numero !== undefined) colonnes.numero = entree.numero;
  if (entree.npa !== undefined) colonnes.npa = entree.npa;
  if (entree.localite !== undefined) colonnes.localite = entree.localite;
  if (entree.pays !== undefined) colonnes.pays = entree.pays;
  if (entree.iban !== undefined)
    colonnes.iban = entree.iban === null ? null : validerChampIbanOrdinaire(entree.iban);
  if (entree.qrIban !== undefined)
    colonnes.qrIban = entree.qrIban === null ? null : validerChampQrIban(entree.qrIban);

  return colonnes;
}
