import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { FiltreTableauBord } from '@dfa/shared';

import { useActiviteTableauBord } from '@/hooks/tableau-bord/useActiviteTableauBord';
import { useFinancierTableauBord } from '@/hooks/tableau-bord/useFinancierTableauBord';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { CarteChiffreRequete } from './composants/CarteChiffreRequete';
import { SelecteurPeriodeTableauBord } from './SelecteurPeriodeTableauBord';

interface Props {
  readonly site: string | undefined;
}

/**
 * Direction — 6 blocs (`docs/design-tableau-bord-par-role.md` §3.1, ÉTENDU le 14.08.2026 : marge
 * + stock pièces, défaut #2 du test manuel du même jour — l'écran promettait « chiffre d'affaires,
 * marges, stock et activité » et ne rendait que le chiffre d'affaires) : l'argent qui rentre, la
 * marge, l'état du stock, ce qui sort ce soir, si l'atelier tourne. « Répartition par statut » et
 * « articles sous seuil » restent ÉCARTÉS ici (chiffre de pilotage voulu, pas un histogramme —
 * c'est le geste du chef d'atelier).
 *
 * Deux fenêtres temporelles COEXISTENT, volontairement découplées : le sélecteur de période
 * (mois civil par défaut) pilote le chiffre d'affaires ET la marge véhicules (toutes deux bornées
 * par la période côté contrat) ; « OR actuellement en atelier », le stock pièces et « sorties du
 * soir » restent des SNAPSHOTS (maintenant), indépendants du sélecteur — un OR ouvert le mois
 * dernier mais toujours en cours, ou le stock physique actuel, ne sont pas ce que la période de CA
 * doit faire disparaître de l'écran.
 *
 * « OR actuellement en atelier » — DÉFAUT CORRIGÉ (test manuel du 14.08.2026, défaut #1, le plus
 * grave des trois signalés : un « 0 » affiché alors que l'atelier avait bien des OR ouvert/en
 * cours/terminé/facturé). Cause RÉELLE, mesurée en relisant `ReponseActiviteTableauBord` (pas un
 * bug de calcul SQL) : cette carte utilisait `ordresReparationOuvertsPeriode` (« combien d'OR ont
 * été OUVERTS pendant AUJOURD'HUI », borné à la journée) sous un libellé qui laissait croire à
 * « combien d'OR sont actuellement au garage » — deux questions différentes. Un atelier qui
 * travaille normalement a la plupart de ses OR actifs ouverts un jour ANTÉRIEUR à aujourd'hui :
 * `ordresReparationOuvertsPeriode` légitimement à 0 ce jour-là (aucun OR NOUVEAU), alors que
 * `ordresReparationParStatut` (snapshot des 6 statuts encore « au garage », le même champ que le
 * réceptionniste affiche dans « OR en cours par statut ») était loin de zéro. Corrigé en sommant
 * `ordresReparationParStatut` plutôt qu'en lisant `ordresReparationOuvertsPeriode` — voir aussi
 * `periode.spec.ts` côté API pour un second défaut, réel mais indépendant, corrigé dans la foulée
 * (bornage de journée en UTC pur au lieu de l'heure suisse, qui affectait `ordresReparationOuvertsPeriode`
 * lui-même sans être la cause du « 0 » observé ici).
 *
 * « Encours clients » n'est PAS un lien filtré : `EcranListeFactures` lit son onglet depuis un
 * état local, jamais depuis l'URL (voir `composants/CarteAccesRapide.tsx` pour le même constat,
 * détaillé, côté comptable) — le lien mène donc à la liste générale des factures, pas à une vue
 * pré-filtrée « en retard », gap signalé plutôt qu'un lien qui prétendrait filtrer sans le faire.
 */
export function TableauBordDirection({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);
  const [du, setDu] = useState<string | undefined>(undefined);
  const [au, setAu] = useState<string | undefined>(undefined);

  const filtrePeriode = useMemo<FiltreTableauBord>(
    () => ({ siteId: site, du, au }),
    [site, du, au],
  );
  // SNAPSHOT (ordresReparationParStatut ne dépend pas de la période, voir la doc du contrat) —
  // aucun `du`/`au` transmis : un changement de période ne doit pas redéclencher cette requête,
  // seul un changement de site le doit (même patron que `TableauBordChefAtelier`).
  const filtreSite = useMemo<FiltreTableauBord>(() => ({ siteId: site }), [site]);

  const financier = useFinancierTableauBord(filtrePeriode, true);
  const activite = useActiviteTableauBord(filtreSite);

  /** Résolution STATIQUE (clés `t()` littérales, vérifiées par `pnpm i18n:check`) de
   *  `MargeIndisponibleTableauBord.raisonCle` — jamais `t(\`...${raisonCle}\`)`, qui échapperait à
   *  l'extraction statique des clés (voir `scripts/verifier-i18n.mjs`). Une `raisonCle` que ce
   *  dépôt ne connaît pas encore retombe sur un libellé générique plutôt qu'une clé brute affichée. */
  const libellesRaisonMargeIndisponible: Record<string, string> = {
    piecesCoutNonFiable: t('tableauBord:financier.marges.indisponible.piecesCoutNonFiable'),
    mainOeuvreCoutAbsent: t('tableauBord:financier.marges.indisponible.mainOeuvreCoutAbsent'),
  };

  return (
    // `gap-section`/`gap-groupe` : tokens de densité (index.css), déjà resserrés par `densite-dense`
    // posé sur `EcranTableauBord` — remplacent les `gap-6`/`gap-4` fixes d'origine, mêmes valeurs en
    // mode aéré (dégradation sûre hors de ce contexte), plus petites ici.
    <div className="flex flex-col gap-section">
      {/* DESIGN.md « carte dans une carte » (grief n°1, capture `light-dashboard.png`) — le
       *  sélecteur vivait auparavant DANS la même cellule de grille qu'une `Card` (« Chiffre
       *  d'affaires TTC »), lui-même coincé entre deux autres `Card` pleines (Encours clients, OR
       *  en atelier) sur la même ligne : la zone de contrôle non encartée, posée juste au-dessus
       *  d'une carte, à l'intérieur d'une cellule flanquée de deux cartes entières, se lisait comme
       *  un rectangle inséré dans un autre. Sorti ici en bandeau de contrôle PLEINE LARGEUR, jamais
       *  encarté (règle « bordure structurelle uniquement » : un filtre de période n'est pas une
       *  zone d'action à isoler dans sa propre boîte) — même patron que `TableauBordComptable`, où
       *  ce sélecteur a toujours vécu au-dessus de sa grille, jamais imbriqué dans une cellule.
       *  Portée du filtre : `financier` (donc CA ET Encours clients, qui partagent la même requête,
       *  voir plus bas) — jamais « OR actuellement en atelier », toujours un SNAPSHOT (`activite`).
       */}
      <SelecteurPeriodeTableauBord
        du={du}
        au={au}
        onChangeDu={setDu}
        onChangeAu={setAu}
        periodeAppliquee={financier.data?.periode}
      />

      {/* DESIGN.md grief n°2 — `items-start` : les trois cartes `compact` ci-dessous ont des
          descriptions de longueur différente (1 à 3 lignes) ; sans lui, la grille CSS étire
          chacune à la hauteur de la plus haute, rouvrant le même vide que sans `compact`. */}
      <div className="grid items-start gap-groupe sm:grid-cols-2 lg:grid-cols-4">
        <CarteChiffreRequete
          compact
          titre={t('tableauBord:financier.encoursClients.libelle')}
          resultat={financier}
          libelleErreur={t('tableauBord:financier.erreur.titre')}
          valeur={(donnees) => `CHF ${formaterMontant(donnees.encoursClientsCentimes)}`}
          // Défaut corrigé (issue #94, testeur novice — « CHF 0.00 » lu comme « tout est à jour »
          // sans savoir ce que le chiffre couvre) : la définition retenue par le calcul serveur
          // (`ServiceTableauBordFinancier.obtenir` — factures ÉMISES, solde encore dû, jamais un
          // brouillon) devient visible à l'écran plutôt que de rester un chiffre magique.
          description={() => t('tableauBord:financier.encoursClients.definition')}
          lien={{
            to: chemins.facturation.liste(site),
            texte: t('tableauBord:communs.voirFactures'),
          }}
        />
        <CarteChiffreRequete
          compact
          className="sm:col-span-2"
          titre={t('tableauBord:financier.chiffreAffaires.libelle')}
          resultat={financier}
          libelleErreur={t('tableauBord:financier.erreur.titre')}
          valeur={(donnees) => `CHF ${formaterMontant(donnees.chiffreAffaires.totalTtcCentimes)}`}
          description={(donnees) =>
            t('tableauBord:financier.chiffreAffaires.detail', {
              ht: formaterMontant(donnees.chiffreAffaires.totalHtCentimes),
              tva: formaterMontant(donnees.chiffreAffaires.totalTvaCentimes),
              nombreDocuments: donnees.chiffreAffaires.nombreDocuments,
            })
          }
        />
        <CarteChiffreRequete
          compact
          titre={t('tableauBord:activite.enAtelier.libelle')}
          resultat={activite}
          libelleErreur={t('tableauBord:activite.erreur.titre')}
          valeur={(donnees) =>
            String(donnees.ordresReparationParStatut.reduce((total, e) => total + e.nombre, 0))
          }
          description={() => t('tableauBord:activite.enAtelier.description')}
        />
      </div>

      {/* DESIGN.md grief n°2 — `items-start` : « marge indisponible » (deux lignes de motif) est
          structurellement plus haute que ses deux voisines, mêmes raisons que la grille ci-dessus. */}
      <div className="grid items-start gap-groupe sm:grid-cols-2 lg:grid-cols-3">
        <CarteChiffreRequete
          compact
          titre={t('tableauBord:financier.marges.vehicules.libelle')}
          resultat={financier}
          libelleErreur={t('tableauBord:financier.erreur.titre')}
          valeur={(donnees) => `CHF ${formaterMontant(donnees.marges.vehicules.margeCentimes)}`}
          description={(donnees) =>
            t('tableauBord:financier.marges.vehicules.detail', {
              nombreVehiculesFactures: donnees.marges.vehicules.nombreVehiculesFactures,
            })
          }
        />
        <CarteChiffreRequete
          compact
          titre={t('tableauBord:financier.marges.indisponible.titre')}
          resultat={financier}
          libelleErreur={t('tableauBord:financier.erreur.titre')}
          // Jamais un montant (ni « CHF 0.00 », ni « 0 ») : un mot, distinct typographiquement
          // d'un chiffre — voir la doc de `MargeIndisponibleTableauBord` (@dfa/shared).
          valeur={() => t('tableauBord:financier.marges.indisponible.libelle')}
          // `CarteChiffreRequete` enveloppe déjà `description(...)` dans un `<p>` (voir ce
          // composant) : `<span className="block">` ici, JAMAIS `<p>` (imbrication de blocs
          // invalide en HTML, avertissement d'hydratation React) — deux lignes visuellement
          // distinctes sans enfreindre le contenu autorisé dans un `<p>`.
          description={(donnees) => (
            <>
              <span className="block">
                {libellesRaisonMargeIndisponible[donnees.marges.pieces.raisonCle] ??
                  t('tableauBord:financier.marges.indisponible.raisonGenerique')}
              </span>
              <span className="block">
                {libellesRaisonMargeIndisponible[donnees.marges.mainOeuvre.raisonCle] ??
                  t('tableauBord:financier.marges.indisponible.raisonGenerique')}
              </span>
            </>
          )}
        />
        <CarteChiffreRequete
          compact
          titre={t('tableauBord:financier.stockPieces.libelle')}
          resultat={financier}
          libelleErreur={t('tableauBord:financier.erreur.titre')}
          valeur={(donnees) => `CHF ${formaterMontant(donnees.stockPieces.totalCentimes)}`}
          description={(donnees) => (
            <>
              <span className="block">{t('tableauBord:financier.stockPieces.definition')}</span>
              {donnees.stockPieces.articlesValeurInconnueNombre > 0 ? (
                <span className="block">
                  {t('tableauBord:financier.stockPieces.articlesValeurInconnue', {
                    count: donnees.stockPieces.articlesValeurInconnueNombre,
                  })}
                </span>
              ) : null}
            </>
          )}
        />
      </div>
    </div>
  );
}
