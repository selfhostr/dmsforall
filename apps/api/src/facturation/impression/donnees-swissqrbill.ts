/**
 * Traduit le bloc QR FIGÉ d'une facture (`ReponseDocumentVente.qr`, `BlocPaiementQrFige` —
 * `@dfa/shared`) vers le format `Data` attendu par `swissqrbill` (`swissqrbill/types`).
 *
 * Frontière stricte avec `DI-3`/`MD-77` (voir `docs/design-impression-facture-qr.md`) : cette
 * fonction ne lit QUE des champs déjà figés à l'émission (`document.qr`, `document.figees`) —
 * jamais `tenant_bloc_creancier` ni aucune donnée « courante » du tenant ou du client. Un
 * déménagement du garage ou une correction d'adresse client postérieurs à l'émission ne doivent
 * jamais changer un bulletin déjà émis.
 *
 * Cette fonction ne fait AUCUNE vérification de conformité — c'est `verification-payload-qr.ts`
 * qui compare, à l'exécution, le payload que `swissqrbill` encode réellement à partir de ce
 * `Data` avec le `qrPayload` figé en base. Ce module se contente du mapping de champs.
 */

import type { Data } from 'swissqrbill/types';
import type { BlocPaiementQrFige, Langue } from '@dfa/shared';

import { ErreurMetier } from '../../common/erreurs/erreur-metier';

/** `swissqrbill` n'accepte que ces quatre codes (+ `RM`, jamais utilisé ici) — voir
 *  `PDFOptions.language` / `SVGOptions.language` (`swissqrbill/types`). `LANGUES` de
 *  `@dfa/shared` ne contient que `fr`/`de`/`it` (pas de romanche au produit) : le mapping est
 *  donc total sur l'ensemble réellement possible en base (`qr_langue`, `langue_figee`). */
const LANGUE_SWISSQRBILL_PAR_LANGUE: Readonly<Record<Langue, 'FR' | 'DE' | 'IT'>> = {
  fr: 'FR',
  de: 'DE',
  it: 'IT',
};

function estLangueConnue(valeur: string): valeur is Langue {
  return valeur === 'fr' || valeur === 'de' || valeur === 'it';
}

/**
 * `qr.qrLangue` (et `figees.clientLangue`) sont des `string` côté contrat (voir le commentaire sur
 * `BlocPaiementQrFige.qrLangue` dans `packages/shared/src/contrats/facturation/document.ts` — non
 * resserré à `Langue` côté contrat public). La colonne base (`langue_figee`/`qr_langue`) est un
 * enum Postgres `langue` restreint à `fr`/`de`/`it` : une valeur hors de cet ensemble est une
 * incohérence de données, jamais un cas métier — remonte bruyamment plutôt que de tomber sur un
 * défaut silencieux (même doctrine que `deviseFacturationDepuisBase` dans
 * `facturation/documents/mappeurs.ts`). Utilisée à la fois pour l'option `language` de
 * `swissqrbill` et pour choisir le jeu de libellés du corps de facture (`libelles-impression.ts`)
 * — LA LANGUE D'IMPRESSION EST CELLE DU CLIENT, JAMAIS CELLE DE L'UTILISATEUR CONNECTÉ (consigne
 * du coordinateur).
 */
export function validerLangueFigee(langueBrute: string): Langue {
  if (!estLangueConnue(langueBrute)) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Langue figée inattendue pour l'impression : "${langueBrute}" — seules fr/de/it sont admises (colonne qr_langue/langue_figee).`,
    );
  }
  return langueBrute;
}

export function langueSwissQrBill(qrLangue: string): 'FR' | 'DE' | 'IT' {
  return LANGUE_SWISSQRBILL_PAR_LANGUE[validerLangueFigee(qrLangue)];
}

/**
 * Construit le `Data` swissqrbill depuis le bloc QR figé. `montantCentimes` est un entier de
 * centimes (`RF-*`, doctrine monétaire du produit) ; `swissqrbill` attend un montant décimal en
 * unité monétaire pleine (`amount: number`, ex. `70.00` pour 7000 centimes) — la seule conversion
 * faite ici, jamais un recalcul.
 *
 * `numeroDocument` : `ReponseDocumentVente.numero`, figé et immuable dès l'émission (`MD-19`).
 * Sert à reconstruire `message = "Facture <numero>"`, EXACTEMENT la règle appliquée à l'émission
 * (`qr-emission.ts::construireBlocQrPourEmission`, `messageNonStructure: \`Facture ${numero}\``).
 * Ce n'est PAS une recomposition du bulletin au sens `MD-77` : `numero` ne change plus jamais une
 * fois émis, donc cette reconstruction est stable — et surtout, `verification-payload-qr.ts` la
 * met à l'épreuve à CHAQUE génération contre le `qrPayload` réellement figé (source de vérité) :
 * une erreur de reconstruction ici ne produit jamais un bulletin faux, elle fait échouer la
 * comparaison et refuse la génération (voir le module de vérification).
 */
export function construireDonneesSwissQrBill(qr: BlocPaiementQrFige, numeroDocument: string): Data {
  const data: Data = {
    amount: qr.qrMontantCentimes / 100,
    currency: qr.qrDevise,
    creditor: {
      account: qr.creancier.iban,
      name: qr.creancier.nom,
      address: qr.creancier.adresse.rue,
      // `swissqrbill` accepte `string | number | undefined` — `numero` est `string | null` côté
      // figé (`AdresseStructureeQr.numero`) : `null` devient `undefined`, jamais une chaîne vide
      // (une chaîne vide serait un numéro de rue explicite mais faux).
      buildingNumber: qr.creancier.adresse.numero ?? undefined,
      zip: qr.creancier.adresse.npa,
      city: qr.creancier.adresse.localite,
      country: qr.creancier.adresse.pays,
    },
    ...(qr.debiteur
      ? {
          debtor: {
            name: qr.debiteur.nom,
            address: qr.debiteur.rue,
            buildingNumber: qr.debiteur.numero ?? undefined,
            zip: qr.debiteur.npa,
            city: qr.debiteur.localite,
            country: qr.debiteur.pays,
          },
        }
      : {}),
    // `qrReference` est `null` uniquement quand `typeReferenceQr = 'non'` (IBAN ordinaire sans
    // référence) — omettre le champ plutôt que d'envoyer une chaîne vide, `swissqrbill` traite les
    // deux différemment (`reference` absent ⇒ pas de ligne de référence sur le bulletin).
    ...(qr.qrReference ? { reference: qr.qrReference } : {}),
    message: `Facture ${numeroDocument}`,
  };

  return data;
}
