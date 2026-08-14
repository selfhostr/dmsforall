import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { FiltreTableauBord, FiltresDocumentsVente } from '@dfa/shared';

import { useListeDocumentsVente } from '@/hooks/facturation/useListeDocumentsVente';
import { useFinancierTableauBord } from '@/hooks/tableau-bord/useFinancierTableauBord';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import {
  CarteChiffreRequete,
  type ResultatChiffreTableauBord,
} from './composants/CarteChiffreRequete';
import { SelecteurPeriodeTableauBord } from './SelecteurPeriodeTableauBord';

interface Props {
  readonly site: string | undefined;
}

/** Filtre « à relancer » — même primitive citée et vérifiée en exécution par
 *  `EcranListeFactures.tsx` (`enRetard=true&relanceNiveau=0`, la seule que le contrat désigne
 *  explicitement comme couvrant le cas usuel « en retard, jamais relancée »). */
const FILTRE_A_RELANCER: FiltresDocumentsVente = {
  typeDocument: ['facture'],
  statut: ['emis'],
  enRetard: true,
  relanceNiveau: 0,
  // Plus ancienne d'abord — même convention que l'onglet « Non réglées » de `EcranListeFactures.tsx`.
  tri: 'dateDocument:asc',
};

/** Plafond de comptage honnête — voir le commentaire de `TableauBordComptable` ci-dessous : au-delà,
 *  la carte affiche « {N}+ » plutôt qu'un chiffre qui prétendrait être exact sans l'être. */
const LIMITE_COMPTAGE_A_RELANCER = 50;

interface CompteARelancer {
  readonly nombre: number;
  readonly plus: boolean;
}

/**
 * Comptable — 3 blocs (`docs/design-tableau-bord-par-role.md` §3.2) : l'argent qui n'est pas
 * rentré. `chiffreAffaires` est ÉCARTÉ (facturation brute, pas son geste — elle travaille sur
 * l'encaissé et l'impayé).
 *
 * « À relancer » — DÉFAUT CORRIGÉ (issue #93, testeur novice : « une carte qui me donne un
 * itinéraire au lieu d'une information, inutilisable ») : ce bloc affichait un simple LIEN
 * (`CarteAccesRapide`) au motif que `PageCurseur` n'expose aucun total. C'est vrai, mais ça ne
 * force pas à renoncer à un chiffre : `useListeDocumentsVente` (même hook, même filtre, déjà
 * prouvés appliqués au SQL — voir `EcranListeFactures.tsx`) rend la première page de résultats,
 * dont la LONGUEUR est un compte exact tant qu'elle n'est pas pleine. Au-delà de
 * `LIMITE_COMPTAGE_A_RELANCER`, la carte l'annonce honnêtement (« 50+ ») plutôt que de prétendre à
 * une précision qu'elle n'a pas — jamais un compte inventé, jamais un itinéraire à la place d'un
 * chiffre. `CarteChiffreRequete` porte déjà la doctrine « zéro digne » (aucun message de remplacement
 * pour un compte à zéro), réutilisée telle quelle ici.
 *
 * Preuve d'exécution du filtre `enRetard`/`relanceNiveau` (piège documenté dans `CONTRIBUTING.md`,
 * §4 du design) : vérifiée AVANT ce fichier — `service-documents.ts:313-335` pousse bien
 * `enRetard`/`relanceNiveau` en conditions SQL (pas seulement acceptés par le contrat), et
 * `EcranListeFactures.filtresOnglets.spec.tsx`/`documents-vente.api.spec.ts` verrouillent la
 * sérialisation bout en bout, y compris le cas `relanceNiveau: 0` (piège de troncature à zéro).
 */
export function TableauBordComptable({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'commun']);
  const [du, setDu] = useState<string | undefined>(undefined);
  const [au, setAu] = useState<string | undefined>(undefined);

  const filtre = useMemo<FiltreTableauBord>(() => ({ siteId: site, du, au }), [site, du, au]);
  const financier = useFinancierTableauBord(filtre, true);

  const filtreARelancer = useMemo<FiltresDocumentsVente>(
    () => ({ ...FILTRE_A_RELANCER, siteId: site }),
    [site],
  );
  const aRelancer = useListeDocumentsVente(filtreARelancer);
  // Forme attendue par `CarteChiffreRequete` (`ResultatChiffreTableauBord<T>`) : `useListeDocumentsVente`
  // est une requête infinie (`documents`/`hasNextPage` à côté de `data`, jamais DANS `data`) — ce
  // shim recompose la forme SANS toucher au hook partagé avec `EcranListeFactures`.
  const resultatARelancer: ResultatChiffreTableauBord<CompteARelancer> = {
    data: aRelancer.isPending
      ? undefined
      : { nombre: aRelancer.documents.length, plus: Boolean(aRelancer.hasNextPage) },
    isPending: aRelancer.isPending,
    isError: aRelancer.isError,
    error: aRelancer.error,
    refetch: aRelancer.refetch,
  };

  return (
    <div className="flex flex-col gap-4">
      <SelecteurPeriodeTableauBord
        du={du}
        au={au}
        onChangeDu={setDu}
        onChangeAu={setAu}
        periodeAppliquee={financier.data?.periode}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <CarteChiffreRequete
          titre={t('tableauBord:financier.encoursClients.libelle')}
          resultat={financier}
          libelleErreur={t('tableauBord:financier.erreur.titre')}
          valeur={(donnees) => `CHF ${formaterMontant(donnees.encoursClientsCentimes)}`}
          description={() => t('tableauBord:financier.encoursClients.definition')}
          lien={{
            to: chemins.facturation.liste(site),
            texte: t('tableauBord:communs.voirFactures'),
          }}
        />
        <CarteChiffreRequete
          titre={t('tableauBord:financier.encaissements.libelle')}
          resultat={financier}
          libelleErreur={t('tableauBord:financier.erreur.titre')}
          valeur={(donnees) => `CHF ${formaterMontant(donnees.encaissementsCentimes)}`}
        />
        <CarteChiffreRequete
          titre={t('tableauBord:comptable.aRelancer.titre')}
          resultat={resultatARelancer}
          libelleErreur={t('tableauBord:comptable.aRelancer.erreur')}
          valeur={(donnees) =>
            donnees.plus ? `${LIMITE_COMPTAGE_A_RELANCER}+` : String(donnees.nombre)
          }
          description={() => t('tableauBord:comptable.aRelancer.description')}
          lien={{
            to: chemins.facturation.liste(site),
            texte: t('tableauBord:comptable.aRelancer.lien'),
          }}
        />
      </div>
    </div>
  );
}
