import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  CATEGORIES_ARTICLE,
  STATUTS_ARTICLE,
  TRI_DEFAUT_ARTICLES,
  TRIS_ARTICLES,
  type CategorieArticle,
  type ReponseArticle,
  type StatutArticle,
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
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useListeArticles } from '@/hooks/pieces/useListeArticles';
import { FiltreSite } from '@/composants/commun/FiltreSite';
import { useFiltreSite } from '@/hooks/site/useFiltreSite';
import { useSession } from '@/hooks/useSession';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { BadgeStatutArticle } from './BadgeStatutArticle';
import { FormulaireArticle } from './FormulaireArticle';
import { peutEcrireArticle } from './droits';
import { formaterQuantiteMillieme, quantiteDisponibleMillieme } from './utils';

const DELAI_DEBOUNCE_MS = 300;

const CLES_TRI: Record<(typeof TRIS_ARTICLES)[number], string> = {
  'creeLe:desc': 'pieces:articles.tri.creeLeDesc',
  'creeLe:asc': 'pieces:articles.tri.creeLeAsc',
  'designation:asc': 'pieces:articles.tri.designationAsc',
  'designation:desc': 'pieces:articles.tri.designationDesc',
  'numeroArticle:asc': 'pieces:articles.tri.numeroArticleAsc',
};

/** Liste des articles du référentiel (RP-03) — recherche, tri, filtres catégorie/statut,
 *  pagination par curseur. Même architecture que `EcranListeVehicules`. */
export function EcranListeArticles() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const actions = session?.actions;

  const [qSaisie, setQSaisie] = useState('');
  const [q, reinitialiserQ] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);
  const [categorie, setCategorie] = useState<CategorieArticle | undefined>(undefined);
  const [statut, setStatut] = useState<StatutArticle | undefined>(undefined);
  const [tri, setTri] = useState<string>(TRI_DEFAUT_ARTICLES);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  // Site dont la colonne « disponible » lit le stock : filtre local (défaut = site principal,
  // mémorisé par écran). « Tous » (rôles autorisés) = somme de `stocksResume` sur tous les sites.
  // Filtre d'affichage pur : ne change jamais la requête `/articles`. Absence de donnée ≠ valeur :
  // session pas encore résolue -> la colonne affiche « — ».
  const filtreSite = useFiltreSite('pieces.articles');
  const site = filtreSite.siteId;
  const siteConnu =
    site !== undefined ||
    (filtreSite.pret && filtreSite.tousPropose && filtreSite.sites.length > 0);

  const filtres = useMemo(
    () => ({ q: q.trim() === '' ? undefined : q.trim(), categorie, statut, tri }),
    [q, categorie, statut, tri],
  );

  const {
    articles,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeArticles(filtres);

  const filtresStructuresActifs = categorie !== undefined || statut !== undefined;

  function effacerFiltres() {
    // Levier de reset (choix produit 26.08.2026) : `effacerFiltres` est un geste de reprise en
    // main, pas une frappe — `q` doit refléter la case vide immédiatement, pas après le même
    // délai qu'une recherche (voir le commentaire de `useValeurDebouncee`, `hooks/commun/`).
    setQSaisie('');
    reinitialiserQ();
    setCategorie(undefined);
    setStatut(undefined);
  }

  const colonnes: ColonneComptoir<ReponseArticle>[] = [
    {
      id: 'article',
      libelle: t('pieces:articles.liste.colonnes.article'),
      rendu: (article) => (
        <div className="flex flex-col">
          <span className="font-medium">{article.designation}</span>
          <span className="texte-libelle text-muted-foreground">
            {t('pieces:articles.numero', { numero: article.numeroArticle })}
          </span>
        </div>
      ),
    },
    {
      id: 'reference',
      libelle: t('pieces:articles.liste.colonnes.reference'),
      rendu: (article) => (
        <span className="font-mono texte-libelle text-muted-foreground">
          {article.referencePrincipale}
        </span>
      ),
    },
    {
      id: 'categorie',
      libelle: t('pieces:articles.liste.colonnes.categorie'),
      rendu: (article) => t(`pieces:articles.categories.${article.categorie}`),
    },
    {
      id: 'statut',
      libelle: t('pieces:articles.liste.colonnes.statut'),
      rendu: (article) => <BadgeStatutArticle statut={article.statut} />,
    },
    {
      // Libellé « TTC » explicite (pas « Prix » nu) — même clé et même doctrine que la colonne
      // prix de `EcranRechercheComptoirPieces` : un magasinier qui saisit un montant sous un
      // libellé ambigu peut croire au hors-taxe (constat testeur, prix affiché ≠ prix saisi).
      id: 'prix',
      libelle: t('pieces:articles.prix.ttc'),
      alignement: 'droite',
      rendu: (article) => (
        <span className="tabular-nums">{formaterMontant(article.prixVenteTtcCentimes)}</span>
      ),
    },
    {
      // Disponibilité au site choisi, ou somme de tous les sites avec « Tous ». Trois rendus distincts, jamais
      // confondus (règle du dépôt « absence de donnée ≠ valeur ») :
      //  - session non résolue -> « — » (inconnu, pas zéro) ;
      //  - site choisi, stock à 0 (ou jamais mouvementé sur ce site) -> badge « Rupture »,
      //    l'information utile pour le magasinier reste la même dans les deux cas (rien à sortir
      //    aujourd'hui sur ce site) ;
      //  - site choisi, stock > 0 -> quantité en unités (conversion millièmes -> unités, JAMAIS
      //    le brut millième affiché tel quel).
      id: 'disponibilite',
      libelle: t('pieces:stock.quantites.disponible'),
      alignement: 'droite',
      rendu: (article) => {
        if (!siteConnu) {
          return <span className="tabular-nums text-muted-foreground">—</span>;
        }
        const quantite = quantiteDisponibleMillieme(article.stocksResume, site);
        return quantite > 0 ? (
          <span className="tabular-nums text-statut-succes">
            {t('pieces:rechercheComptoir.resultat.disponible', {
              n: formaterQuantiteMillieme(quantite),
            })}
          </span>
        ) : (
          <span className="texte-libelle text-destructive">
            {t('pieces:rechercheComptoir.resultat.rupture')}
          </span>
        );
      },
    },
  ];

  // Titres d'état vide nommant l'ABSENCE (jamais « Articles », qui répéterait l'onglet actif/le
  // menu Pièces — même défaut que celui corrigé le 17.08.2026 sur `EcranListeFactures.tsx`).
  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('pieces:articles.liste.vide.recherche.titre')}
        description={t('pieces:articles.liste.vide.recherche.description')}
      />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('pieces:articles.liste.vide.filtre.titre')}
        description={t('pieces:articles.liste.vide.filtre.description')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('pieces:articles.liste.vide.premierUsage.titre')}
        description={t('pieces:articles.liste.vide.premierUsage.description')}
      />
    );
  }

  if (isPending) {
    return (
      <GabaritEcran titre={t('pieces:articles.liste.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('pieces:articles.liste.titre')}>
        <EtatErreur
          titre={t('pieces:articles.liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  // Titre MASQUÉ automatiquement — « Articles » (`pieces:articles.liste.titre`) est un doublon
  // strict de l'onglet actif « Articles » (`navigation-modele.ts`, `ONGLETS_PIECES`) et de sa vue
  // « Tous ». `GabaritEcran` le détecte lui-même (§3 du contrat du chantier « titres doublés »,
  // 17.08.2026) — ne JAMAIS poser `titreVisible` ici pour forcer la visibilité : la doctrine
  // « un titre dupliquant à la lettre son onglet reste préférable à son absence » (retour produit du
  // 12.08.2026 sur `EcranListeClients`) a été explicitement RE-ARBITRÉE côté produit le 17.08.2026 dans
  // l'autre sens (voir le contrat du chantier, §3) — ce commentaire la corrigeait à tort ici avant
  // ce correctif.
  //
  // « Créer un article » n'est PAS dans le slot `actions` du gabarit (qui siégerait alors juste
  // sous les onglets, seul sur sa ligne) — retour produit du 12.08.2026 : « le bouton "Créer un
  // article" devrait être plus bas ». Il rejoint la ligne « Trier par », à droite — même
  // déplacement que celui demandé pour Atelier (« Nouvel ordre de réparation », voir le rapport de
  // ce chantier) : la barre de recherche remonte directement sous le titre, plus rien ne
  // l'en sépare.
  return (
    <GabaritEcran
      titre={t('pieces:articles.liste.titre')}
      actions={
        <>
          {peutEcrireArticle(actions) ? (
            <Button onClick={() => setFormulaireOuvert(true)}>
              {t('pieces:articles.actions.ajouter')}
            </Button>
          ) : null}
        </>
      }
      barre={
        <BarreFiltres
          tri={
            <SelecteurTri
              options={TRIS_ARTICLES.map((valeur) => ({ valeur, libelle: t(CLES_TRI[valeur]) }))}
              valeur={tri}
              onChangeValeur={setTri}
              label={t('pieces:articles.tri.label')}
            />
          }
          q={qSaisie}
          onChangeQ={setQSaisie}
        >
          <div className="flex flex-col gap-champ">
            <Select
              value={categorie ?? 'toutes'}
              onValueChange={(valeur) =>
                setCategorie(valeur === 'toutes' ? undefined : (valeur as CategorieArticle))
              }
            >
              <SelectTrigger
                id="filtre-categorie"
                className="w-[200px]"
                aria-label={t('pieces:articles.categorie')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="toutes">
                  {t('pieces:articles.filtres.categorieToutes')}
                </SelectItem>
                {CATEGORIES_ARTICLE.map((valeur) => (
                  <SelectItem key={valeur} value={valeur}>
                    {t(`pieces:articles.categories.${valeur}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-champ">
            <Select
              value={statut ?? 'tous'}
              onValueChange={(valeur) =>
                setStatut(valeur === 'tous' ? undefined : (valeur as StatutArticle))
              }
            >
              <SelectTrigger
                id="filtre-statut"
                className="w-[180px]"
                aria-label={t('pieces:articles.statut')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">{t('pieces:articles.filtres.statutTous')}</SelectItem>
                {STATUTS_ARTICLE.map((valeur) => (
                  <SelectItem key={valeur} value={valeur}>
                    {t(`pieces:articles.statuts.${valeur}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FiltreSite filtre={filtreSite} />
        </BarreFiltres>
      }
    >
      <TableComptoir
        colonnes={colonnes}
        lignes={articles}
        cleLigne={(article) => article.id}
        onOuvrirLigne={(article) => navigate(chemins.pieces.articleDetail(article.id))}
        libelleLigne={(article) => t('commun:actions.ouvrirElement', { nom: article.designation })}
        contenuVide={contenuVide}
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />

      <FormulaireArticle
        ouvert={formulaireOuvert}
        onOuvertChange={setFormulaireOuvert}
        onCree={(article) => navigate(chemins.pieces.articleDetail(article.id))}
      />
    </GabaritEcran>
  );
}
