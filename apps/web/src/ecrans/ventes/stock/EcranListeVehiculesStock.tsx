import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import {
  PROVENANCES_VEHICULE_STOCK,
  STATUTS_COMMERCIAUX_VEHICULE,
  TRI_DEFAUT_VEHICULES_STOCK,
  TRIS_VEHICULES_STOCK,
  TYPES_VEHICULE_VENTE,
  type StatutCommercialVehicule,
  type TypeVehiculeVente,
  type VehiculeStockResume,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useSession } from '@/hooks/useSession';
import { useListeVehiculesStock } from '@/hooks/ventes/stock/useListeVehiculesStock';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { peutEcrireVehiculeStock } from './droits';

const DELAI_DEBOUNCE_MS = 300;

const CLES_TRI: Record<(typeof TRIS_VEHICULES_STOCK)[number], string> = {
  'dateEntreeStock:desc': 'ventes:stock.liste.tri.dateEntreeStockDesc',
  'dateEntreeStock:asc': 'ventes:stock.liste.tri.dateEntreeStockAsc',
  'joursStock:desc': 'ventes:stock.liste.tri.joursStockDesc',
  'prixVenteAfficheCentimes:asc': 'ventes:stock.liste.tri.prixVenteAsc',
  'prixVenteAfficheCentimes:desc': 'ventes:stock.liste.tri.prixVenteDesc',
};

/** `en_commande`/`reserve` restent des étapes transitoires (outline/secondary, discrets) ;
 *  `disponible` est l'état qui intéresse le vendeur au comptoir (default, mis en avant) ;
 *  `vendu`/`livre` sont des états terminaux (secondary, plus neutres qu'un badge d'action). */
const VARIANTE_BADGE_STATUT: Record<StatutCommercialVehicule, 'default' | 'secondary' | 'outline'> =
  {
    en_commande: 'outline',
    disponible: 'default',
    reserve: 'secondary',
    vendu: 'secondary',
    livre: 'secondary',
  };

/**
 * Liste des véhicules en stock (RV-01→RV-14, priorité 4 du module) — `GET /vehicules-stock`,
 * recherche/tri/filtres, pagination par curseur. Même architecture que `EcranListeArticles`
 * (module pièces, le calque de patron le plus proche).
 *
 * DÉCISION DE NAVIGATION (déjà actée, voir docs/design-ecrans-ventes.md et le brief de livraison
 * de cet agent) : le clic sur une ligne ouvre `/vehicules/{id}` (fiche véhicule existante, étape
 * 1 — `chemins.vehicules.detail`), PAS une fiche contrôlée par ce sous-module. La fiche
 * complémentaire `/ventes/stock/{id}` (`EcranFicheVehiculeStock`) reste accessible via un lien
 * dédié dans chaque ligne (colonne `actions`), pas au clic sur la ligne elle-même — un vendeur qui
 * clique une ligne veut d'abord voir LE véhicule, la fiche commerciale est un second geste
 * explicite.
 */
export function EcranListeVehiculesStock() {
  const { t } = useTranslation(['ventes', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  // Le site sélectionné est un paramètre de requête, jamais un état global (routes/chemins.ts) :
  // deux onglets sur deux sites différents ne doivent pas se contredire.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');
  const [provenance, setProvenance] = useState<string | undefined>(undefined);
  const [statutCommercial, setStatutCommercial] = useState<StatutCommercialVehicule | undefined>(
    undefined,
  );
  const [typeVehicule, setTypeVehicule] = useState<TypeVehiculeVente | undefined>(undefined);
  const [tri, setTri] = useState<string>(TRI_DEFAUT_VEHICULES_STOCK);

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const filtres = useMemo(
    () => ({
      q: q.trim() === '' ? undefined : q.trim(),
      siteId: site,
      provenance: provenance === undefined ? undefined : [provenance],
      statutCommercial: statutCommercial === undefined ? undefined : [statutCommercial],
      typeVehicule,
      tri,
    }),
    [q, site, provenance, statutCommercial, typeVehicule, tri],
  );

  const {
    vehiculesStock,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeVehiculesStock(filtres);

  const filtresStructuresActifs =
    provenance !== undefined || statutCommercial !== undefined || typeVehicule !== undefined;
  const filtresActifs = q.trim() !== '' || filtresStructuresActifs;

  function effacerFiltres() {
    setQSaisie('');
    setQ('');
    setProvenance(undefined);
    setStatutCommercial(undefined);
    setTypeVehicule(undefined);
  }

  const colonnes: ColonneComptoir<VehiculeStockResume>[] = [
    {
      id: 'vehicule',
      libelle: t('ventes:stock.liste.colonnes.vehicule'),
      rendu: (ligne) => <IdentiteVehicule vehicule={ligne.vehicule} taillePlaque="sm" />,
    },
    {
      id: 'type',
      libelle: t('ventes:stock.liste.colonnes.type'),
      rendu: (ligne) => t(`ventes:stock.types.${ligne.typeVehicule}`),
    },
    {
      id: 'provenance',
      libelle: t('ventes:stock.liste.colonnes.provenance'),
      rendu: (ligne) =>
        PROVENANCES_VEHICULE_STOCK.includes(
          ligne.provenance as (typeof PROVENANCES_VEHICULE_STOCK)[number],
        )
          ? t(`ventes:stock.provenances.${ligne.provenance}`)
          : ligne.provenance,
    },
    {
      id: 'statut',
      libelle: t('ventes:stock.liste.colonnes.statut'),
      rendu: (ligne) => (
        <Badge variant={VARIANTE_BADGE_STATUT[ligne.statutCommercial]}>
          {t(`ventes:stock.statuts.${ligne.statutCommercial}`)}
        </Badge>
      ),
    },
    {
      id: 'joursStock',
      libelle: t('ventes:stock.liste.colonnes.joursStock'),
      alignement: 'droite',
      rendu: (ligne) => <span className="tabular-nums">{ligne.joursStock}</span>,
    },
    {
      id: 'prix',
      libelle: t('ventes:stock.liste.colonnes.prixVente'),
      alignement: 'droite',
      rendu: (ligne) => (
        <span className="tabular-nums">
          {ligne.prixVenteAfficheCentimes === null
            ? t('ventes:stock.prixNonFixe')
            : formaterMontant(ligne.prixVenteAfficheCentimes)}
        </span>
      ),
    },
    {
      id: 'actions',
      libelle: '',
      actions: true,
      rendu: (ligne) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate(chemins.ventes.stock.detail(ligne.id, site))}
        >
          {t('ventes:stock.liste.actions.ficheCommerciale')}
        </Button>
      ),
    },
  ];

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('ventes:stock.liste.titre')}
        description={t('ventes:stock.liste.vide')}
      />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('ventes:stock.liste.titre')}
        description={t('ventes:stock.liste.vide')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('ventes:stock.liste.titre')}
        description={t('ventes:stock.liste.vide')}
        action={
          peutEcrireVehiculeStock(role) ? (
            <Button onClick={() => navigate(chemins.ventes.stock.nouveau(site))}>
              {t('ventes:stock.liste.actions.mettreEnStock')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('ventes:stock.liste.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('ventes:stock.liste.titre')}</h1>
        <EtatErreur
          titre={t('ventes:stock.liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('ventes:stock.liste.titre')}</h1>
        {peutEcrireVehiculeStock(role) ? (
          <Button onClick={() => navigate(chemins.ventes.stock.nouveau(site))}>
            {t('ventes:stock.liste.actions.mettreEnStock')}
          </Button>
        ) : null}
      </div>

      <BarreFiltres
        q={qSaisie}
        onChangeQ={setQSaisie}
        placeholderRecherche={t('ventes:stock.liste.rechercherPlaceholder')}
        filtresActifs={filtresActifs}
        onEffacerFiltres={effacerFiltres}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-type-vehicule">{t('ventes:stock.champs.typeVehicule')}</Label>
          <Select
            value={typeVehicule ?? 'tous'}
            onValueChange={(valeur) =>
              setTypeVehicule(valeur === 'tous' ? undefined : (valeur as TypeVehiculeVente))
            }
          >
            <SelectTrigger
              id="filtre-type-vehicule"
              className="w-[140px]"
              aria-label={t('ventes:stock.champs.typeVehicule')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('ventes:stock.filtres.typeTous')}</SelectItem>
              {TYPES_VEHICULE_VENTE.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`ventes:stock.types.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-statut-commercial">
            {t('ventes:stock.champs.statutCommercial')}
          </Label>
          <Select
            value={statutCommercial ?? 'tous'}
            onValueChange={(valeur) =>
              setStatutCommercial(
                valeur === 'tous' ? undefined : (valeur as StatutCommercialVehicule),
              )
            }
          >
            <SelectTrigger
              id="filtre-statut-commercial"
              className="w-[180px]"
              aria-label={t('ventes:stock.champs.statutCommercial')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('ventes:stock.filtres.statutTous')}</SelectItem>
              {STATUTS_COMMERCIAUX_VEHICULE.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`ventes:stock.statuts.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-provenance">{t('ventes:stock.champs.provenance')}</Label>
          <Select
            value={provenance ?? 'toutes'}
            onValueChange={(valeur) => setProvenance(valeur === 'toutes' ? undefined : valeur)}
          >
            <SelectTrigger
              id="filtre-provenance"
              className="w-[200px]"
              aria-label={t('ventes:stock.champs.provenance')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="toutes">{t('ventes:stock.filtres.provenanceToutes')}</SelectItem>
              {PROVENANCES_VEHICULE_STOCK.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`ventes:stock.provenances.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BarreFiltres>

      <SelecteurTri
        options={TRIS_VEHICULES_STOCK.map((valeur) => ({ valeur, libelle: t(CLES_TRI[valeur]) }))}
        valeur={tri}
        onChangeValeur={setTri}
        label={t('ventes:stock.liste.tri.label')}
        className="max-w-xs"
      />

      <TableComptoir
        colonnes={colonnes}
        lignes={vehiculesStock}
        cleLigne={(ligne) => ligne.id}
        onOuvrirLigne={(ligne) => navigate(chemins.vehicules.detail(ligne.id, site))}
        libelleLigne={(ligne) =>
          t('commun:actions.ouvrirElement', { nom: ligne.vehicule.designation })
        }
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
