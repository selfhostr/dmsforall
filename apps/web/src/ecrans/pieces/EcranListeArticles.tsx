import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useSession } from '@/hooks/useSession';
import { useListeArticles } from '@/hooks/pieces/useListeArticles';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { FormulaireArticle } from './FormulaireArticle';
import { peutEcrireArticle } from './droits';
import { formaterQuantiteMillieme } from './utils';

const DELAI_DEBOUNCE_MS = 300;

const CLES_TRI: Record<(typeof TRIS_ARTICLES)[number], string> = {
  'creeLe:desc': 'pieces:articles.tri.creeLeDesc',
  'creeLe:asc': 'pieces:articles.tri.creeLeAsc',
  'designation:asc': 'pieces:articles.tri.designationAsc',
  'designation:desc': 'pieces:articles.tri.designationDesc',
  'numeroArticle:asc': 'pieces:articles.tri.numeroArticleAsc',
};

const VARIANTE_BADGE_STATUT: Record<StatutArticle, 'default' | 'secondary' | 'outline'> = {
  actif: 'default',
  obsolete: 'secondary',
  desactive: 'outline',
};

/** Liste des articles du référentiel (RP-03) — recherche, tri, filtres catégorie/statut,
 *  pagination par curseur. Même architecture que `EcranListeVehicules`. */
export function EcranListeArticles() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');
  const [categorie, setCategorie] = useState<CategorieArticle | undefined>(undefined);
  const [statut, setStatut] = useState<StatutArticle | undefined>(undefined);
  const [tri, setTri] = useState<string>(TRI_DEFAUT_ARTICLES);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  // Site dont la colonne « disponible » lit le stock — jamais deviné à plusieurs choix possibles
  // (même doctrine que `SelecteurSiteRequis`) : auto-sélectionné UNIQUEMENT quand un seul site
  // actif existe (aucune ambiguïté à deviner), sinon laissé au magasinier. Filtre d'affichage
  // pur : ne change jamais la requête `/articles`, seulement la lecture de `stocksResume`.
  const sitesActifs = useMemo(() => (session?.sites ?? []).filter((site) => site.actif), [session]);
  const [site, setSite] = useState('');
  useEffect(() => {
    if (site === '' && sitesActifs.length === 1) {
      const siteUnique = sitesActifs[0];
      if (siteUnique) {
        setSite(siteUnique.id);
      }
    }
  }, [site, sitesActifs]);

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

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
  const filtresActifs = q.trim() !== '' || filtresStructuresActifs;

  function effacerFiltres() {
    setQSaisie('');
    setQ('');
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
      rendu: (article) => (
        <Badge variant={VARIANTE_BADGE_STATUT[article.statut]}>
          {t(`pieces:articles.statuts.${article.statut}`)}
        </Badge>
      ),
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
      // Disponibilité RÉELLE au site choisi, jamais un total tous sites confondus (brief : « ce
      // qu'il peut réellement sortir aujourd'hui, sur son site »). Trois rendus distincts, jamais
      // confondus (règle du dépôt « absence de donnée ≠ valeur ») :
      //  - aucun site choisi -> « — » (inconnu, pas zéro) ;
      //  - site choisi, stock à 0 (ou jamais mouvementé sur ce site) -> badge « Rupture »,
      //    l'information utile pour le magasinier reste la même dans les deux cas (rien à sortir
      //    aujourd'hui sur ce site) ;
      //  - site choisi, stock > 0 -> quantité en unités (conversion millièmes -> unités, JAMAIS
      //    le brut millième affiché tel quel).
      id: 'disponibilite',
      libelle: t('pieces:stock.quantites.disponible'),
      alignement: 'droite',
      rendu: (article) => {
        if (site === '') {
          return <span className="tabular-nums text-muted-foreground">—</span>;
        }
        const quantite =
          article.stocksResume.find((resume) => resume.siteId === site)
            ?.quantiteDisponibleMillieme ?? 0;
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

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('pieces:articles.liste.titre')}
        description={t('pieces:articles.vide')}
      />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('pieces:articles.liste.titre')}
        description={t('pieces:articles.vide')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('pieces:articles.liste.titre')}
        description={t('pieces:articles.vide')}
        action={
          peutEcrireArticle(role) ? (
            <Button onClick={() => setFormulaireOuvert(true)}>
              {t('pieces:articles.actions.ajouter')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (isPending) {
    return (
      <GabaritEcran titre={t('pieces:articles.liste.titre')} titreVisible={false}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('pieces:articles.liste.titre')} titreVisible={false}>
        <EtatErreur
          titre={t('pieces:articles.liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  // Titre masqué : doublon strict du libellé de l'onglet actif « Articles » (`navigation-modele.ts`,
  // `ONGLETS_PIECES`) — le h1 reste dans le DOM pour le lecteur d'écran et la structure du
  // document, sans répéter visuellement ce que la barre d'onglets affiche déjà en surbrillance.
  //
  // « Créer un article » n'est PAS dans le slot `actions` du gabarit (qui siégerait alors juste
  // sous les onglets, seul sur sa ligne) — retour @laupernoe du 12.08.2026 : « le bouton "Créer un
  // article" devrait être plus bas ». Il rejoint la ligne « Trier par », à droite — même
  // déplacement que celui demandé pour Atelier (« Nouvel ordre de réparation », voir le rapport de
  // ce chantier) : la barre de recherche remonte directement sous les onglets, plus rien ne
  // l'en sépare.
  return (
    <GabaritEcran titre={t('pieces:articles.liste.titre')} titreVisible={false}>
      <BarreFiltres
        q={qSaisie}
        onChangeQ={setQSaisie}
        filtresActifs={filtresActifs}
        onEffacerFiltres={effacerFiltres}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-categorie">{t('pieces:articles.categorie')}</Label>
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
              <SelectItem value="toutes">{t('pieces:articles.filtres.categorieToutes')}</SelectItem>
              {CATEGORIES_ARTICLE.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pieces:articles.categories.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-statut">{t('pieces:articles.statut')}</Label>
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
        {sitesActifs.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filtre-site">{t('pieces:siteRequis.label')}</Label>
            <Select value={site} onValueChange={setSite}>
              <SelectTrigger
                id="filtre-site"
                className="w-[200px]"
                aria-label={t('pieces:siteRequis.label')}
              >
                <SelectValue placeholder={t('pieces:siteRequis.label')} />
              </SelectTrigger>
              <SelectContent>
                {sitesActifs.map((siteOption) => (
                  <SelectItem key={siteOption.id} value={siteOption.id}>
                    {siteOption.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </BarreFiltres>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelecteurTri
          options={TRIS_ARTICLES.map((valeur) => ({ valeur, libelle: t(CLES_TRI[valeur]) }))}
          valeur={tri}
          onChangeValeur={setTri}
          label={t('pieces:articles.tri.label')}
          className="max-w-xs"
        />
        {peutEcrireArticle(role) ? (
          <Button onClick={() => setFormulaireOuvert(true)}>
            {t('pieces:articles.actions.ajouter')}
          </Button>
        ) : null}
      </div>

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
