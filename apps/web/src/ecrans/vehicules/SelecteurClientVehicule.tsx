import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClientResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Input } from '@/components/ui/input';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { useListeClients } from '@/hooks/clients/useListeClients';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { cn } from '@/lib/utils';

const DELAI_DEBOUNCE_MS = 300;

interface Props {
  readonly valeur: string | null;
  readonly onChangeValeur: (clientId: string, client: ClientResume) => void;
  readonly libelle: string;
  /** Le sélecteur — pas la recherche — porte la contrainte : c'est le groupe de cartes
   *  sélectionnables qui doit être rempli avant soumission, pas le texte tapé pour le filtrer.
   *  Aucune carte `role="radio"` isolée ne peut porter `aria-required` (la contrainte porte sur
   *  l'ENSEMBLE), posé ici sur le `role="radiogroup"`, même patron que `OngletContacts.tsx`
   *  (`role="group"` + `aria-required`) pour un groupe sans contrôle natif unique. */
  readonly requis?: boolean;
}

/**
 * Recherche + sélection d'un client, pour `DialogueRattacherClient` (rattacher un véhicule à un
 * client, ou lui en changer, depuis la fiche véhicule). Même patron que `SelecteurClientDossier`
 * (`ecrans/ventes/dossiers/`, hors périmètre d'écriture ici) — copié plutôt qu'importé, même
 * doctrine que ce composant-là vis-à-vis d'un composant partagé qui n'existe pas encore côté
 * `composants/` : radiogroup de cartes `IdentiteClient`, pas un `<select>` texte, un garagiste au
 * comptoir compare des noms et des numéros de client, pas des libellés.
 */
export function SelecteurClientVehicule({ valeur, onChangeValeur, libelle, requis }: Props) {
  const { t } = useTranslation(['vehicules', 'commun', 'erreurs']);
  const [qSaisie, setQSaisie] = useState('');
  const [q] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);

  const rechercheActive = q.trim() !== '';
  // `enabled: rechercheActive` — pas de requête pour toute la première page au montage tant que la
  // recherche est vide (l'UI la masque de toute façon ci-dessous), même garde que
  // `SelecteurClientDossier`.
  const requete = useListeClients(
    { q: rechercheActive ? q.trim() : undefined },
    { enabled: rechercheActive },
  );
  const clients = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={libelle}
        placeholder={t('vehicules:detentions.dialogue.rechercherPlaceholder')}
        value={qSaisie}
        onChange={(evenement) => setQSaisie(evenement.target.value)}
      />

      {!rechercheActive ? null : requete.isPending ? (
        <EtatChargement lignes={2} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t(
            requete.error instanceof ErreurReseau
              ? 'erreurs:reseau.titre'
              : 'erreurs:inattendue.titre',
          )}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : clients.length === 0 ? (
        <EtatVide titre={libelle} description={t('vehicules:detentions.dialogue.aucunClient')} />
      ) : (
        <div
          role="radiogroup"
          aria-label={libelle}
          aria-required={requis ? 'true' : undefined}
          className="flex max-h-64 flex-col gap-2 overflow-y-auto"
        >
          {clients.map((client) => {
            const selectionne = client.id === valeur;
            return (
              // Bordure structurelle : contrôle de sélection (role="radio"), pas un simple
              // groupe de contenu.
              <button
                key={client.id}
                type="button"
                role="radio"
                aria-checked={selectionne}
                onClick={() => onChangeValeur(client.id, client)}
                className={cn(
                  'anneau-focus flex items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors',
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
