import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import type { ReponseDepotPneus, SaisonPneu } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useHangarPneus } from '@/hooks/pneus/useHangarPneus';
import { useJeuxARelancer } from '@/hooks/pneus/useJeuxARelancer';
import { useRechercheHangarPneus } from '@/hooks/pneus/useRechercheHangarPneus';
import { useSitePrincipal } from '@/hooks/site/useSitePrincipal';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeSaisonPneu } from './composants/BadgeSaisonPneu';
import { CarteJeuPneu } from './composants/CarteJeuPneu';
import { DialogueChangerSaisonPneu } from './DialogueChangerSaisonPneu';
import { DialogueDeplacerDepotPneu } from './DialogueDeplacerDepotPneu';
import { DialogueNouveauDepotPneu } from './DialogueNouveauDepotPneu';
import { DialogueSortirDepotPneu } from './DialogueSortirDepotPneu';
import {
  peutChangerSaisonDepotPneus,
  peutCreerDepotPneus,
  peutDeplacerDepotPneus,
  peutSortirDepotPneus,
} from './droits';

/** « Physiquement dans le hangar » (RPP-04) : `en_depot` + `a_relancer` — `monte` est sur le
 *  véhicule, `sorti` n'y est plus. Fixe désormais (plus de sélecteur « Statut ») : l'onglet «À
 *  relancer» ci-dessous est l'unique façon de restreindre aux jeux en retard — avoir DEUX
 *  mécanismes (un filtre ET un onglet) pour la même distinction était exactement la duplication
 *  que ce Lot D corrige (`docs/refonte-navigation.md`, « Deux paires d'écrans sont le même
 *  écran »). */
const STATUTS_HANGAR_PHYSIQUE = ['en_depot', 'a_relancer'] as const;

type OngletHangar = 'actifs' | 'a_relancer';
const ONGLET_PAR_DEFAUT: OngletHangar = 'actifs';

function versOngletHangar(valeur: string | null): OngletHangar {
  return valeur === 'a_relancer' ? 'a_relancer' : ONGLET_PAR_DEFAUT;
}

/**
 * Dépôt de pneus (Lot B, `docs/specification-parc-et-hangar-pneus.md` §5-6 ; fusion Lot D,
 * `docs/refonte-navigation.md`) — « retrouver un jeu de pneus en deux secondes » (exigence @laupernoe).
 *
 * FUSION LOT D : cet écran portait déjà un filtre `statut=a_relancer` DUPLIQUANT
 * `EcranJeuxARelancer` (même donnée, mêmes actions déplacer/sortir, seule la présentation
 * différait : grille de cartes ici, table là-bas). L'arbitrage tranche pour un ONGLET plutôt
 * qu'un filtre supplémentaire — un onglet est atteignable en un geste (clic ou flèche clavier
 * une fois le focus sur la liste d'onglets) alors qu'un filtre suppose d'abord d'ouvrir un
 * `Select` puis de choisir dedans. `EcranJeuxARelancer.tsx` est supprimé, sa liste devient
 * `TabsContent value="a_relancer"` ci-dessous — MÊME hook (`useJeuxARelancer`), MÊME table, MÊMES
 * actions, aucune capacité perdue :
 *  - Vue TENANT ENTIER par défaut (site optionnel) préservée : `GET /depots-pneus/a-relancer`
 *    accepte un `siteId` optionnel (défaut tenant entier), contrairement à
 *    `GET /sites/{siteId}/hangar-pneus` qui l'impose. C'est une vraie asymétrie d'API, pas
 *    cosmétique — l'onglet « Actifs » (le PLAN PHYSIQUE d'un local) reste donc bloqué derrière un
 *    site choisi, l'onglet « À relancer » (triage, peut concerner plusieurs sites d'un même
 *    groupe) ne l'est pas. D'où : le sélecteur de site ci-dessous n'apparaît QUE dans l'onglet
 *    « Actifs » comme porte d'entrée obligatoire ; dans « À relancer » il redevient un filtre
 *    FACULTATIF (« Tous les sites » par défaut), exactement comme dans l'ancien
 *    `EcranJeuxARelancer`.
 *  - Tri par ancienneté (`dernierMouvementLe:asc`, le plus ancien d'abord) préservé — distinct du
 *    tri du plan (`desc`, mouvement le plus récent d'abord) : les deux onglets répondent à des
 *    questions différentes (« où est ce jeu » vs « quel jeu traiter en premier »).
 *  - Table dédiée (`TableComptoir`) préservée plutôt que la grille de cartes : une liste de
 *    triage se scanne mieux en lignes qu'en cartes ; `CarteJeuPneu` reste réservée au plan du
 *    hangar et aux résultats de recherche.
 *  - « Changer de saison » reste ABSENT des actions de cette liste : le serveur refuse ce geste
 *    pour un statut `a_relancer` (autorisé seulement `en_depot`/`monte`, même condition que
 *    `estActif` dans `CarteJeuPneu`) — ce n'était pas un oubli à corriger, la même règle continue
 *    de s'appliquer une fois fusionné.
 *
 * L'ancien bandeau « Des jeux oubliés se cachent peut-être… » (lien vers l'écran séparé) disparaît
 * avec le lien lui-même : il n'a plus de raison d'être une fois que basculer dessus est un clic
 * d'onglet.
 *
 * DEUX mécanismes de recherche distincts sur l'onglet « Actifs », volontairement pas fusionnés en
 * un seul champ magique :
 *  1. **Plaque / nom client** (`useRechercheHangarPneus`) — réutilise `GET /recherche`, déjà
 *     indexé serveur ; peut trouver un jeu MÊME s'il n'est pas dans la page actuellement chargée
 *     du plan (ex. jeu `monté`, donc absent du plan par défaut — voir plus bas). C'est LE geste
 *     rapide visé par l'exigence.
 *  2. **Repère du hangar** (`codeCase`) — filtre LOCAL, instantané, sur les jeux déjà chargés à
 *     l'écran : aucun endpoint ne permet de chercher par `codeCase` côté serveur (le contrat livré
 *     ne l'expose pas), donc ce filtre ne porte que sur la page courante — acceptable ici, le plan
 *     par défaut charge déjà tout ce qui est physiquement dans le hangar (voir `BoutonChargerPlus`
 *     pour aller au-delà de la première page).
 *
 * GAP SIGNALÉ (plan par défaut) : `GET /sites/{siteId}/hangar-pneus` ne rend que `vehiculeId`
 * (voir `packages/shared/src/contrats/pneus/depot-pneus.ts`), donc chaque case du plan n'affiche
 * pas la plaque/le client — résoudre les N véhicules d'une page de 50 en N requêtes systématiques
 * serait un coût réseau significatif pour un gain limité (le `codeCase` identifie déjà la case ;
 * la plaque ne sert qu'à CONFIRMER qu'on a la bonne, ce que `CarteJeuPneu` offre via le lien « Voir
 * le véhicule »). La recherche par plaque/client (mécanisme 1 ci-dessus), elle, enrichit exactement
 * les quelques candidats trouvés — coût borné, pas de N+1 systématique.
 *
 * GAP SIGNALÉ (« facturer le gardiennage ») : l'arbitrage (`docs/refonte-navigation.md`, Q5 ;
 * `docs/plan-refonte-navigation.md` §3.5) prévoit un bouton « facturer le gardiennage » depuis le
 * dépôt (par jeu, pas une entrée de menu) — « à livrer réellement câblé, pas comme l'onglet « à
 * relancer » [de Factures] aujourd'hui inerte ». Vérifié le 08.08.2026 : AUCUN endpoint de ce type
 * n'existe — `apps/api/src/pneus/depot-pneus.controller.ts` n'expose que sept routes (hangar,
 * dépôts d'un véhicule, créer, à-relancer, changer-saison, déplacer, sortir), aucune ne facture
 * quoi que ce soit, et `packages/shared/src/contrats/pneus/depot-pneus.ts`/`facturation/` ne
 * portent aucun DTO de gardiennage. Un bouton qui appellerait une route inexistante est exactement
 * le défaut que ce dépôt traque (« un bouton qui ne fait rien ») : PAS AJOUTÉ ICI. À câbler dans
 * `CarteJeuPneu` (plan) une fois qu'l'équipe API/l'équipe facturation auront défini le contrat
 * (nature de la prestation facturée, périodicité, lien vers la chaîne devis→facture existante).
 *
 * DÉFAUT CORRIGÉ (audit du 09.08.2026, requête tirée pour un onglet inactif) : `useJeuxARelancer`
 * (`hooks/pneus/`) porte désormais une option `enabled`, appelée ici avec `onglet === 'a_relancer'`
 * — la requête ne part plus au montage si l'utilisateur reste sur l'onglet « Actifs ». Gardée SANS
 * dépendre de `site` (contrairement à `useHangarPneus` ci-dessus) : cet onglet fonctionne aussi
 * sans site choisi (tenant entier), voir la note d'arbitrage plus haut.
 *
 * DÉFAUT CORRIGÉ (rapport de test du 06.08.2026, n°2) : `codeCase` est désormais modifiable APRÈS
 * la création via `POST /depots-pneus/{id}/deplacer` (`DialogueDeplacerDepotPneu`, bouton
 * « Déplacer » sur `CarteJeuPneu`) — la route existait déjà côté API, seul l'écran ne l'exposait
 * pas. `DialogueNouveauDepotPneu` reste le seul endroit où `codeCase` se saisit À LA CRÉATION.
 *
 * MISE EN ÉVIDENCE D'UN DÉPÔT PRÉCIS (`?depot=<id>`, lien « Voir dans le hangar à pneus » de
 * `EcranFicheVehicule.tsx`) — décision : SURLIGNER une carte du plan existant plutôt que
 * PRÉ-FILTRER dessus. Le magasinier vient chercher un jeu précis mais doit voir le reste du local
 * autour (case voisine libre, jeu mal rangé à côté) — un filtre qui masquerait tout le contexte
 * serait pire que l'état actuel (aucune mise en évidence). Concrètement : `CarteJeuPneu` reçoit
 * `misEnEvidence`, fait défiler jusqu'à elle-même et prend le focus (lecteur d'écran : la couleur
 * seule — un simple contour — ne porte jamais l'info dans ce dépôt, d'où aussi le focus
 * programmatique ET un badge textuel visible). Cas honnête : si `?depot=` ne correspond à AUCUN
 * dépôt chargé pour CE site (déplacé ailleurs, sorti depuis, lien périmé), le hangar s'affiche
 * normalement + un `Alert` dédié — jamais de mise en évidence fabriquée sur un élément absent, et
 * jamais un plantage.
 *
 * ROUTES SIGNALÉ (hors périmètre d'écriture, `routes/` appartient à un autre lot) : le chemin
 * `/pneus/a-relancer` (`chemins.pneus.aRelancer`, `apps/web/src/routes/chemins.ts`) et sa route
 * dans `routes/` n'ont plus d'écran à monter — `EcranJeuxARelancer.tsx` est supprimé. À qui de
 * droit : soit supprimer la route et rediriger `/pneus/a-relancer` vers
 * `/pneus?onglet=a_relancer` (paramètre lu par ce fichier), soit faire pointer
 * `chemins.pneus.aRelancer(site)` vers cette même URL — un lien externe (ex. futur bloc
 * « Aujourd'hui », Lot E) doit continuer à atterrir directement sur l'onglet « À relancer ».
 */
export function EcranHangarPneus() {
  const { t } = useTranslation(['pneus', 'commun', 'erreurs']);
  const [searchParams, setSearchParams] = useSearchParams();
  // `site` = filtre explicite de l'URL (« À relancer » reste sur tous les sites sans lui). Le hangar,
  // lui, est celui d'UN site : l'URL, sinon le site principal de la personne (`siteHangar`).
  const sitePrincipal = useSitePrincipal();
  const site = searchParams.get('site') ?? undefined;
  const siteHangar = site ?? sitePrincipal;
  const onglet = versOngletHangar(searchParams.get('onglet'));
  // Mise en évidence d'un dépôt précis (ex. lien « Voir dans le hangar à pneus » de la fiche
  // véhicule, `EcranFicheVehicule.tsx`) — MÊME mécanique `?xxx=` que `site`/`onglet` ci-dessus,
  // jamais un second système de navigation. `undefined` (absent de l'URL) reste le cas normal :
  // tous les écrans hangar ouverts sans venir d'un lien précis.
  const depotSurligne = searchParams.get('depot') ?? undefined;
  const {
    data: session,
    isPending: sessionEnChargement,
    isError: sessionEnErreur,
    refetch: relancerSession,
  } = useSession();
  const actions = session?.actions;
  // Droits PAR ACTION, calqués un à un sur `apps/api/src/auth/matrice-droits.ts` — DÉFAUT CORRIGÉ :
  // un seul booléen `peutGererDepotPneus` gouvernait auparavant `creer`/`changer_saison`/`deplacer`/
  // `sortir` indifféremment, alors que le serveur distingue deux périmètres (`technicien`/
  // `magasinier` ont `creer`/`changer_saison`/`deplacer` mais PAS `sortir`) — un technicien voyait
  // le bouton « Sortir », cliquait, remplissait le dialogue, et recevait un `403` honnête mais
  // évitable. Voir `ecrans/pneus/droits.ts` pour le détail de chaque liste de rôles.
  const peutCreer = peutCreerDepotPneus(actions);
  const peutChangerSaison = peutChangerSaisonDepotPneus(actions);
  const peutDeplacer = peutDeplacerDepotPneus(actions);
  const peutSortir = peutSortirDepotPneus(actions);

  const [filtreSaison, setFiltreSaison] = useState<SaisonPneu | 'toutes'>('toutes');
  const [filtreRepere, setFiltreRepere] = useState('');
  // Onglet « À relancer » — DÉFAUT CORRIGÉ (chantier d'unification inter-écrans, 25.08.2026) :
  // cet onglet réimplémentait son propre sélecteur de site à la main, hors de `BarreFiltres`
  // (`composants/comptoir/`), motif utilisé partout ailleurs dans le produit — régression réelle :
  // aucun bouton « Effacer les filtres », contrairement à tous les autres écrans à liste. `q` de
  // `BarreFiltres` porte ici le MÊME filtre repère (`codeCase`, local, instantané) que l'onglet
  // « Actifs » ci-dessus (voir `filtreRepere`/`depotsFiltres`) — état SÉPARÉ, volontairement : les
  // deux onglets filtrent deux listes différentes (`hangar.depots`/`aRelancer.depots`), un seul
  // état partagé les aurait fait se contredire en changeant d'onglet.
  const [filtreRepereARelancer, setFiltreRepereARelancer] = useState('');
  const [depotChangementSaison, setDepotChangementSaison] = useState<ReponseDepotPneus | null>(
    null,
  );
  const [depotDeplacement, setDepotDeplacement] = useState<ReponseDepotPneus | null>(null);
  const [depotSortie, setDepotSortie] = useState<ReponseDepotPneus | null>(null);
  const [creationOuverte, setCreationOuverte] = useState(false);

  const recherche = useRechercheHangarPneus();

  const hangar = useHangarPneus(siteHangar, {
    statut: STATUTS_HANGAR_PHYSIQUE,
    saison: filtreSaison === 'toutes' ? undefined : filtreSaison,
    tri: 'dernierMouvementLe:desc',
  });

  const aRelancer = useJeuxARelancer(
    { siteId: site, tri: 'dernierMouvementLe:asc' },
    { enabled: onglet === 'a_relancer' },
  );

  const depotsFiltres =
    filtreRepere.trim() === ''
      ? hangar.depots
      : hangar.depots.filter((depot) =>
          (depot.codeCase ?? '').toLowerCase().includes(filtreRepere.trim().toLowerCase()),
        );

  const depotsARelancerFiltres =
    filtreRepereARelancer.trim() === ''
      ? aRelancer.depots
      : aRelancer.depots.filter((depot) =>
          (depot.codeCase ?? '').toLowerCase().includes(filtreRepereARelancer.trim().toLowerCase()),
        );

  function changerParametre(cle: string, valeur: string | undefined) {
    // Copie les paramètres EXISTANTS plutôt que de les remplacer (même patron que
    // `EcranTableauBord.changerSite`) : un `setSearchParams` qui ne porterait qu'une clé
    // écraserait tout autre paramètre déjà présent dans l'URL (l'autre clé, justement).
    const parametres = new URLSearchParams(searchParams);
    if (valeur === undefined) {
      parametres.delete(cle);
    } else {
      parametres.set(cle, valeur);
    }
    setSearchParams(parametres);
  }

  function changerOnglet(valeur: string) {
    const cible = versOngletHangar(valeur);
    changerParametre('onglet', cible === ONGLET_PAR_DEFAUT ? undefined : cible);
  }

  if (sessionEnChargement) {
    return (
      <GabaritEcran titre={t('pneus:hangar.titre')}>
        <EtatChargement lignes={4} />
      </GabaritEcran>
    );
  }

  if (sessionEnErreur) {
    return (
      <GabaritEcran titre={t('pneus:hangar.titre')}>
        <EtatErreur
          titre={t('pneus:hangar.erreur.titre')}
          description={t('erreurs:inattendue.description')}
          onReessayer={() => void relancerSession()}
        />
      </GabaritEcran>
    );
  }

  const sites = (session?.sites ?? []).filter((s) => s.actif);

  const colonnesARelancer: ColonneComptoir<ReponseDepotPneus>[] = [
    {
      id: 'repere',
      libelle: t('pneus:aRelancer.colonnes.repere'),
      rendu: (depot) => (
        <span className="font-mono">{depot.codeCase ?? t('pneus:jeu.sansRepere')}</span>
      ),
    },
    {
      id: 'saison',
      libelle: t('pneus:aRelancer.colonnes.saison'),
      rendu: (depot) => <BadgeSaisonPneu saison={depot.saison} />,
    },
    {
      id: 'dimension',
      libelle: t('pneus:aRelancer.colonnes.dimension'),
      rendu: (depot) => depot.dimension ?? t('pneus:jeu.sansDimension'),
    },
    {
      id: 'dernierMouvement',
      libelle: t('pneus:aRelancer.colonnes.dernierMouvement'),
      alignement: 'droite',
      rendu: (depot) => formaterDate(depot.dernierMouvementLe),
    },
    {
      id: 'vehicule',
      libelle: t('pneus:aRelancer.colonnes.vehicule'),
      rendu: (depot) => (
        <Link
          to={chemins.vehicules.detail(depot.vehiculeId, site)}
          className="anneau-focus rounded-sm texte-corps font-medium text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('pneus:jeu.actions.voirVehicule')}
        </Link>
      ),
    },
    ...(peutDeplacer || peutSortir
      ? [
          {
            id: 'actions',
            libelle: '',
            actions: true,
            rendu: (depot: ReponseDepotPneus) => (
              // Pas de « Changer de saison » ici : cette liste ne contient QUE des dépôts au
              // statut `a_relancer`, un statut où le serveur rejette systématiquement ce geste
              // (autorisé seulement `en_depot`/`monte`, voir `CarteJeuPneu.tsx` — `estActif`).
              // « Déplacer » et « Sortir » restent gouvernés CHACUN par son propre droit (voir le
              // commentaire au-dessus de `peutCreer` plus haut) : un technicien voit « Déplacer »
              // (un jeu `a_relancer` n'est pas `sorti`, seul statut que `POST .../deplacer`
              // refuse) mais jamais « Sortir », qu'il n'a jamais eu.
              <div className="flex justify-end gap-2">
                {peutDeplacer ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDepotDeplacement(depot)}
                  >
                    {t('pneus:jeu.actions.deplacer')}
                  </Button>
                ) : null}
                {peutSortir ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDepotSortie(depot)}
                  >
                    {t('pneus:jeu.actions.sortir')}
                  </Button>
                ) : null}
              </div>
            ),
          } satisfies ColonneComptoir<ReponseDepotPneus>,
        ]
      : []),
  ];

  // GABARIT (chantier « titres doublés & espacements », 17.08.2026) : `pneus:hangar.titre` vaut
  // désormais « Dépôt pneus », MOT POUR MOT identique au libellé de l'onglet Atelier
  // (`navigation:onglets.atelierDepotPneus`, `composants/layout/navigation-modele.ts`) — avant ce
  // chantier il valait « Hangar à pneus », doublon reformulé que @laupernoe a cité nommément (« Atelier >
  // Dépôt pneus → titre Hangar à pneus, même chose, dit autrement »). L'égalité de libellé permet à
  // la détection automatique de `GabaritEcran` (§3 du contrat de chantier) de masquer le `h1` en
  // `sr-only` SANS poser `titreVisible` à la main. DE/IT n'ont pas bougé : leurs titres d'écran
  // (« Reifenhotel », « Deposito pneumatici ») étaient déjà identiques à leur libellé d'onglet
  // respectif — seul le FR divergeait.
  //
  // « Nouveau dépôt » N'EST PLUS sur la ligne du titre (retour produit, chantier « zone haute des
  // écrans de liste » : « comme il est en haut, il fait que ça décale tout »). Cet écran n'a pas de
  // ligne « Trier par » (plan en grille + onglets, pas de `SelecteurTri`) : le bouton rejoint la
  // ligne la plus proche en esprit, juste sous la barre de recherche, dans l'onglet « Dans le
  // hangar » où le geste « entrer un jeu » a lieu — voir plus bas, à l'intérieur de
  // `TabsContent value="actifs"`.
  return (
    <GabaritEcran titre={t('pneus:hangar.titre')}>
      <Tabs value={onglet} onValueChange={changerOnglet} className="flex flex-col gap-6">
        <TabsList aria-label={t('pneus:hangar.onglets.ariaLabel')}>
          <TabsTrigger value="actifs">{t('pneus:hangar.onglets.actifs')}</TabsTrigger>
          <TabsTrigger value="a_relancer">{t('pneus:hangar.onglets.aRelancer')}</TabsTrigger>
        </TabsList>

        <TabsContent value="actifs" className="flex flex-col gap-6">
          {!siteHangar ? (
            <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
              <EtatVide
                titre={t('pneus:hangar.siteRequis.titre')}
                description={t('pneus:hangar.siteRequis.description')}
                action={
                  sites.length > 0 ? (
                    <Select onValueChange={(siteId) => changerParametre('site', siteId)}>
                      <SelectTrigger
                        aria-label={t('pneus:hangar.siteRequis.label')}
                        className="w-64"
                      >
                        <SelectValue placeholder={t('pneus:hangar.siteRequis.label')} />
                      </SelectTrigger>
                      <SelectContent>
                        {sites.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.nom}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pneus-recherche-plaque-client">
                  {t('pneus:hangar.recherche.champLabel')}
                </Label>
                <Input
                  id="pneus-recherche-plaque-client"
                  value={recherche.saisie}
                  placeholder={t('pneus:hangar.recherche.champPlaceholder')}
                  onChange={(evenement) => recherche.onSaisieChange(evenement.target.value)}
                />
              </div>

              {peutCreer ? (
                <div className="flex justify-end">
                  <Button type="button" onClick={() => setCreationOuverte(true)}>
                    {t('pneus:creation.actions.ouvrir')}
                  </Button>
                </div>
              ) : null}

              {recherche.actif ? (
                <div className="flex flex-col gap-4">
                  {recherche.enErreur ? (
                    <EtatErreur
                      titre={t('pneus:hangar.recherche.erreur.titre')}
                      description={messageErreur(recherche.erreur, t)}
                      onReessayer={recherche.relancer}
                    />
                  ) : recherche.enChargement ? (
                    <EtatChargement lignes={3} />
                  ) : recherche.jeux.length === 0 ? (
                    <EtatVideRecherche
                      titre={t('pneus:hangar.recherche.aucunResultat.titre')}
                      description={t('pneus:hangar.recherche.aucunResultat.description')}
                    />
                  ) : (
                    /* DESIGN.md « densité » — `items-start` : `CarteJeuPneu` varie en hauteur
                     *  (identification présente ou non, avertissement de relance, motif de
                     *  sortie) ; pas de `compact` ici, son contenu (repère, statuts,
                     *  identification, dernier mouvement, actions) dépasse largement le seuil
                     *  « contenu minimal » réservé à `--espace-carte-compacte`. Sans `items-start`,
                     *  CSS Grid étire chaque carte à la hauteur de la plus haute de sa ligne — vide
                     *  visible sous le contenu des cartes les plus courtes. */
                    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {recherche.jeux.map(({ depot, candidat }) => (
                        <CarteJeuPneu
                          key={depot.id}
                          depot={depot}
                          identification={{
                            plaque: candidat.plaque,
                            designation: candidat.designation,
                            clientNom: candidat.clientNom,
                          }}
                          site={site}
                          peutChangerSaison={peutChangerSaison}
                          peutDeplacer={peutDeplacer}
                          peutSortir={peutSortir}
                          misEnEvidence={depot.id === depotSurligne}
                          onChangerSaison={setDepotChangementSaison}
                          onDeplacer={setDepotDeplacement}
                          onSortir={setDepotSortie}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Cas honnête (exigence du lot) : `?depot=` pointe vers un dépôt qui n'est
                   *  ni sorti, ni monté, ni entré sur CE site — déplacé ailleurs, sorti depuis,
                   *  ou lien périmé. On ne fabrique JAMAIS de mise en évidence sur un élément
                   *  absent : le hangar s'affiche normalement, avec cette mention en plus. Gardé
                   *  hors de `hangar.isPending`/`isError` pour ne pas se déclencher trop tôt ni
                   *  se confondre avec `EtatErreur` (qui a son propre message + retry). */}
                  {depotSurligne &&
                  !hangar.isPending &&
                  !hangar.isError &&
                  !hangar.depots.some((d) => d.id === depotSurligne) ? (
                    <Alert variant="avertissement">
                      <AlertTitle>{t('pneus:hangar.misEnEvidence.absent.titre')}</AlertTitle>
                      <AlertDescription>
                        {t('pneus:hangar.misEnEvidence.absent.description')}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pneus-filtre-saison">
                        {t('pneus:hangar.filtres.saison')}
                      </Label>
                      <Select
                        value={filtreSaison}
                        onValueChange={(valeur) => setFiltreSaison(valeur as SaisonPneu | 'toutes')}
                      >
                        <SelectTrigger id="pneus-filtre-saison" className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="toutes">
                            {t('pneus:hangar.filtres.saisonToutes')}
                          </SelectItem>
                          <SelectItem value="ete">{t('pneus:saison.ete')}</SelectItem>
                          <SelectItem value="hiver">{t('pneus:saison.hiver')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pneus-filtre-repere">
                        {t('pneus:hangar.filtres.repere')}
                      </Label>
                      <Input
                        id="pneus-filtre-repere"
                        value={filtreRepere}
                        placeholder={t('pneus:hangar.filtres.reperePlaceholder')}
                        className="w-48"
                        onChange={(evenement) => setFiltreRepere(evenement.target.value)}
                      />
                    </div>
                  </div>

                  {hangar.isPending ? (
                    <EtatChargement lignes={6} />
                  ) : hangar.isError ? (
                    <EtatErreur
                      titre={t('pneus:hangar.erreur.titre')}
                      description={messageErreur(hangar.error, t)}
                      onReessayer={() => void hangar.refetch()}
                    />
                  ) : depotsFiltres.length === 0 ? (
                    filtreRepere.trim() !== '' ? (
                      <EtatVideFiltre
                        titre={t('pneus:hangar.vide.titre')}
                        description={t('pneus:hangar.vide.filtreDescription')}
                        onEffacerFiltres={() => setFiltreRepere('')}
                      />
                    ) : (
                      <EtatVidePremierUsage
                        titre={t('pneus:hangar.vide.titre')}
                        description={t('pneus:hangar.vide.premierUsage')}
                      />
                    )
                  ) : (
                    <>
                      {/* DESIGN.md « densité » — même raison qu'au-dessus (grille de résultats de
                       *  recherche) : `items-start`, pas de `compact`. */}
                      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {depotsFiltres.map((depot) => (
                          <CarteJeuPneu
                            key={depot.id}
                            depot={depot}
                            site={site}
                            peutChangerSaison={peutChangerSaison}
                            peutDeplacer={peutDeplacer}
                            peutSortir={peutSortir}
                            misEnEvidence={depot.id === depotSurligne}
                            onChangerSaison={setDepotChangementSaison}
                            onDeplacer={setDepotDeplacement}
                            onSortir={setDepotSortie}
                          />
                        ))}
                      </div>
                      <BoutonChargerPlus
                        aChargerPlus={Boolean(hangar.hasNextPage)}
                        enChargement={hangar.isFetchingNextPage}
                        onChargerPlus={() => void hangar.fetchNextPage()}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="a_relancer" className="flex flex-col gap-6">
          <p className="texte-corps text-muted-foreground">{t('pneus:aRelancer.description')}</p>

          {/* `BarreFiltres` (`composants/comptoir/`) — même motif que partout ailleurs dans le
              produit, voir la note au-dessus de `filtreRepereARelancer`. `q` porte le filtre
              repère local (même mécanisme que `filtreRepere` sur l'onglet « Actifs », voir
              `depotsARelancerFiltres`) ; le sélecteur de site rejoint les contrôles de domaine via
              `children`, `sites.length > 0` gardé à l'identique (aucun sélecteur à afficher pour
              un tenant mono-site). `site` n'est PAS remis à zéro par « Effacer les filtres » —
              même doctrine que les autres écrans à liste (`EcranListeVehiculesStock` notamment) :
              le site reste un réglage de poste, pas un filtre de recherche. */}
          <BarreFiltres
            q={filtreRepereARelancer}
            onChangeQ={setFiltreRepereARelancer}
            placeholderRecherche={t('pneus:hangar.filtres.reperePlaceholder')}
            filtresActifs={filtreRepereARelancer.trim() !== ''}
            onEffacerFiltres={() => setFiltreRepereARelancer('')}
          >
            {sites.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pneus-a-relancer-site">{t('pneus:aRelancer.filtreSite')}</Label>
                <Select
                  value={site ?? 'tous'}
                  onValueChange={(valeur) =>
                    changerParametre('site', valeur === 'tous' ? undefined : valeur)
                  }
                >
                  <SelectTrigger id="pneus-a-relancer-site" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tous">{t('pneus:aRelancer.filtreSiteTous')}</SelectItem>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </BarreFiltres>

          {aRelancer.isError ? (
            <EtatErreur
              titre={t('pneus:aRelancer.erreur.titre')}
              description={messageErreur(aRelancer.error, t)}
              onReessayer={() => void aRelancer.refetch()}
            />
          ) : (
            <>
              <TableComptoir
                colonnes={colonnesARelancer}
                lignes={depotsARelancerFiltres}
                cleLigne={(depot) => depot.id}
                enChargement={aRelancer.isPending}
                contenuVide={
                  filtreRepereARelancer.trim() !== '' ? (
                    <EtatVideFiltre
                      titre={t('pneus:aRelancer.titre')}
                      description={t('pneus:aRelancer.videFiltre')}
                      onEffacerFiltres={() => setFiltreRepereARelancer('')}
                    />
                  ) : (
                    <EtatVidePremierUsage
                      titre={t('pneus:aRelancer.titre')}
                      description={t('pneus:aRelancer.vide')}
                    />
                  )
                }
              />

              <BoutonChargerPlus
                aChargerPlus={Boolean(aRelancer.hasNextPage)}
                enChargement={aRelancer.isFetchingNextPage}
                onChargerPlus={() => void aRelancer.fetchNextPage()}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <DialogueChangerSaisonPneu
        depot={depotChangementSaison}
        onFerme={() => setDepotChangementSaison(null)}
      />
      <DialogueDeplacerDepotPneu
        depot={depotDeplacement}
        onFerme={() => setDepotDeplacement(null)}
      />
      <DialogueSortirDepotPneu depot={depotSortie} onFerme={() => setDepotSortie(null)} />
      <DialogueNouveauDepotPneu
        siteId={siteHangar}
        ouvert={creationOuverte}
        onFerme={() => setCreationOuverte(false)}
      />
    </GabaritEcran>
  );
}
