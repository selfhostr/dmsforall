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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { SelecteurTri } from '@/composants/comptoir/SelecteurTri';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { useSession } from '@/hooks/useSession';
import { useListeArticles } from '@/hooks/pieces/useListeArticles';
import { formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { FormulaireArticle } from './FormulaireArticle';
import { peutEcrireArticle } from './droits';

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

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const filtres = useMemo(
    () => ({ q: q.trim() === '' ? undefined : q.trim(), categorie, statut, tri }),
    [q, categorie, statut, tri],
  );

  const { articles, isPending, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useListeArticles(filtres);

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
          <span className="texte-libelle text-muted-foreground">{t('pieces:articles.numero', { numero: article.numeroArticle })}</span>
        </div>
      ),
    },
    {
      id: 'reference',
      libelle: t('pieces:articles.liste.colonnes.reference'),
      rendu: (article) => <span className="font-mono texte-libelle text-muted-foreground">{article.referencePrincipale}</span>,
    },
    {
      id: 'categorie',
      libelle: t('pieces:articles.liste.colonnes.categorie'),
      rendu: (article) => t(`pieces:articles.categories.${article.categorie}`),
    },
    {
      id: 'statut',
      libelle: t('pieces:articles.liste.colonnes.statut'),
      rendu: (article) => <Badge variant={VARIANTE_BADGE_STATUT[article.statut]}>{t(`pieces:articles.statuts.${article.statut}`)}</Badge>,
    },
    {
      id: 'prix',
      libelle: t('pieces:articles.liste.colonnes.prix'),
      alignement: 'droite',
      rendu: (article) => <span className="tabular-nums">{formaterMontant(article.prixVenteTtcCentimes)}</span>,
    },
  ];

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = <EtatVideRecherche titre={t('pieces:articles.liste.titre')} description={t('pieces:articles.vide')} />;
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre titre={t('pieces:articles.liste.titre')} description={t('pieces:articles.vide')} onEffacerFiltres={effacerFiltres} />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('pieces:articles.liste.titre')}
        description={t('pieces:articles.vide')}
        action={
          peutEcrireArticle(role) ? (
            <Button onClick={() => setFormulaireOuvert(true)}>{t('pieces:articles.actions.ajouter')}</Button>
          ) : undefined
        }
      />
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:articles.liste.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:articles.liste.titre')}</h1>
        <EtatErreur
          titre={t('pieces:articles.liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('pieces:articles.liste.titre')}</h1>
        {peutEcrireArticle(role) ? <Button onClick={() => setFormulaireOuvert(true)}>{t('pieces:articles.actions.ajouter')}</Button> : null}
      </div>

      <BarreFiltres q={qSaisie} onChangeQ={setQSaisie} filtresActifs={filtresActifs} onEffacerFiltres={effacerFiltres}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-categorie">{t('pieces:articles.categorie')}</Label>
          <Select
            value={categorie ?? 'toutes'}
            onValueChange={(valeur) => setCategorie(valeur === 'toutes' ? undefined : (valeur as CategorieArticle))}
          >
            <SelectTrigger id="filtre-categorie" className="w-[200px]" aria-label={t('pieces:articles.categorie')}>
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
          <Select value={statut ?? 'tous'} onValueChange={(valeur) => setStatut(valeur === 'tous' ? undefined : (valeur as StatutArticle))}>
            <SelectTrigger id="filtre-statut" className="w-[180px]" aria-label={t('pieces:articles.statut')}>
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
      </BarreFiltres>

      <SelecteurTri
        options={TRIS_ARTICLES.map((valeur) => ({ valeur, libelle: t(CLES_TRI[valeur]) }))}
        valeur={tri}
        onChangeValeur={setTri}
        label={t('pieces:articles.tri.label')}
        className="max-w-xs"
      />

      <TableComptoir
        colonnes={colonnes}
        lignes={articles}
        cleLigne={(article) => article.id}
        onOuvrirLigne={(article) => navigate(chemins.pieces.articleDetail(article.id))}
        contenuVide={contenuVide}
      />

      <BoutonChargerPlus aChargerPlus={Boolean(hasNextPage)} enChargement={isFetchingNextPage} onChargerPlus={() => void fetchNextPage()} />

      <FormulaireArticle
        ouvert={formulaireOuvert}
        onOuvertChange={setFormulaireOuvert}
        onCree={(article) => navigate(chemins.pieces.articleDetail(article.id))}
      />
    </div>
  );
}
