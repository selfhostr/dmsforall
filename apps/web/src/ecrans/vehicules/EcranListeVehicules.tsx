import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import {
  TRI_DEFAUT_VEHICULES,
  TRIS_VEHICULES,
  type StatutVehicule,
  type VehiculeResume,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
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
import { BoutonCopier } from '@/composants/vehicule/BoutonCopier';
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
  const [q, setQ] = useState('');
  const [statut, setStatut] = useState<StatutVehicule | undefined>(undefined);
  const [importe, setImporte] = useState(false);
  const [tri, setTri] = useState<string>(TRI_DEFAUT_VEHICULES);

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

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
    setQSaisie('');
    setQ('');
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
            <BoutonCopier valeur={vehicule.vin} className="h-8 w-8" />
          </span>
        ) : null,
    },
  ];

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('vehicules:liste.titre')}
        description={t('vehicules:vide.recherche')}
      />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('vehicules:liste.titre')}
        description={t('vehicules:vide.filtre')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('vehicules:liste.titre')}
        description={t('vehicules:vide.nouveau')}
      />
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('vehicules:liste.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('vehicules:liste.titre')}</h1>
        <EtatErreur
          titre={t('vehicules:liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('vehicules:liste.titre')}</h1>

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

      <SelecteurTri
        options={TRIS_VEHICULES.map((valeur) => ({ valeur, libelle: t(CLES_TRI[valeur]) }))}
        valeur={tri}
        onChangeValeur={setTri}
        label={t('vehicules:liste.tri.label')}
        className="max-w-xs"
      />

      <TableComptoir
        colonnes={colonnes}
        lignes={vehicules}
        cleLigne={(vehicule) => vehicule.id}
        onOuvrirLigne={(vehicule) => navigate(chemins.vehicules.detail(vehicule.id, site))}
        contenuVide={contenuVide}
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />
    </div>
  );
}
