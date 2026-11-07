import {
  PAYEURS_FACTURATION_SELECTIONNABLES,
  type PayeurFacturationSelectionnable,
  type PayeurLigneOr,
  type ReponseLigneOr,
  type ReponseOrdreReparation,
} from '@dfa/shared';

/** `garage` n'a pas de groupe séparé (`RF-92`) : ses lignes, valorisées à `0.00` (RM-70), rejoignent
 *  le groupe `'client'` — `PAYEURS_FACTURATION_SELECTIONNABLES` (contrat gelé) exclut `'garage'` par
 *  construction, donc toute autre valeur de `PayeurLigneOr` s'y range identiquement. */
export function payeurFacturable(payeur: PayeurLigneOr): PayeurFacturationSelectionnable {
  return payeur === 'garage' ? 'client' : (payeur as PayeurFacturationSelectionnable);
}

/** Clé de regroupement `(payeur, payeurClientId)` (`MD-62`) — jamais `payeur` seul : deux
 *  assurances distinctes sur le même OR (deux sinistres qui se croisent sur la même voiture) sont
 *  deux groupes, donc deux factures à deux destinataires, jamais fusionnées. */
export function cleGroupe(
  payeur: PayeurFacturationSelectionnable,
  payeurClientId: string | null,
): string {
  return `${payeur}:${payeurClientId ?? ''}`;
}

export interface GroupePayeur {
  readonly payeur: PayeurFacturationSelectionnable;
  readonly payeurClientId: string | null;
  /** Résolu depuis `or.totauxParPayeur` (destinataire projeté par le serveur, `RF-87`) ; pour le
   *  groupe `'client'`, retombe sur le client de l'OR lui-même si les totaux sont absents (rôle
   *  sans droit aux montants). */
  readonly destinataire: { readonly clientId: string; readonly nomAffiche: string } | null;
  readonly lignes: readonly ReponseLigneOr[];
  readonly totalTtcCentimes: number | undefined;
}

/** Libellé affiché du groupe — « Assurance — Zurich Assurances » pour désambiguïser deux groupes
 *  du même `payeur` (design §3.2), jamais juste « Assurance » qui redeviendrait ambigu à deux
 *  assureurs sur le même OR. */
export function libelleGroupe(
  t: (cle: string, options?: Record<string, unknown>) => string,
  groupe: GroupePayeur,
): string {
  const libellePayeur = t(`or:lignes.payeurs.${groupe.payeur}`);
  if (groupe.payeur === 'client' || !groupe.destinataire) return libellePayeur;
  return `${libellePayeur} — ${groupe.destinataire.nomAffiche}`;
}

/** Statuts de ligne « indécis » qui bloquent la facturation (`RF-86`) : ni réalisées (facturables),
 *  ni refusées/annulées (définitivement écartées). */
export const STATUTS_INDECIS: ReadonlySet<ReponseLigneOr['statut']> = new Set([
  'proposee',
  'a_valider',
  'validee',
  'en_cours',
]);

/** Groupes payeur FACTURABLES d'un OR : lignes `realisee` pas encore facturées, regroupées par
 *  `(payeur, payeurClientId)`, triées dans l'ordre du contrat. Partagé par l'écran « Facturer » et
 *  le raccourci « Facturer et encaisser » de la fiche OR. */
export function calculerGroupesFacturables(or: ReponseOrdreReparation): readonly GroupePayeur[] {
  const lignesFacturables = or.lignes.filter(
    (ligne) => ligne.statut === 'realisee' && ligne.factureId === null,
  );
  const parGroupe = new Map<
    string,
    {
      payeur: PayeurFacturationSelectionnable;
      payeurClientId: string | null;
      lignes: ReponseLigneOr[];
    }
  >();
  for (const ligne of lignesFacturables) {
    const payeur = payeurFacturable(ligne.payeur);
    const payeurClientId = payeur === 'client' ? null : ligne.payeurClientId;
    const cle = cleGroupe(payeur, payeurClientId);
    const existant = parGroupe.get(cle);
    if (existant) existant.lignes.push(ligne);
    else parGroupe.set(cle, { payeur, payeurClientId, lignes: [ligne] });
  }
  return [...parGroupe.values()]
    .sort((a, b) => {
      const rang =
        PAYEURS_FACTURATION_SELECTIONNABLES.indexOf(a.payeur) -
        PAYEURS_FACTURATION_SELECTIONNABLES.indexOf(b.payeur);
      return rang !== 0 ? rang : (a.payeurClientId ?? '').localeCompare(b.payeurClientId ?? '');
    })
    .map((g) => {
      const totaux = or.totauxParPayeur?.find(
        (t_) => t_.payeur === g.payeur && (t_.payeurClientId ?? null) === g.payeurClientId,
      );
      const destinataire =
        g.payeur === 'client'
          ? (totaux?.destinataire ?? { clientId: or.client.id, nomAffiche: or.client.nomAffiche })
          : (totaux?.destinataire ?? null);
      return {
        payeur: g.payeur,
        payeurClientId: g.payeurClientId,
        destinataire,
        lignes: g.lignes,
        totalTtcCentimes: totaux?.montantTtcCentimes,
      };
    });
}
