import type { TypeClient } from '@dfa/shared';

/**
 * Champs d'identité nécessaires pour calculer le nom affiché d'un client — délibérément
 * découplé de `LigneClient` (`db/schema`) : ce module est un pur calcul d'affichage, sans lien
 * de compilation avec la couche base de données. Les appelants (`clients/`, `vehicules/`)
 * passent un `Pick<LigneClient, 'type' | 'nom' | 'prenom' | 'raisonSociale'>`, qui satisfait
 * structurellement cette interface sans import croisé.
 */
export interface IdentiteClientAffichage {
  readonly type: TypeClient;
  readonly nom: string | null;
  readonly prenom: string | null;
  readonly raisonSociale: string | null;
}

/**
 * Nom affiché d'un client — implémentation UNIQUE, partagée par `clients/` et `vehicules/`
 * (`recherche/utilitaires-recherche.ts::nomAfficheClient` porte encore sa propre copie ; elle
 * sera alignée séparément, hors périmètre de cette unification — voir note de livraison).
 * Remplace trois implémentations quasi identiques écrites en parallèle par des agents
 * différents et qui avaient divergé sur deux points (voir `nom-affiche.spec.ts`).
 *
 * RÈGLE (RM-01, docs/specification-etape-1-atelier-clients.md:235 ; arbitrage @laupernoe du
 * 28.07.2026) : **`type` fait autorité — jamais la simple présence d'un champ.** `type` est
 * immuable après création (trigger SQL `client_verrouiller_type`, `0006_clients.sql`) ;
 * `raisonSociale`/`nom`/`prenom` ne le sont pas. Le CHECK `client_identite_chk` est un OR, pas
 * un XOR : rien n'empêche en base un `type = 'particulier'` avec `raisonSociale` renseignée
 * aussi (ou l'inverse). Une ancienne version de ce calcul (`clients/mappers.ts`) branchait sur
 * la présence de `raisonSociale` plutôt que sur `type` : un particulier ayant une
 * `raisonSociale` résiduelle (legacy, import, saisie erronée) aurait alors affiché sa raison
 * sociale au lieu de son nom sur cet écran, et l'inverse sur les écrans `vehicules/`/`recherche/`
 * — deux noms différents pour le même client selon l'écran. Ce comportement est corrigé ici,
 * pas conservé : ne pas le restaurer en pensant réparer une régression.
 *
 * Chaque partie est TRIMÉE avant d'être retenue ou jointe : une chaîne blanche (`"   "`) est
 * traitée comme absente, jamais comme un nom vide entouré d'espaces qui remonterait dans les
 * recherches, les tris ou les exports fiduciaires.
 *
 * CAS NON RÉSOLU, signalé et non traité ici (décision @laupernoe en attente) : si le champ faisant
 * autorité pour le type (`raisonSociale` pour une entreprise, `nom` pour un particulier) est
 * lui-même vide ou blanc une fois trimé, cette fonction rend `''`. C'est atteignable EN BASE —
 * `client_identite_chk` exige seulement `is not null`, pas une chaîne non vide, contrairement à
 * `client.numero` (`client_numero_non_vide_chk`) ou `tenant.raison_sociale`
 * (`tenant_raison_sociale_non_vide_chk`) qui ont un CHECK dédié — mais PAS atteignable
 * aujourd'hui via `POST`/`PATCH /clients` : `schemaTexteCourt` (`@dfa/shared`) est
 * `z.string().trim().min(1)`, qui rejette une valeur blanche avant qu'elle n'atteigne la base.
 * Seul un contournement de la validation API (import de données, correctif SQL direct) peut
 * produire ce cas.
 */
export function calculerNomAffiche(client: IdentiteClientAffichage): string {
  if (client.type === 'entreprise') {
    return (client.raisonSociale ?? '').trim();
  }
  return [client.nom, client.prenom]
    .map((valeur) => valeur?.trim())
    .filter((valeur): valeur is string => Boolean(valeur))
    .join(' ');
}
