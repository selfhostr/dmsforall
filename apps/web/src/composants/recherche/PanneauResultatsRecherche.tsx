import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseRecherche, ResultatRecherche } from '@dfa/shared';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { EtatVide } from '@/composants/commun/EtatVide';

import { ChoixPlaqueInterchangeable } from './ChoixPlaqueInterchangeable';
import { ResultatClient } from './ResultatClient';
import { ResultatOr } from './ResultatOr';
import { ResultatVehicule } from './ResultatVehicule';

export interface ProprietesPanneauResultatsRecherche {
  readonly valeur: string;
  readonly onValeurChange: (valeur: string) => void;
  /** `null` tant qu'aucune réponse n'est encore arrivée (requête pas encore déclenchée, ou en
   *  vol — voir `enChargement`). La normalisation de `valeur` reste strictement serveur. */
  readonly reponse: ReponseRecherche | null;
  readonly enChargement?: boolean;
  readonly onSelectionner: (resultat: ResultatRecherche) => void;
  readonly onEchap?: () => void;
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * Panneau de résultats de la recherche globale (D-08) — groupes Véhicules / Clients / Ordres de
 * réparation, navigation clavier complète (↑ ↓ fournis par `cmdk`, Entrée = `onSelect`,
 * Échap = `onEchap`). Autonome et testable seul : porte son propre `CommandInput` contrôlé
 * (`valeur`/`onValeurChange`), l'écran R2 se contente de le monter et de brancher le hook réseau.
 *
 * Aucune requête ici : purement présentationnel, reçoit `reponse` déjà résolue par l'appelant.
 */
export function PanneauResultatsRecherche({
  valeur,
  onValeurChange,
  reponse,
  enChargement = false,
  onSelectionner,
  onEchap,
  placeholder,
  className,
}: ProprietesPanneauResultatsRecherche) {
  const { t } = useTranslation('recherche');

  function gererClavier(evenement: KeyboardEvent<HTMLDivElement>) {
    if (evenement.key === 'Escape' && onEchap) {
      evenement.preventDefault();
      onEchap();
    }
  }

  const vehicules = reponse?.resultats.filter((resultat) => resultat.type === 'vehicule') ?? [];
  const clients = reponse?.resultats.filter((resultat) => resultat.type === 'client') ?? [];
  const ordres = reponse?.resultats.filter((resultat) => resultat.type === 'ordre_reparation') ?? [];
  const plaqueInterchangeable = reponse?.plaqueInterchangeable === true;
  const aucunResultat = reponse !== null && reponse.resultats.length === 0;

  return (
    <div onKeyDown={gererClavier} className={className}>
      {/* RM-18 / §6.9 : rendu HORS de la liste `cmdk` — ni ordonnancement par score, ni
          surlignage automatique du premier élément (voir ChoixPlaqueInterchangeable). */}
      {plaqueInterchangeable && vehicules.length > 0 ? (
        <div className="mb-3">
          <ChoixPlaqueInterchangeable vehicules={vehicules} onChoisir={onSelectionner} />
        </div>
      ) : null}

      <Command label={t('titre')} shouldFilter={false}>
        <CommandInput
          value={valeur}
          onValueChange={onValeurChange}
          placeholder={placeholder ?? t('placeholder')}
        />
        <CommandList>
          {enChargement ? <CommandEmpty>{t('chargement')}</CommandEmpty> : null}
          {!enChargement && aucunResultat ? (
            <CommandEmpty>
              <EtatVide titre={t('vide.titre')} description={t('vide.description')} />
            </CommandEmpty>
          ) : null}

          {!enChargement && !plaqueInterchangeable && vehicules.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.vehicules', { count: vehicules.length })}
              resultats={vehicules}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatVehicule resultat={resultat} />}
            />
          ) : null}

          {!enChargement && clients.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.clients', { count: clients.length })}
              resultats={clients}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatClient resultat={resultat} />}
            />
          ) : null}

          {!enChargement && ordres.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.ordres', { count: ordres.length })}
              resultats={ordres}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatOr resultat={resultat} />}
            />
          ) : null}
        </CommandList>
      </Command>
    </div>
  );
}

interface ProprietesGroupeResultats {
  readonly heading: string;
  readonly resultats: readonly ResultatRecherche[];
  readonly onSelectionner: (resultat: ResultatRecherche) => void;
  readonly rendreContenu: (resultat: ResultatRecherche) => ReactNode;
}

function GroupeResultats({ heading, resultats, onSelectionner, rendreContenu }: ProprietesGroupeResultats) {
  return (
    <CommandGroup heading={heading}>
      {resultats.map((resultat) => (
        <CommandItem
          key={resultat.id}
          value={resultat.id}
          onSelect={() => onSelectionner(resultat)}
          className="min-h-11"
        >
          {rendreContenu(resultat)}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
