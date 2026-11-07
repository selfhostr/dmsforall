import { Plus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import {
  TRI_DEFAUT_VEHICULES,
  TRIS_VEHICULES,
  type StatutVehicule,
  type VehiculeResume,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { SelecteurTri } from '@/composants/comptoir/SelecteurTri';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { BoutonCopier } from '@/composants/vehicule/BoutonCopier';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useListeVehicules } from '@/hooks/vehicules/useListeVehicules';
import { chemins } from '@/routes/chemins';

const DELAI_DEBOUNCE_MS = 300;

/** `<champ>:<asc|desc>` -> suffixe de clé i18n. Explicite plutôt que dérivé par manipulation de
 *  chaîne : une liste fermée (`TRIS_VEHICULES`, @dfa/shared) mérite un mapping fermé et lisible. */
const CLES_TRI: Record<(typeof TRIS_VEHICULES)[number], string> = {
  'plaque:asc': 'vehicules:liste.tri.plaqueAsc',
  'plaque:desc': 'vehicules:liste.tri.plaqueDesc',
  'creeLe:desc': 'vehicules:liste.tri.creeLeDesc',
  'prochaineExpertiseLe:asc': 'vehicules:liste.tri.prochaineExpertiseLeAsc',
};

/** Liste des véhicules du tenant — recherche, tri, filtres statut/importé, pagination par
 *  curseur (`BoutonChargerPlus`). Trois états obligatoires (chargement/vide/erreur), en plus des
 *  trois variantes de vide établies par le comptoir (recherche/filtre/premier usage). */
export function EcranListeVehicules() {
  const { t } = useTranslation(['vehicules', 'commun']);
  const navigate = useNavigate();
  // Le site sélectionné est un paramètre de requête, jamais un état global (routes/chemins.ts) :
  // deux onglets sur deux sites différents ne doivent pas se contredire.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const [qSaisie, setQSaisie] = useState('');
  const [q, reinitialiserQ] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);
  const [statut, setStatut] = useState<StatutVehicule | undefined>(undefined);
  const [importe, setImporte] = useState(false);
  const [tri, setTri] = useState<string>(TRI_DEFAUT_VEHICULES);

  const filtres = useMemo(
    () => ({
      q: q.trim() === '' ? undefined : q.trim(),
      statut,
      importe: importe || undefined,
      siteId: site,
      tri,
    }),
    [q, statut, importe, site, tri],
  );

  const {
    vehicules,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeVehicules(filtres);

  const filtresStructuresActifs = statut !== undefined || importe;
  const filtresActifs = q.trim() !== '' || filtresStructuresActifs;

  function effacerFiltres() {
    // Levier de reset (choix produit 26.08.2026) : `effacerFiltres` est un geste de reprise en
    // main, pas une frappe — `q` doit refléter la case vide immédiatement, pas après le même
    // délai qu'une recherche (voir le commentaire de `useValeurDebouncee`, `hooks/commun/`).
    setQSaisie('');
    reinitialiserQ();
    setStatut(undefined);
    setImporte(false);
  }

  const colonnes: ColonneComptoir<VehiculeResume>[] = [
    {
      id: 'vehicule',
      libelle: t('vehicules:liste.colonnes.vehicule'),
      rendu: (vehicule) => <IdentiteVehicule vehicule={vehicule} taillePlaque="sm" />,
    },
    {
      id: 'vin',
      libelle: t('vehicules:liste.colonnes.vin'),
      rendu: (vehicule) =>
        vehicule.vin ? (
          <span className="flex items-center gap-1 font-mono texte-libelle text-muted-foreground">
            {vehicule.vin}
            <BoutonCopier valeur={vehicule.vin} />
          </span>
        ) : null,
    },
    {
      // Colonne à faible coût de lecture : `emplacementLibre` est une colonne plate de `vehicule`
      // (VehiculeResume la porte déjà, voir @dfa/shared) — un champ vide reste un rendu vide,
      // jamais un tiret ni une alarme (même convention que la colonne VIN ci-dessus). L'édition ne
      // vit PAS ici : la liste reste une lecture rapide, la modification se fait sur la fiche
      // (`ChampEmplacementVehicule`, deux clics) où le geste est réellement fait au comptoir.
      id: 'emplacement',
      libelle: t('vehicules:liste.colonnes.emplacement'),
      rendu: (vehicule) =>
        vehicule.emplacementLibre ? (
          <span className="texte-corps text-muted-foreground">{vehicule.emplacementLibre}</span>
        ) : null,
    },
  ];

  // Titres d'état vide nommant l'ABSENCE (jamais « Véhicules », qui répéterait l'onglet actif/le
  // menu — même défaut que celui corrigé le 17.08.2026 sur `EcranListeFactures.tsx`). Les textes
  // d'absence vivaient déjà, à tort, dans `description` — inversion corrigée ici.
  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('vehicules:vide.recherche.titre')}
        description={t('vehicules:vide.recherche.description')}
      />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('vehicules:vide.filtre.titre')}
        description={t('vehicules:vide.filtre.description')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('vehicules:vide.nouveau.titre')}
        description={t('vehicules:vide.nouveau.description')}
      />
    );
  }

  if (isPending) {
    return (
      <GabaritEcran titre={t('vehicules:liste.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('vehicules:liste.titre')}>
        <EtatErreur
          titre={t('vehicules:liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  // Titre laissé à la détection automatique du gabarit (chantier « titres doublés &
  // espacements », 17.08.2026) : l'onglet actif « Véhicules » affiche déjà ce libellé — défaut
  // cité nommément par @laupernoe (« dans Clients et véhicules, l'onglet Véhicules, tu vois, c'est
  // vraiment écrit "Véhicules", ça ne sert à rien ») — le h1 devient `sr-only` (jamais retiré du
  // DOM). « Nouveau véhicule » n'est PAS passé en `actions` de `GabaritEcran` (qui le placerait
  // juste sous le titre, seul sur sa ligne, et décalerait tout le reste) : il rejoint la ligne
  // « Trier par », à droite — même déplacement que l'écran de référence (Atelier).
  return (
    <GabaritEcran titre={t('vehicules:liste.titre')}>
      <BarreFiltres
        q={qSaisie}
        onChangeQ={setQSaisie}
        filtresActifs={filtresActifs}
        onEffacerFiltres={effacerFiltres}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-statut">{t('vehicules:liste.filtres.statut')}</Label>
          <Select
            value={statut ?? 'tous'}
            onValueChange={(valeur) =>
              setStatut(valeur === 'tous' ? undefined : (valeur as StatutVehicule))
            }
          >
            <SelectTrigger
              id="filtre-statut"
              className="w-[180px]"
              aria-label={t('vehicules:liste.filtres.statut')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('vehicules:liste.filtres.statutTous')}</SelectItem>
              <SelectItem value="actif">{t('vehicules:liste.filtres.statuts.actif')}</SelectItem>
              <SelectItem value="archive">
                {t('vehicules:liste.filtres.statuts.archive')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex h-11 items-center gap-2 texte-corps">
          <Checkbox checked={importe} onCheckedChange={(coche) => setImporte(coche === true)} />
          {t('vehicules:liste.filtres.importe')}
        </label>
      </BarreFiltres>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelecteurTri
          options={TRIS_VEHICULES.map((valeur) => ({ valeur, libelle: t(CLES_TRI[valeur]) }))}
          valeur={tri}
          onChangeValeur={setTri}
          label={t('vehicules:liste.tri.label')}
          className="max-w-xs"
        />
        <Button asChild>
          <Link to={chemins.vehicules.nouveau(site)}>
            <Plus aria-hidden className="h-4 w-4" />
            {t('vehicules:nouveau')}
          </Link>
        </Button>
      </div>

      <TableComptoir
        colonnes={colonnes}
        lignes={vehicules}
        cleLigne={(vehicule) => vehicule.id}
        onOuvrirLigne={(vehicule) => navigate(chemins.vehicules.detail(vehicule.id, site))}
        // `plaque` peut être `null` (identification incomplète, voir `VehiculeResume`) : repli sur
        // `designation` (toujours renseignée) plutôt qu'un nom accessible vide ou générique.
        libelleLigne={(vehicule) =>
          t('commun:actions.ouvrirElement', { nom: vehicule.plaque ?? vehicule.designation })
        }
        contenuVide={contenuVide}
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />
    </GabaritEcran>
  );
}
