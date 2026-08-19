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
import {
  BasculeVueStock,
  lireVueAffichageStock,
  type VueAffichageStock,
} from './_composants/BasculeVueStock';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const vue = lireVueAffichageStock(searchParams);
  const affichage = lireAffichageStock(searchParams);

  function definirVue(valeur: VueAffichageStock) {
    const parametres = new URLSearchParams(searchParams);
    if (valeur === 'client') {
      parametres.set('vue', 'client');
    } else {
      parametres.delete('vue');
    }
    setSearchParams(parametres);
  }

  // Orthogonal à `vue` (confidentialité) : celui-ci choisit la MISE EN FORME, jamais les données —
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

  // Bouton « Fiche commerciale » d'une ligne (seule navigation OUVERTE par cet écran vers
  // `EcranFicheVehiculeStock`) : propage `?vue=client` pour que la bascule reste cohérente en
  // enchaînant liste -> fiche pendant qu'un client regarde encore l'écran. Le lien « voir la fiche
  // véhicule » de la fiche commerciale part vers un autre écran (`/vehicules/{id}`, hors périmètre
  // de ce module) qui n'a pas cette notion — pas propagé là.
  function cheminFicheCommerciale(id: string) {
    const base = chemins.ventes.stock.detail(id, site);
    return vue === 'client' ? `${base}${base.includes('?') ? '&' : '?'}vue=client` : base;
  }

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

  // Vue client (issue #84) : la provenance et le tri par ancienneté sont des dimensions RETIRÉES
  // de l'écran, pas des filtres qu'on continue d'appliquer en douce. La sélection du vendeur
  // (`provenance`/`tri`) reste en état telle quelle — seule la valeur EFFECTIVE (envoyée à l'API,
  // rendue dans les contrôles) est recalculée depuis `vue` ; revenir en vue vendeur la restaure
  // sans rien perdre.
  const provenanceActive = vue === 'client' ? undefined : provenance;
  const optionsTri =
    vue === 'client'
      ? TRIS_VEHICULES_STOCK.filter((valeur) => !valeur.startsWith('joursStock'))
      : TRIS_VEHICULES_STOCK;
  const triActif = (optionsTri as readonly string[]).includes(tri)
    ? tri
    : TRI_DEFAUT_VEHICULES_STOCK;

  const filtres = useMemo(
    () => ({
      q: q.trim() === '' ? undefined : q.trim(),
      siteId: site,
      provenance: provenanceActive === undefined ? undefined : [provenanceActive],
      statutCommercial: statutCommercial === undefined ? undefined : [statutCommercial],
      typeVehicule,
      tri: triActif,
    }),
    [q, site, provenanceActive, statutCommercial, typeVehicule, triActif],
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
    provenanceActive !== undefined || statutCommercial !== undefined || typeVehicule !== undefined;
  const filtresActifs = q.trim() !== '' || filtresStructuresActifs;

  function effacerFiltres() {
    setQSaisie('');
    setQ('');
    setProvenance(undefined);
    setStatutCommercial(undefined);
    setTypeVehicule(undefined);
  }

  // Colonnes retirées en vue client (issue #84), pas masquées derrière un clic : la provenance
  // (« c'est mon affaire, pas la sienne ») et les jours en stock (« si le client voit qu'une
  // voiture est là depuis trois mois, il négocie 2000 francs »). `identificationIncomplete` de
  // `IdentiteVehicule` est masqué de la même façon — la donnée n'est modifiée que dans l'objet
  // passé au composant partagé, jamais chez lui (hors périmètre d'écriture de cet écran).
  const toutesColonnes: ColonneComptoir<VehiculeStockResume>[] = [
    {
      id: 'vehicule',
      libelle: t('ventes:stock.liste.colonnes.vehicule'),
      rendu: (ligne) => (
        <IdentiteVehicule
          vehicule={
            vue === 'client'
              ? { ...ligne.vehicule, identificationIncomplete: false }
              : ligne.vehicule
          }
          taillePlaque="sm"
        />
      ),
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
      rendu: (ligne) => <BadgeStatutVehiculeStock statut={ligne.statutCommercial} />,
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

  const colonnesMasqueesVueClient = new Set(['provenance', 'joursStock']);
  const colonnes =
    vue === 'client'
      ? toutesColonnes.filter((colonne) => !colonnesMasqueesVueClient.has(colonne.id))
      : toutesColonnes;

  // « Mettre en stock » — seule ACTION de l'en-tête d'écran (retour @laupernoe du 17.08.2026 : « Vue
  // vendeur, Vue client, il faut le mettre ailleurs »). Construite AVANT les retours anticipés
  // chargement/erreur pour que l'en-tête garde EXACTEMENT la même composition entre les trois
  // états (même doctrine que `EcranSuiviVentes` pour ses onglets d'horizon) — le bouton ne dépend
  // pas des données de la requête, aucune raison de le faire apparaître/disparaître au chargement.
  // `undefined` (jamais un fragment vide) quand aucun bouton n'est proposé : un fragment vide
  // resterait un `actions` « vrai » pour `GabaritEcran`, qui rendrait alors une rangée d'en-tête
  // sans rien dedans — exactement la règle anti-trou de ce gabarit (voir son en-tête).
  //
  // `BasculeAffichageStock` (Liste/Plan) et `BasculeVueStock` (Vendeur/Client) ont QUITTÉ ce slot
  // (correctif « mise en page ventes », 19.08.2026 : « deux petits contrôles à droite créent un
  // grand bandeau blanc sur toute la largeur restante » — cette fiche n'a pas de titre visible,
  // « Véhicules en parc » doublonnant l'onglet actif, donc `actions` seul occupait toute la
  // rangée). Rejointes à la barre de filtres, où elles partagent la largeur avec les filtres et le
  // champ de recherche plutôt que de rester seules sur leur rangée — voir plus bas.
  const boutonMettreEnStock =
    peutEcrireVehiculeStock(role) && vue === 'vendeur' ? (
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
        action={
          peutEcrireVehiculeStock(role) && vue === 'vendeur' ? (
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
      <GabaritEcran titre={t('ventes:stock.liste.titre')} actions={boutonMettreEnStock}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('ventes:stock.liste.titre')} actions={boutonMettreEnStock}>
        <EtatErreur
          titre={t('ventes:stock.liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

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
    //
    // `BasculeVueStock`/`BasculeAffichageStock` ont quitté le slot `actions` du gabarit (correctif
    // « mise en page ventes », 19.08.2026, voir `boutonMettreEnStock` ci-dessus) pour rejoindre la
    // barre de filtres ci-dessous — visibles dans les DEUX modes d'affichage (`liste`/`plan`), donc
    // posées à côté de `BarreFiltres`, qui elle non plus ne dépend pas du mode. Le contenu commence
    // directement par cette rangée, remonté d'une rangée entière (retour @laupernoe du 17.08.2026,
    // « tu peux mettre plus haut le truc »).
    <GabaritEcran titre={t('ventes:stock.liste.titre')} actions={boutonMettreEnStock}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <BarreFiltres
          q={qSaisie}
          onChangeQ={setQSaisie}
          placeholderRecherche={t('ventes:stock.liste.rechercherPlaceholder')}
          filtresActifs={filtresActifs}
          onEffacerFiltres={effacerFiltres}
          className="min-w-0 flex-1"
        >
          {/* Libellés au-dessus des trois filtres RETIRÉS (correctif « mise en page ventes »,
              19.08.2026) : chaque `SelectTrigger` affiche déjà la valeur choisie en toutes lettres
              (« Tous les types », « VN », etc.) — un libellé fixe juste au-dessus ne faisait que
              répéter, en plus court, ce que le contrôle dit déjà, tout en consommant une ligne
              entière (`flex-col`) par filtre. `aria-label` déjà porté par chaque `SelectTrigger` :
              rien ne se perd pour un lecteur d'écran, qui annonce toujours le nom du filtre avant
              sa valeur. */}
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
          {vue === 'vendeur' ? (
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
          ) : null}
        </BarreFiltres>

        {/* Bascules Liste/Plan et Vendeur/Client (correctif « mise en page ventes », 19.08.2026) —
            groupées ici plutôt qu'isolées dans `actions` du gabarit : côte à côte avec la barre de
            filtres sur la même rangée, elles ne réservent plus de bande pleine largeur à elles
            deux. `shrink-0` : sur un poste étroit, cette rangée passe sous les filtres (`flex-wrap`
            du conteneur) plutôt que de compresser les bascules. */}
        <div className="flex shrink-0 items-center gap-2">
          <BasculeAffichageStock affichage={affichage} onChangeAffichage={definirAffichage} />
          <BasculeVueStock vue={vue} onChangeVue={definirVue} />
        </div>
      </div>

      {affichage === 'plan' ? (
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
          <SelecteurTri
            options={optionsTri.map((valeur) => ({ valeur, libelle: t(CLES_TRI[valeur]) }))}
            valeur={triActif}
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
        </>
      )}
    </GabaritEcran>
  );
}
