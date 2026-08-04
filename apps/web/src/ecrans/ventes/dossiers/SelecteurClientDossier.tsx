import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClientResume } from '@dfa/shared';

import { Input } from '@/components/ui/input';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { useListeClients } from '@/hooks/clients/useListeClients';
import { cn } from '@/lib/utils';

const DELAI_DEBOUNCE_MS = 300;

interface Props {
  readonly valeur: string | null;
  readonly onChangeValeur: (clientId: string, client: ClientResume) => void;
  readonly libelle: string;
}

/**
 * Recherche client pour la création d'un dossier de vente (RV-29, design §6.1 : « recherche/
 * autocomplete client existant »). Aucun composant partagé équivalent n'existe encore côté
 * `composants/` (hors périmètre d'écriture de cet agent) : contrairement à ce que le design
 * suggérait (« composant déjà utilisé côté atelier »), l'atelier redirige en réalité vers
 * `/recherche` plutôt que d'embarquer un sélecteur inline (voir `EcranNouvelOrdreReparation.tsx`).
 * Ce composant reste donc LOCAL à ce sous-domaine — même doctrine que
 * `SelecteurVehiculeOrdre`/`SelecteurVehiculeStockDossier` : radiogroup de cartes `IdentiteClient`,
 * pas un `<select>` texte (le vendeur compare des numéros de client et des noms, pas des libellés).
 */
export function SelecteurClientDossier({ valeur, onChangeValeur, libelle }: Props) {
  const { t } = useTranslation(['ventes', 'commun']);
  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const requete = useListeClients({ q: q.trim() === '' ? undefined : q.trim() });
  const clients = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={libelle}
        placeholder={t('ventes:dossier.nouveau.client.rechercherPlaceholder')}
        value={qSaisie}
        onChange={(evenement) => setQSaisie(evenement.target.value)}
      />

      {q.trim() === '' ? null : requete.isPending ? (
        <EtatChargement lignes={2} />
      ) : clients.length === 0 ? (
        <EtatVide
          titre={t('ventes:dossier.nouveau.client.titre')}
          description={t('ventes:dossier.nouveau.client.aucun')}
        />
      ) : (
        <div role="radiogroup" aria-label={libelle} className="flex flex-col gap-2">
          {clients.map((client) => {
            const selectionne = client.id === valeur;
            return (
              <button
                key={client.id}
                type="button"
                role="radio"
                aria-checked={selectionne}
                onClick={() => onChangeValeur(client.id, client)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors',
                  selectionne ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted',
                )}
              >
                <IdentiteClient client={client} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
