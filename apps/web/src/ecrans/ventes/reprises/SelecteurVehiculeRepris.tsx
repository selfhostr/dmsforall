import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VehiculeResume } from '@dfa/shared';

import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCleIdempotence } from '@/api/idempotence';
import { useCreerVehicule } from '@/hooks/vehicules/useCreerVehicule';
import { useListeVehicules } from '@/hooks/vehicules/useListeVehicules';
import { messageErreur } from '@/api/erreurs';
import { cn } from '@/lib/utils';

const DELAI_ANTI_REBOND_MS = 300;

interface Props {
  readonly valeur: string | null;
  readonly onChangeValeur: (vehiculeId: string, vehicule: VehiculeResume) => void;
  readonly erreur?: string;
}

/**
 * Sélection du véhicule repris — recherche d'abord parmi les véhicules DÉJÀ connus de DFA par
 * plaque/désignation (`GET /vehicules?q=`), même patron de recherche anti-rebond que
 * `useRechercheComptoir` (300ms), rendu radiogroup identique à
 * `ecrans/atelier/SelecteurVehiculeOrdre.tsx` (invariant n°1, `IdentiteVehicule`).
 *
 * Cas fréquent (§8.1 du design : « référence à un véhicule existant OU nouvellement créé ») :
 * un client apporte une voiture jamais vue par le garage. Quand la recherche ne remonte rien,
 * l'état vide propose un petit formulaire de création à la volée (`POST /vehicules` via
 * `useCreerVehicule`, importé tel quel — module véhicules, module étape 1) avec les seuls champs
 * obligatoires du contrat (marque, modèle), plaque en option. Le véhicule créé est sélectionné
 * automatiquement, exactement comme un résultat de recherche normal — `onChangeValeur` ne
 * distingue pas les deux origines.
 */
export function SelecteurVehiculeRepris({ valeur, onChangeValeur, erreur }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs', 'vehicules', 'validation']);
  const [saisie, setSaisie] = useState('');
  const [termeDebounce, setTermeDebounce] = useState('');

  useEffect(() => {
    const identifiant = window.setTimeout(
      () => setTermeDebounce(saisie.trim()),
      DELAI_ANTI_REBOND_MS,
    );
    return () => window.clearTimeout(identifiant);
  }, [saisie]);

  const rechercheActive = termeDebounce.length > 0;
  // `enabled: rechercheActive` — pas de requête pour toute la première page au montage tant que la
  // recherche est vide, alors que l'UI la masque de toute façon (indication seule, ci-dessous).
  // Même garde que `useVehiculesStockDisponibles`.
  const requete = useListeVehicules(
    { q: termeDebounce, tri: 'plaque:asc' },
    { enabled: rechercheActive },
  );

  // Création à la volée (§8.1, cas « véhicule jamais vu par le garage ») — état local distinct de
  // la recherche : une clé d'idempotence par ouverture du mini-formulaire, régénérée après succès,
  // même contrat que `useCreerClient`/`DialogueCreationFinancement` (un rejeu ne doit jamais créer
  // deux fiches).
  const [creationOuverte, setCreationOuverte] = useState(false);
  const [nouvelleMarque, setNouvelleMarque] = useState('');
  const [nouveauModele, setNouveauModele] = useState('');
  const [nouvellePlaque, setNouvellePlaque] = useState('');
  const [erreursCreation, setErreursCreation] = useState<Record<string, string>>({});
  const idempotenceCreation = useCleIdempotence();
  const creerVehicule = useCreerVehicule();

  function ouvrirCreation() {
    creerVehicule.reset();
    setErreursCreation({});
    setCreationOuverte(true);
  }

  function annulerCreation() {
    creerVehicule.reset();
    setErreursCreation({});
    setNouvelleMarque('');
    setNouveauModele('');
    setNouvellePlaque('');
    setCreationOuverte(false);
  }

  function soumettreCreationVehicule() {
    const marque = nouvelleMarque.trim();
    const modele = nouveauModele.trim();
    const erreurs: Record<string, string> = {};
    if (!marque) erreurs.marque = t('validation:requis');
    if (!modele) erreurs.modele = t('validation:requis');
    setErreursCreation(erreurs);
    if (Object.keys(erreurs).length > 0) return;

    const plaque = nouvellePlaque.trim();
    creerVehicule.mutate(
      {
        entree: { marque, modele, importe: false, plaque: plaque === '' ? undefined : plaque },
        idempotencyKey: idempotenceCreation.cle,
      },
      {
        onSuccess: (reponse) => {
          idempotenceCreation.regenerer();
          onChangeValeur(reponse.donnees.id, reponse.donnees);
          setNouvelleMarque('');
          setNouveauModele('');
          setNouvellePlaque('');
          setErreursCreation({});
          setCreationOuverte(false);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="reprise-vehicule-recherche" requis>
        {t('ventes:reprise.creation.champVehicule')}
      </Label>
      <Input
        id="reprise-vehicule-recherche"
        placeholder={t('ventes:reprise.creation.champVehiculePlaceholder')}
        value={saisie}
        onChange={(evenement) => setSaisie(evenement.target.value)}
        aria-invalid={erreur ? true : undefined}
        required
      />

      {!rechercheActive ? (
        <p className="texte-libelle text-muted-foreground">
          {t('ventes:reprise.creation.champVehiculeIndication')}
        </p>
      ) : requete.isLoading ? (
        <EtatChargement lignes={2} />
      ) : requete.isError ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(requete.error, t)}
        </p>
      ) : requete.vehicules.length === 0 ? (
        <div className="flex flex-col gap-3">
          <EtatVide
            titre={t('ventes:reprise.creation.champVehicule')}
            description={t('ventes:reprise.creation.aucunVehiculeTrouve')}
            action={
              creationOuverte ? undefined : (
                <Button type="button" variant="outline" onClick={ouvrirCreation}>
                  {t('ventes:reprise.creation.creerVehiculeBouton')}
                </Button>
              )
            }
          />

          {/* DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : mini-formulaire à part
           *  entière (marque/modèle/plaque + ses propres boutons Annuler/Créer), pas un simple
           *  regroupement de champs statiques. */}
          {creationOuverte ? (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <p className="texte-libelle text-muted-foreground">
                {t('ventes:reprise.creation.creerVehiculeAide')}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reprise-vehicule-nouveau-marque" requis>
                    {t('vehicules:identite.marque')}
                  </Label>
                  <Input
                    id="reprise-vehicule-nouveau-marque"
                    value={nouvelleMarque}
                    onChange={(evenement) => setNouvelleMarque(evenement.target.value)}
                    aria-invalid={erreursCreation.marque ? true : undefined}
                    disabled={creerVehicule.isPending}
                    required
                  />
                  {erreursCreation.marque ? (
                    <p className="texte-libelle text-destructive" role="alert">
                      {erreursCreation.marque}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reprise-vehicule-nouveau-modele" requis>
                    {t('vehicules:identite.modele')}
                  </Label>
                  <Input
                    id="reprise-vehicule-nouveau-modele"
                    value={nouveauModele}
                    onChange={(evenement) => setNouveauModele(evenement.target.value)}
                    aria-invalid={erreursCreation.modele ? true : undefined}
                    disabled={creerVehicule.isPending}
                    required
                  />
                  {erreursCreation.modele ? (
                    <p className="texte-libelle text-destructive" role="alert">
                      {erreursCreation.modele}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reprise-vehicule-nouveau-plaque">
                  {t('vehicules:identite.plaque')}
                </Label>
                <Input
                  id="reprise-vehicule-nouveau-plaque"
                  value={nouvellePlaque}
                  onChange={(evenement) => setNouvellePlaque(evenement.target.value)}
                  disabled={creerVehicule.isPending}
                />
              </div>

              {creerVehicule.isError ? (
                <p className="texte-libelle text-destructive" role="alert">
                  {messageErreur(creerVehicule.error, t)}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={annulerCreation}
                  disabled={creerVehicule.isPending}
                >
                  {t('commun:actions.annuler')}
                </Button>
                <Button
                  type="button"
                  onClick={soumettreCreationVehicule}
                  disabled={creerVehicule.isPending}
                >
                  {creerVehicule.isPending
                    ? t('commun:chargement.enCours')
                    : t('ventes:reprise.creation.creerVehiculeSoumettre')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="radiogroup"
            aria-label={t('ventes:reprise.creation.champVehicule')}
            aria-required="true"
            className="flex max-h-64 flex-col gap-2 overflow-y-auto"
          >
            {/* DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : contrôle de saisie
             *  (`role="radio"`), pas un groupe de contenu — voir `SelecteurClientDossier.tsx`. */}
            {requete.vehicules.map((vehicule) => {
              const selectionne = vehicule.id === valeur;
              return (
                <button
                  key={vehicule.id}
                  type="button"
                  role="radio"
                  aria-checked={selectionne}
                  onClick={() => onChangeValeur(vehicule.id, vehicule)}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors anneau-focus',
                    selectionne ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted',
                  )}
                >
                  <IdentiteVehicule vehicule={vehicule} taillePlaque="sm" />
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
      )}

      {erreur ? (
        <p className="texte-libelle text-destructive" role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
