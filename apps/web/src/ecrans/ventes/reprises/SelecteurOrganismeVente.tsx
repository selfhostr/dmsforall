import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClientResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { useListeClients } from '@/hooks/clients/useListeClients';
import { cn } from '@/lib/utils';

const DELAI_ANTI_REBOND_MS = 300;

interface Props {
  readonly valeur: string | null;
  readonly onChangeValeur: (clientId: string, client: ClientResume) => void;
  readonly label: string;
  readonly obligatoire?: boolean;
  readonly erreur?: string;
}

/**
 * Sélection d'un client/tiers existant DÉJÀ connu de DFA — recherche par nom (`GET /clients?q=`),
 * même patron anti-rebond que `SelecteurVehiculeRepris`. Réutilisé par la reprise (organisme de la
 * dette de financement résiduelle, `RepriseResume.detteFinancementOrganismeId`) ET par le
 * financement (`ReponseFinancement.organisme`, obligatoire pour `credit`/`leasing`) — les deux
 * champs pointent la même notion de tiers (`ClientResume`), un seul composant plutôt que deux
 * quasi-doublons (même doctrine que `DialogueMotifCommandeFournisseur`).
 *
 * Composant partagé entre `ecrans/ventes/reprises/` et `ecrans/ventes/financements/` (les deux
 * périmètres d'écriture de cet agent) — importé par chemin relatif depuis `financements/`.
 */
export function SelecteurOrganismeVente({
  valeur,
  onChangeValeur,
  label,
  obligatoire = false,
  erreur,
}: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs']);
  const [saisie, setSaisie] = useState('');
  const [termeDebounce, setTermeDebounce] = useState('');

  useEffect(() => {
    const identifiant = window.setTimeout(
      () => setTermeDebounce(saisie.trim()),
      DELAI_ANTI_REBOND_MS,
    );
    return () => window.clearTimeout(identifiant);
  }, [saisie]);

  const requete = useListeClients({ q: termeDebounce, tri: 'nom:asc' });
  const clients = requete.data?.pages.flatMap((page) => page.donnees) ?? [];
  const rechercheActive = termeDebounce.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="organisme-vente-recherche" requis={obligatoire}>
        {label}
      </Label>
      <Input
        id="organisme-vente-recherche"
        placeholder={t('ventes:commun.organisme.rechercheClientPlaceholder')}
        value={saisie}
        onChange={(evenement) => setSaisie(evenement.target.value)}
        aria-invalid={erreur ? true : undefined}
        required={obligatoire}
      />

      {rechercheActive ? (
        requete.isLoading ? (
          <EtatChargement lignes={2} />
        ) : requete.isError ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(requete.error, t)}
          </p>
        ) : clients.length === 0 ? (
          <EtatVide titre={label} description={t('ventes:commun.organisme.aucunClientTrouve')} />
        ) : (
          <div className="flex flex-col gap-2">
            <div
              role="radiogroup"
              aria-label={label}
              aria-required={obligatoire || undefined}
              className="flex max-h-64 flex-col gap-2 overflow-y-auto"
            >
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
            <BoutonChargerPlus
              aChargerPlus={Boolean(requete.hasNextPage)}
              enChargement={requete.isFetchingNextPage}
              onChargerPlus={() => void requete.fetchNextPage()}
            />
          </div>
        )
      ) : null}

      {erreur ? (
        <p className="texte-libelle text-destructive" role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
