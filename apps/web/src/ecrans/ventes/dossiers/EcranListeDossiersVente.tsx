import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import {
  STATUTS_DOSSIER_VENTE,
  TRI_DEFAUT_DOSSIERS_VENTE,
  TRIS_DOSSIERS_VENTE,
  type ReponseDossierVente,
  type StatutDossierVente,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { FiltreSite } from '@/composants/commun/FiltreSite';
import { useFiltreSite } from '@/hooks/site/useFiltreSite';
import { useListeDossiersVente } from '@/hooks/ventes/dossiers/useListeDossiersVente';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeStatutDossierVente } from './BadgeStatutDossierVente';
import { peutEcrireDossierVente } from './droits';

const DELAI_DEBOUNCE_MS = 300;

/** Statuts « actifs » — défaut du filtre (design §6 : « masquer clos/annule/abandonne, un dossier
 *  terminé n'est plus une tâche active », même logique que le parc en stock §5.1). Appliqué quand
 *  `filtreStatut === 'tous'` ET `afficherTermines === false` — voir `ventes:dossier.liste.filtres.
 *  afficherTermines`, la case à cocher qui lève ce filtre implicite. */
const STATUTS_ACTIFS = STATUTS_DOSSIER_VENTE.filter(
  (s) => s !== 'clos' && s !== 'annule' && s !== 'abandonne',
);

type FiltreStatut = 'tous' | StatutDossierVente;

const CLES_TRI: Record<(typeof TRIS_DOSSIERS_VENTE)[number], string> = {
  'prospectionLe:desc': 'ventes:dossier.liste.tri.prospectionLeDesc',
  'prospectionLe:asc': 'ventes:dossier.liste.tri.prospectionLeAsc',
  'dateLivraisonEstimee:asc': 'ventes:dossier.liste.tri.dateLivraisonEstimeeAsc',
  'dateLivraisonEstimee:desc': 'ventes:dossier.liste.tri.dateLivraisonEstimeeDesc',
};

const CLES_STATUT: Record<StatutDossierVente, string> = {
  prospection: 'prospection',
  engage: 'engage',
  en_preparation: 'enPreparation',
  pret_a_livrer: 'pretALivrer',
  livre: 'livre',
  clos: 'clos',
  annule: 'annule',
  abandonne: 'abandonne',
};

/**
 * Liste des dossiers de vente (design §6) — recherche (`q`, porte sur le nom client et la
 * plaque/désignation véhicule), filtre statut (défaut : masque clos/annule/abandonne, case
 * « afficher aussi… » pour les révéler), tri (`prospectionLe`/`dateLivraisonEstimee`), pagination
 * par curseur. Colonnes (`ventes:dossier.liste.colonnes.*`, à la lettre) : client, véhicule,
 * statut, date de livraison estimée.
 *
 * ÉCARTS SIGNALÉS AVEC LE BRIEF (à lire, pas des omissions silencieuses) :
 *  1. **Colonne « prix »** — demandée par le brief, absente de `ventes:dossier.liste.colonnes.*`
 *     (namespace déjà livré par le lot i18n : `client`/`vehicule`/`statut`/`dateLivraisonEstimee`
 *     SEULEMENT) et absente de `docs/design-ecrans-ventes.md` §6 (4 colonnes littérales). Un prix
 *     DÉRIVÉ existe déjà pour la fiche (`utils.ts::selectionnerPrixDossierVente`, chaque ligne de
 *     liste porte le document complet) — je ne l'ajoute pas ici pour rester fidèle au design déjà
 *     écrit et au namespace déjà livré, plutôt que de trancher seul un écart entre les deux sources
 *     amont. Le calcul reste disponible immédiatement si @laupernoe tranche pour l'ajouter.
 *  2. **Colonne « vendeur »** — demandée par le brief. Aucun champ vendeur/créateur n'existe sur
 *     `ReponseDossierVente` (seul `modifiePar`, le DERNIER modificateur, pas le vendeur qui a
 *     ouvert le dossier — les confondre afficherait une fausse information) ni de filtre
 *     correspondant sur `schemaFiltresDossiersVente` (gelé). Non implémenté, à demander au
 *     propriétaire du contrat (même doctrine que le design déjà écrit, §13 question 1, qui signale
 *     l'absence de numéro de dossier plutôt que d'en inventer un).
 *  3. **Filtre « période »** — demandé par le brief, aucun paramètre de plage de dates n'existe sur
 *     le contrat (seul le TRI par `dateLivraisonEstimee` existe). Non implémenté.
 *
 * PAS de lien vers le suivi financement/garantie dans l'en-tête (retiré, retour produit du 12.08.2026 :
 * « c'est doublé aussi sur les dossiers de vente ») — `OngletsDomaine` affiche déjà « Suivi
 * financement & garantie » comme onglet actif un rang au-dessus de cet écran (même arborescence que
 * « Dossiers »/« Véhicules en parc »), même destination que ce bouton retiré. Deux commandes vers la
 * même route sur le même écran, l'une ancrée (onglet) et l'autre flottante (bouton), ne font gagner
 * aucune découvrabilité — seulement du doute sur laquelle est la bonne.
 */
export function EcranListeDossiersVente() {
  const { t } = useTranslation(['ventes', 'commun']);
  const navigate = useNavigate();
  // Filtre de site LOCAL : site principal par défaut, mémorisé par écran. Le bouton « Nouveau
  // dossier de vente » hérite du site filtré (sinon le site principal côté formulaire).
  const filtreSite = useFiltreSite('ventes.dossiers');
  const site = filtreSite.siteId;
  const { data: session } = useSession();

  const [qSaisie, setQSaisie] = useState('');
  const [q, reinitialiserQ] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>('tous');
  const [afficherTermines, setAfficherTermines] = useState(false);
  const [tri, setTri] = useState<string>(TRI_DEFAUT_DOSSIERS_VENTE);

  const statutEnvoye =
    filtreStatut !== 'tous' ? [filtreStatut] : afficherTermines ? undefined : STATUTS_ACTIFS;

  const filtres = useMemo(
    () => ({
      q: q.trim() === '' ? undefined : q.trim(),
      statut: statutEnvoye,
      siteId: site,
      tri: tri as (typeof TRIS_DOSSIERS_VENTE)[number],
    }),
    // `statutEnvoye` est recalculé à chaque rendu depuis `filtreStatut`/`afficherTermines`
    // (tableau littéral) — le comparer par référence casserait la mémoïsation ; les deux primitifs
    // sont la dépendance correcte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, filtreStatut, afficherTermines, site, tri],
  );

  const {
    dossiers,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeDossiersVente(filtres);

  const filtresStructuresActifs = filtreStatut !== 'tous' || afficherTermines;

  function effacerFiltres() {
    setQSaisie('');
    reinitialiserQ();
    setFiltreStatut('tous');
    setAfficherTermines(false);
  }

  const peutCreer = peutEcrireDossierVente(session?.actions);

  const boutonNouveauDossier = peutCreer ? (
    <Button asChild>
      <Link to={chemins.ventes.dossiers.nouveau(site)}>
        {t('ventes:commun.actions.nouveauDossier')}
      </Link>
    </Button>
  ) : undefined;

  const colonnes: ColonneComptoir<ReponseDossierVente>[] = [
    {
      id: 'client',
      libelle: t('ventes:dossier.liste.colonnes.client'),
      rendu: (dossier) => <IdentiteClient client={dossier.clientAcheteur} />,
    },
    {
      id: 'vehicule',
      libelle: t('ventes:dossier.liste.colonnes.vehicule'),
      rendu: (dossier) =>
        dossier.vehicule ? (
          <IdentiteVehicule vehicule={dossier.vehicule.vehicule} taillePlaque="sm" />
        ) : (
          <span className="texte-libelle italic text-muted-foreground">
            {t('ventes:dossier.liste.vehiculeNonAssigne')}
          </span>
        ),
    },
    {
      id: 'statut',
      libelle: t('ventes:dossier.liste.colonnes.statut'),
      rendu: (dossier) => <BadgeStatutDossierVente statut={dossier.statut} />,
    },
    {
      id: 'dateLivraisonEstimee',
      libelle: t('ventes:dossier.liste.colonnes.dateLivraisonEstimee'),
      rendu: (dossier) => (
        <span className="texte-libelle text-muted-foreground">
          {dossier.dateLivraisonEstimee ? formaterDate(dossier.dateLivraisonEstimee) : ''}
        </span>
      ),
    },
  ];

  // Titres et descriptions d'état vide désormais DISTINCTS par cas (`ventes:dossier.liste.vide.
  // {recherche,filtre,premierUsage}`) — l'ancienne description UNIQUE reprenait, en `titre`, le
  // texte de l'écran (« Dossiers de vente »), doublon de l'onglet actif « Dossiers » et de l'entrée
  // de menu, même défaut que celui corrigé le 17.08.2026 sur `EcranListeFactures.tsx`. Seule
  // l'ACTION proposée varie encore selon le contexte, même doctrine que `EcranListeOrdresReparation`
  // pour le choix du bon motif d'état vide.
  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('ventes:dossier.liste.vide.recherche.titre')}
        description={t('ventes:dossier.liste.vide.recherche.description')}
      />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('ventes:dossier.liste.vide.filtre.titre')}
        description={t('ventes:dossier.liste.vide.filtre.description')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('ventes:dossier.liste.vide.premierUsage.titre')}
        description={t('ventes:dossier.liste.vide.premierUsage.description')}
      />
    );
  }

  if (isPending) {
    return (
      <GabaritEcran titre={t('ventes:dossier.liste.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('ventes:dossier.liste.titre')}>
        <EtatErreur
          titre={t('ventes:dossier.liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  // Titre MASQUÉ automatiquement — « Dossiers de vente » (`ventes:dossier.liste.titre`) est un
  // doublon (au sens inclusion, §3 du contrat du chantier « titres doublés », 17.08.2026) de
  // l'onglet actif « Dossiers » (`navigation-modele.ts`, `ONGLETS_VENTES`) : c'est EXACTEMENT le
  // défaut cité nommément par @laupernoe (« dans Ventes, c'est écrit "Dossiers de vente" alors que l'onglet
  // dit déjà Dossiers, et du coup ça fait un espace horrible »). `GabaritEcran` le détecte lui-même
  // — ne JAMAIS poser `titreVisible` ici pour forcer la visibilité : ce commentaire affirmait
  // l'inverse avant ce correctif (« pas un doublon »), à tort — la doctrine « un titre visible reste
  // préférable » a été explicitement RE-ARBITRÉE côté produit dans l'autre sens pour ce cas précis (voir
  // le contrat du chantier, §3, qui liste ce couple titre/onglet à la lettre). Seule action du
  // titre : « Nouveau dossier de vente » — le bouton « Suivi financement & garantie » qui siégeait
  // ici a été retiré, voir la note de l'en-tête de fichier.
  //
  // « Nouveau dossier de vente » a QUITTÉ le slot `actions` de `GabaritEcran` (chantier
  // d'unification inter-écrans, 25.08.2026 : `actions=` pour un bouton « Nouveau X » est le motif
  // PÉRIMÉ, `GabaritEcran` le placerait seul sur sa propre rangée pleine largeur sous le titre) —
  // aligné sur `EcranListeOrdresReparation`/`EcranListeClients`/`EcranListeVehicules` (référence du
  // chantier) : rejoint la rangée filtres + tri ci-dessous, à sa suite, plutôt que de rester isolé.
  return (
    <GabaritEcran titre={t('ventes:dossier.liste.titre')}>
      <div className="flex items-center gap-3">
        <BarreFiltres
          q={qSaisie}
          onChangeQ={setQSaisie}
          placeholderRecherche={t('ventes:dossier.liste.filtres.q')}
          className="min-w-0 flex-1"
          tri={
            <SelecteurTri
              options={TRIS_DOSSIERS_VENTE.map((valeur) => ({
                valeur,
                libelle: t(CLES_TRI[valeur]),
              }))}
              valeur={tri}
              onChangeValeur={setTri}
              label={t('ventes:dossier.liste.tri.label')}
            />
          }
        >
          <FiltreSite filtre={filtreSite} />
          <Select
            value={filtreStatut}
            onValueChange={(valeur) => setFiltreStatut(valeur as FiltreStatut)}
          >
            <SelectTrigger
              id="filtre-statut-dossier-vente"
              className="w-auto min-w-44 shrink-0"
              aria-label={t('ventes:dossier.liste.filtres.statutLabel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('ventes:dossier.liste.filtres.statutTous')}</SelectItem>
              {STATUTS_DOSSIER_VENTE.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`ventes:dossier.statuts.${CLES_STATUT[valeur]}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filtreStatut === 'tous' ? (
            <label
              htmlFor="dossiers-afficher-termines"
              className="flex shrink items-center gap-2 texte-corps"
            >
              <Checkbox
                id="dossiers-afficher-termines"
                checked={afficherTermines}
                onCheckedChange={(coche) => setAfficherTermines(coche === true)}
              />
              {t('ventes:dossier.liste.filtres.afficherTermines')}
            </label>
          ) : null}
        </BarreFiltres>
        {boutonNouveauDossier}
      </div>

      <TableComptoir
        colonnes={colonnes}
        lignes={dossiers}
        cleLigne={(dossier) => dossier.id}
        onOuvrirLigne={(dossier) => navigate(chemins.ventes.dossiers.detail(dossier.id, site))}
        libelleLigne={(dossier) =>
          t('commun:actions.ouvrirElement', { nom: dossier.clientAcheteur.nomAffiche })
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
