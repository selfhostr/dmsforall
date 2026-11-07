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
import { Button } from '@/components/ui/button';
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
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { FiltreSite } from '@/composants/commun/FiltreSite';
import { useFiltreSite } from '@/hooks/site/useFiltreSite';
import { useSession } from '@/hooks/useSession';
import { useListeVehiculesStock } from '@/hooks/ventes/stock/useListeVehiculesStock';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeStatutVehiculeStock } from './BadgeStatutVehiculeStock';
import {
  BasculeAffichageStock,
  lireAffichageStock,
  type AffichageStock,
} from './_composants/BasculeAffichageStock';
import { PlanParcVehicules } from './_composants/PlanParcVehicules';
import { peutEcrireVehiculeStock } from './droits';

const DELAI_DEBOUNCE_MS = 300;

const CLES_TRI: Record<(typeof TRIS_VEHICULES_STOCK)[number], string> = {
  'dateEntreeStock:desc': 'ventes:stock.liste.tri.dateEntreeStockDesc',
  'dateEntreeStock:asc': 'ventes:stock.liste.tri.dateEntreeStockAsc',
  'joursStock:desc': 'ventes:stock.liste.tri.joursStockDesc',
  'prixVenteAfficheCentimes:asc': 'ventes:stock.liste.tri.prixVenteAsc',
  'prixVenteAfficheCentimes:desc': 'ventes:stock.liste.tri.prixVenteDesc',
};

/**
 * Liste des véhicules en stock (RV-01→RV-14, priorité 4 du module) — `GET /vehicules-stock`,
 * recherche/tri/filtres, pagination par curseur. Même architecture que `EcranListeArticles`
 * (module pièces, le calque de patron le plus proche).
 *
 * DÉCISION DE NAVIGATION (déjà actée, voir docs/design-ecrans-ventes.md et le brief de livraison
 * de ce lot) : le clic sur une ligne ouvre `/vehicules/{id}` (fiche véhicule existante, étape
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
  const actions = session?.actions;

  const [searchParams, setSearchParams] = useSearchParams();
  // Filtre de site LOCAL (site principal par défaut, mémorisé par écran).
  const filtreSite = useFiltreSite('ventes.stock');
  const site = filtreSite.siteId;
  const affichage = lireAffichageStock(searchParams);

  // Choisit la MISE EN FORME (liste/plan), jamais les données —
  // voir la note d'en-tête de `BasculeAffichageStock`.
  function definirAffichage(valeur: AffichageStock) {
    const parametres = new URLSearchParams(searchParams);
    if (valeur === 'plan') {
      parametres.set('affichage', 'plan');
    } else {
      parametres.delete('affichage');
    }
    setSearchParams(parametres);
  }

  function cheminFicheCommerciale(id: string) {
    return chemins.ventes.stock.detail(id, site);
  }

  const [qSaisie, setQSaisie] = useState('');
  const [q, reinitialiserQ] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);
  const [provenance, setProvenance] = useState<string | undefined>(undefined);
  const [statutCommercial, setStatutCommercial] = useState<StatutCommercialVehicule | undefined>(
    undefined,
  );
  const [typeVehicule, setTypeVehicule] = useState<TypeVehiculeVente | undefined>(undefined);
  const [tri, setTri] = useState<string>(TRI_DEFAUT_VEHICULES_STOCK);

  const triActif = (TRIS_VEHICULES_STOCK as readonly string[]).includes(tri)
    ? tri
    : TRI_DEFAUT_VEHICULES_STOCK;

  const filtres = useMemo(
    () => ({
      q: q.trim() === '' ? undefined : q.trim(),
      siteId: site,
      provenance: provenance === undefined ? undefined : [provenance],
      statutCommercial: statutCommercial === undefined ? undefined : [statutCommercial],
      typeVehicule,
      tri: triActif,
    }),
    [q, site, provenance, statutCommercial, typeVehicule, triActif],
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

  // Vue Plan (issue #142) : « retrouver sa place exacte » exige TOUT le parc filtré, pas seulement
  // la première page de 50 — un véhicule garé au fond, jamais chargé, serait invisible du plan sans
  // qu'on sache qu'il manque. Récupère les pages restantes automatiquement tant que le mode Plan
  // est actif ; la vue Liste garde `BoutonChargerPlus` (comportement inchangé).
  useEffect(() => {
    if (affichage === 'plan' && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [affichage, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const planEnChargementComplet = affichage === 'plan' && (isFetchingNextPage || hasNextPage);

  const filtresStructuresActifs =
    provenance !== undefined || statutCommercial !== undefined || typeVehicule !== undefined;

  function effacerFiltres() {
    setQSaisie('');
    reinitialiserQ();
    setProvenance(undefined);
    setStatutCommercial(undefined);
    setTypeVehicule(undefined);
  }

  // Colonne Emplacement masquée tant qu'aucune ligne chargée n'en porte un (sinon une colonne de « — »).
  const afficherEmplacement = vehiculesStock.some((ligne) =>
    Boolean(ligne.vehicule.emplacementLibre),
  );

  const colonnesToutes: ColonneComptoir<VehiculeStockResume>[] = [
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
        <BadgeStatutVehiculeStock statut={ligne.statutCommercial} className="whitespace-nowrap" />
      ),
    },
    {
      id: 'joursStock',
      libelle: t('ventes:stock.liste.colonnes.joursStock'),
      alignement: 'droite',
      rendu: (ligne) => <span className="tabular-nums">{ligne.joursStock}</span>,
    },
    {
      // Issue #142 : colonne à faible coût de lecture, `emplacementLibre` est une colonne plate de
      // `vehicule` (VehiculeResume la porte déjà, @dfa/shared). Motif « non renseigné » explicite
      // plutôt qu'une cellule vide silencieuse (aucun signal visuel de rien-à-lire ne se distingue
      // d'une erreur de chargement) — même clé `ventes:commun.nonRenseigne` que
      // `CelluleGarantieSuivi`, cohérente avec le reste du module. L'édition ne vit PAS ici : la
      // liste reste une lecture rapide, elle se fait sur la fiche (`ChampEmplacementVehiculeStock`).
      id: 'emplacement',
      libelle: t('ventes:stock.liste.colonnes.emplacement'),
      rendu: (ligne) => (
        <span className="texte-corps text-muted-foreground">
          {ligne.vehicule.emplacementLibre ?? t('ventes:commun.nonRenseigne')}
        </span>
      ),
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
          onClick={() => navigate(cheminFicheCommerciale(ligne.id))}
        >
          {t('ventes:stock.liste.actions.ficheCommerciale')}
        </Button>
      ),
    },
  ];

  const colonnes = colonnesToutes.filter((c) => c.id !== 'emplacement' || afficherEmplacement);

  // « Mettre en stock » : à droite de la barre d'outils, indépendant des données de la requête.
  const boutonMettreEnStock = peutEcrireVehiculeStock(actions) ? (
    <Button onClick={() => navigate(chemins.ventes.stock.nouveau(site))}>
      {t('ventes:stock.liste.actions.mettreEnStock')}
    </Button>
  ) : undefined;

  // Titres d'état vide nommant l'ABSENCE (jamais « Véhicules en parc », qui répéterait l'onglet
  // actif/le menu — même défaut que celui corrigé le 17.08.2026 sur `EcranListeFactures.tsx`).
  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('ventes:stock.liste.vide.recherche.titre')}
        description={t('ventes:stock.liste.vide.recherche.description')}
      />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('ventes:stock.liste.vide.filtre.titre')}
        description={t('ventes:stock.liste.vide.filtre.description')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('ventes:stock.liste.vide.premierUsage.titre')}
        description={t('ventes:stock.liste.vide.premierUsage.description')}
      />
    );
  }

  // Un seul retour : la barre d'outils ne dépend d'aucune donnée de la requête, seul le contenu
  // dessous (chargement / erreur / plan / table) varie.
  return (
    // Titre MASQUÉ automatiquement — `ventes:stock.liste.titre` vaut désormais littéralement
    // « Véhicules en parc », IDENTIQUE à l'onglet actif « Véhicules en parc » (`navigation-modele.ts`,
    // `ONGLETS_VENTES`) une fois normalisé (§3 du contrat du chantier « titres doublés »,
    // 17.08.2026) — avant ce correctif le libellé était « Parc en stock » (mêmes deux mots, ordre
    // inversé), qui NE matchait PAS la règle mécanique d'inclusion du contrat et serait donc resté
    // visible à tort. Renommé plutôt que de poser `titreVisible={false}` (interdit par le contrat
    // §5.2, « ne jamais poser titreVisible pour être sûr ») : le texte, désormais identique à
    // l'allemand `stock.liste.titre`/`Fahrzeugbestand` qui matchait déjà son onglet par coïncidence,
    // fait tomber la détection automatique juste dans les trois langues.
    <GabaritEcran
      titre={t('ventes:stock.liste.titre')}
      actions={
        <>
          <BasculeAffichageStock affichage={affichage} onChangeAffichage={definirAffichage} />
          {boutonMettreEnStock}
        </>
      }
      barre={
        <div className="flex flex-wrap items-center gap-3">
          <BarreFiltres
            q={qSaisie}
            onChangeQ={setQSaisie}
            placeholderRecherche={t('ventes:stock.liste.rechercherPlaceholder')}
            className="min-w-0 flex-1 basis-[28rem]"
            tri={
              affichage === 'liste' ? (
                <SelecteurTri
                  options={TRIS_VEHICULES_STOCK.map((valeur) => ({
                    valeur,
                    libelle: t(CLES_TRI[valeur]),
                  }))}
                  valeur={triActif}
                  onChangeValeur={setTri}
                  label={t('ventes:stock.liste.tri.label')}
                />
              ) : undefined
            }
          >
            <FiltreSite filtre={filtreSite} />
            <Select
              value={typeVehicule ?? 'tous'}
              onValueChange={(valeur) =>
                setTypeVehicule(valeur === 'tous' ? undefined : (valeur as TypeVehiculeVente))
              }
            >
              <SelectTrigger
                id="filtre-type-vehicule"
                className="w-auto min-w-36 shrink-0"
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
                className="w-auto min-w-36 shrink-0"
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
            <Select
              value={provenance ?? 'toutes'}
              onValueChange={(valeur) => setProvenance(valeur === 'toutes' ? undefined : valeur)}
            >
              <SelectTrigger
                id="filtre-provenance"
                className="w-auto min-w-36 shrink-0"
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
          </BarreFiltres>
        </div>
      }
    >
      {isPending ? (
        <EtatChargement lignes={6} />
      ) : isError ? (
        <EtatErreur
          titre={t('ventes:stock.liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      ) : affichage === 'plan' ? (
        // Vue Plan (issue #142) : pas de tri ni de pagination manuelle — le regroupement par zone
        // remplace les deux (`planEnChargementComplet` couvre le chargement du reste des pages,
        // voir l'effet ci-dessus).
        planEnChargementComplet ? (
          <EtatChargement lignes={4} />
        ) : (
          <PlanParcVehicules
            vehiculesStock={vehiculesStock}
            onOuvrirVehicule={(id) => navigate(chemins.vehicules.detail(id, site))}
            libelleOuvrirVehicule={(ligne) =>
              t('commun:actions.ouvrirElement', { nom: ligne.vehicule.designation })
            }
            contenuVide={contenuVide}
          />
        )
      ) : (
        <>
          <TableComptoir
            className="min-w-[56rem]"
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
        </>
      )}
    </GabaritEcran>
  );
}
