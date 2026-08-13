import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseVehiculeStock } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// Import LECTURE SEULE depuis `hooks/vehicules/` (domaine véhicule, étape 1, hors périmètre
// d'écriture de ce sous-module) — hook prêt à l'emploi, importé tel quel, jamais modifié.
import { useModifierEmplacementVehicule } from '@/hooks/vehicules/useModifierEmplacementVehicule';
import { clesVentesStock } from '@/hooks/ventes/stock/cles';

const LONGUEUR_MAX_EMPLACEMENT = 60;

interface Props {
  readonly vehiculeId: string;
  readonly emplacement: string | null;
  /** `PATCH /vehicules/{id}` exige `vehicule.modifier` — droit DISTINCT de
   *  `ventes.vehicule_stock.modifier` qui gouverne le reste de cette fiche (voir
   *  `droits.ts::peutModifierVehiculeAssocie`, calculé par l'appelant). `false` retire le crayon,
   *  jamais un bouton désactivé. */
  readonly peutModifier: boolean;
}

/**
 * Édition en place de l'emplacement du véhicule (issue #142, migration `0044`) — même geste
 * « deux clics » (crayon, puis valider) que `composants/vehicule/ChampEmplacementVehicule.tsx`
 * (fiche véhicule technique, `ecrans/vehicules/`, HORS PÉRIMÈTRE d'écriture de ce sous-module :
 * réécrit ici plutôt qu'importé, faute d'un feu vert explicite pour lire dans `composants/vehicule/`
 * — seul `hooks/vehicules/**` est couvert par l'allocation de périmètre de cet agent). DOUBLON
 * SIGNALÉ au rapport de livraison : les deux composants partagent la même logique d'édition, un
 * futur ménage pourrait les fusionner derrière un composant commun si le périmètre est élargi.
 *
 * `emplacement` vient de `ReponseVehiculeStock.vehicule` (`VehiculeResume`, @dfa/shared) — cette
 * projection ne porte pas `emplacementMajLe` (réservé à la fiche véhicule complète), donc pas de
 * ligne « noté le » ici, contrairement au composant miroir ci-dessus.
 *
 * DÉFAUT CORRIGÉ AVANT LIVRAISON (constaté par le test bout en bout de ce composant) :
 * `useModifierEmplacementVehicule` écrit/invalide UNIQUEMENT le cache `vehicules.detail`/`.liste`
 * (hooks/vehicules/, hors périmètre) — la fiche stock lit un cache DIFFÉRENT
 * (`ventes.stock.detail`, `useVehiculeStock`), jamais invalidé par ce hook. Sans le
 * `setQueryData` explicite ci-dessous, l'écran affichait encore l'ancienne valeur après un
 * enregistrement réussi (seul un rechargement de page la corrigeait). Patch appliqué ICI, au
 * point d'appel du hook partagé — jamais dans le hook lui-même (hors périmètre d'écriture).
 */
export function ChampEmplacementVehiculeStock({ vehiculeId, emplacement, peutModifier }: Props) {
  const { t } = useTranslation(['ventes', 'commun']);
  const queryClient = useQueryClient();
  const mutation = useModifierEmplacementVehicule(vehiculeId);
  const [enEdition, setEnEdition] = useState(false);
  const [valeur, setValeur] = useState(emplacement ?? '');
  const champRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (enEdition) champRef.current?.focus();
  }, [enEdition]);

  function ouvrirEdition() {
    setValeur(emplacement ?? '');
    mutation.reset();
    setEnEdition(true);
  }

  function annuler() {
    setValeur(emplacement ?? '');
    mutation.reset();
    setEnEdition(false);
  }

  function enregistrer() {
    const nettoye = valeur.trim();
    const nouvelleValeur = nettoye === '' ? null : nettoye;
    // Échec serveur : l'édition reste OUVERTE avec la saisie intacte (aucune perte de saisie).
    mutation.mutate(nouvelleValeur, {
      onSuccess: async () => {
        // Voir la note d'en-tête du fichier : patch local du cache `ventes.stock.detail` (lu par
        // CETTE fiche, immédiat) + invalidation du PRÉFIXE `ventes.stock.liste` (la colonne
        // Emplacement de la liste, pas montée ici, se rafraîchira à la prochaine visite) — que le
        // hook partagé ne connaît pas.
        queryClient.setQueryData<ReponseVehiculeStock>(
          clesVentesStock.detail(vehiculeId),
          (actuel) =>
            actuel
              ? { ...actuel, vehicule: { ...actuel.vehicule, emplacementLibre: nouvelleValeur } }
              : actuel,
        );
        await queryClient.invalidateQueries({ queryKey: ['ventes', 'stock', 'liste'] });
        setEnEdition(false);
      },
    });
  }

  function gererClavier(evenement: KeyboardEvent<HTMLInputElement>) {
    if (evenement.key === 'Enter') {
      evenement.preventDefault();
      enregistrer();
    } else if (evenement.key === 'Escape') {
      evenement.preventDefault();
      annuler();
    }
  }

  if (!enEdition) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className="texte-libelle text-muted-foreground">
          {t('ventes:stock.champs.emplacement')} :
        </span>
        <span className="texte-corps font-medium">
          {emplacement ?? t('ventes:commun.nonRenseigne')}
        </span>
        {peutModifier ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={ouvrirEdition}
            aria-label={t('commun:actions.modifier')}
            title={t('commun:actions.modifier')}
          >
            <Pencil aria-hidden className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          ref={champRef}
          value={valeur}
          onChange={(evenement) => setValeur(evenement.target.value)}
          onKeyDown={gererClavier}
          maxLength={LONGUEUR_MAX_EMPLACEMENT}
          placeholder={t('ventes:stock.champs.emplacementPlaceholder')}
          aria-label={t('ventes:stock.champs.emplacement')}
          disabled={mutation.isPending}
          className="max-w-64"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={enregistrer}
          disabled={mutation.isPending}
          aria-label={t('commun:actions.enregistrer')}
          title={t('commun:actions.enregistrer')}
        >
          {mutation.isPending ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Check aria-hidden className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={annuler}
          disabled={mutation.isPending}
          aria-label={t('commun:actions.annuler')}
          title={t('commun:actions.annuler')}
        >
          <X aria-hidden className="h-4 w-4" />
        </Button>
      </div>
      {mutation.isError ? (
        <p role="alert" className="texte-libelle text-destructive">
          {messageErreur(mutation.error, t)}
        </p>
      ) : null}
    </div>
  );
}
