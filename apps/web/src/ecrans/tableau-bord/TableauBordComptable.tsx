import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { FiltreTableauBord } from '@dfa/shared';

import { useFinancierTableauBord } from '@/hooks/tableau-bord/useFinancierTableauBord';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { CarteAccesRapide } from './composants/CarteAccesRapide';
import { CarteChiffreRequete } from './composants/CarteChiffreRequete';
import { SelecteurPeriodeTableauBord } from './SelecteurPeriodeTableauBord';

interface Props {
  readonly site: string | undefined;
}

/**
 * Comptable — 3 blocs (`docs/design-tableau-bord-par-role.md` §3.2) : l'argent qui n'est pas
 * rentré. `chiffreAffaires` est ÉCARTÉ (facturation brute, pas son geste — elle travaille sur
 * l'encaissé et l'impayé).
 *
 * « À relancer » N'EST PAS un chiffre : `PageCurseur` n'expose aucun total et `EcranListeFactures`
 * ignore de toute façon tout paramètre d'URL pour son onglet — voir `composants/CarteAccesRapide.tsx`
 * pour le détail complet du gap. C'est un LIEN honnête, jamais un compte inventé.
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
        <CarteAccesRapide
          titre={t('tableauBord:comptable.aRelancer.titre')}
          description={t('tableauBord:comptable.aRelancer.description')}
          lien={{
            to: chemins.facturation.liste(site),
            texte: t('tableauBord:comptable.aRelancer.lien'),
          }}
        />
      </div>
    </div>
  );
}
