import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { VehiculeResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { listerVehicules } from '@/hooks/vehicules/vehicules.api';
import { chemins } from '@/routes/chemins';

const DELAI_DEBOUNCE_MS = 300;
const LIMITE_RESULTATS = 20;

interface Props {
  readonly onChoisir: (vehicule: VehiculeResume) => void;
}

/**
 * Recherche parmi les véhicules EXISTANTS du tenant (`GET /vehicules`, réutilise `listerVehicules`
 * — `hooks/vehicules/vehicules.api.ts`, module étape 1, importé en LECTURE seule, jamais modifié
 * dans ce périmètre) — première étape de l'écran « entrée en stock » (`EcranEntreeEnStock`) :
 * `POST /vehicules/{id}/stock` RÉFÉRENCE un véhicule déjà créé, ce n'est jamais un formulaire de
 * création de véhicule. Un besoin non couvert (VN en commande jamais saisi) est signalé par le
 * lien vers `chemins.vehicules.nouveau()` (route existante).
 *
 * Résultat borné (20), non paginé — un magasinier/vendeur qui tape 3 lettres de plaque doit voir
 * une poignée de correspondances, jamais une liste à faire défiler au comptoir.
 */
export function SelecteurVehiculeExistant({ onChoisir }: Props) {
  const { t } = useTranslation(['ventes', 'commun']);
  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const requete = useQuery({
    queryKey: ['ventes', 'stock', 'rechercheVehiculeExistant', q],
    queryFn: () =>
      listerVehicules({ q, statut: 'actif', tri: 'creeLe:desc' }, { limite: LIMITE_RESULTATS }),
    enabled: q.trim() !== '',
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Input
          type="search"
          placeholder={t('ventes:stock.entree.rechercherVehiculePlaceholder')}
          aria-label={t('ventes:stock.entree.rechercherVehiculePlaceholder')}
          value={qSaisie}
          onChange={(evenement) => setQSaisie(evenement.target.value)}
        />
        <p className="texte-libelle text-muted-foreground">
          {t('ventes:stock.entree.vehiculeIntrouvable')}{' '}
          <Link
            to={chemins.vehicules.nouveau()}
            className="text-primary underline-offset-4 hover:underline"
          >
            {t('ventes:stock.entree.creerVehicule')}
          </Link>
        </p>
      </div>

      {q.trim() === '' ? null : requete.isPending ? (
        <EtatChargement lignes={3} />
      ) : requete.isError ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(requete.error, t)}
        </p>
      ) : requete.data.donnees.length === 0 ? (
        <EtatVide
          titre={t('ventes:stock.entree.aucunVehiculeTitre')}
          description={t('ventes:stock.entree.aucunVehiculeDescription')}
        />
      ) : (
        /* DESIGN.md « bordure structurelle uniquement » — bordure RETIRÉE : chaque résultat de
         *  recherche était encadré individuellement (un cadre par ligne), or la ligne elle-même
         *  n'est pas cliquable — seul le bouton « choisir » l'est. C'était donc un cadre autour
         *  d'un groupe de contenu, pas autour d'une zone d'action. Filet horizontal seul
         *  (`divide-y`), même patron que les listes de `components/ui/table.tsx` et que
         *  l'historique de `financements/CarteFinancement.tsx`. */
        <ul className="flex flex-col divide-y">
          {requete.data.donnees.map((vehicule) => (
            <li key={vehicule.id} className="flex items-center justify-between gap-3 py-3">
              <IdentiteVehicule vehicule={vehicule} taillePlaque="sm" />
              <Button type="button" variant="outline" onClick={() => onChoisir(vehicule)}>
                {t('ventes:stock.entree.choisirVehicule')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
