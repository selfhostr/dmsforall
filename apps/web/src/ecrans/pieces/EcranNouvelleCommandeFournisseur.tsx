import { useQueries } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import {
  schemaCreationCommandeFournisseur,
  TRI_DEFAUT_FOURNISSEURS,
  type EntreeCreationCommandeFournisseur,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
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
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { recupererArticle } from '@/hooks/pieces/articles.api';
import { clesPieces } from '@/hooks/pieces/cles';
import { useCreerCommandeFournisseur } from '@/hooks/pieces/useCreerCommandeFournisseur';
import { useListeFournisseurs } from '@/hooks/pieces/useListeFournisseurs';
import { useRechercheComptoirPieces } from '@/hooks/pieces/useRechercheComptoirPieces';
import { useSession } from '@/hooks/useSession';
import { formaterMontant } from '@/lib/formats';

import { estEtatPreremplissageValide } from './etat-preremplissage-commande';
import {
  formaterQuantiteMillieme,
  quantiteMilliemeVersSaisie,
  saisieVersQuantiteMillieme,
} from './utils';

interface LigneEnCours {
  readonly articleId: string;
  readonly numeroArticle: string;
  readonly designation: string;
  readonly quantiteSaisie: string;
  readonly prixAttenduCentimes: number | null;
}

/**
 * Création d'une commande fournisseur (RP-26, priorité 1 du lot) — écran dédié plutôt qu'un
 * dialogue (même choix que `FormulaireNouvelOrdreReparation`) : jusqu'à 200 lignes possibles
 * (`schemaCreationCommandeFournisseur`), un dialogue étroit ne convient pas à cette saisie. Le
 * choix du site pilote directement la recherche comptoir (`useRechercheComptoirPieces`) : une
 * commande se pose sur UN site, la disponibilité affichée pendant la recherche est celle de ce
 * site précis.
 *
 * PRÉ-REMPLISSAGE depuis `EcranReapprovisionnement` (correctif : « le réapprovisionnement ne
 * mène nulle part ») — reçu via `useLocation().state` (état de navigation React Router, jamais un
 * paramètre d'URL : plus simple ici pour un tableau de lignes de longueur variable, voir
 * `etat-preremplissage-commande.ts`). Site et lignes (quantités suggérées) sont posés dès le
 * premier rendu ; le fournisseur reste VIDE au départ — `LigneReapprovisionnement` ne porte aucune
 * information de fournisseur — puis DÉTECTÉ ci-dessous si (et seulement si) tous les articles
 * sélectionnés partagent EXACTEMENT une même référence fournisseur (`GET /articles/{id}`,
 * `references[].type === 'fournisseur'`). Reste un formulaire pleinement utilisable SANS
 * pré-remplissage (lien direct, ou bouton « Créer une commande » habituel) : rien ci-dessous ne
 * suppose la présence de `état`.
 */
export function EcranNouvelleCommandeFournisseur() {
  const { t } = useTranslation(['pieces', 'commun', 'validation', 'erreurs']);
  const navigate = useNavigate();
  const location = useLocation();
  const etatPreremplissage = estEtatPreremplissageValide(location.state)
    ? location.state
    : undefined;
  const { data: session } = useSession();
  const sites = (session?.sites ?? []).filter((site) => site.actif);

  const fournisseursRequete = useListeFournisseurs({
    statut: ['actif'],
    tri: TRI_DEFAUT_FOURNISSEURS,
    limite: 200,
  });
  const { fournisseurs } = fournisseursRequete;
  const idempotence = useCleIdempotence();
  const creer = useCreerCommandeFournisseur();

  const [fournisseurId, setFournisseurId] = useState('');
  const [siteId, setSiteId] = useState(() => etatPreremplissage?.siteId ?? '');
  const [dateCommande, setDateCommande] = useState('');
  const [reference, setReference] = useState('');
  const [lignes, setLignes] = useState<readonly LigneEnCours[]>(() =>
    (etatPreremplissage?.lignes ?? []).map((ligne) => ({
      articleId: ligne.articleId,
      numeroArticle: ligne.numeroArticle,
      designation: ligne.designation,
      quantiteSaisie: quantiteMilliemeVersSaisie(ligne.quantiteSuggereeMillieme),
      prixAttenduCentimes: null,
    })),
  );
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  const recherche = useRechercheComptoirPieces(siteId || undefined);

  const idsDejaAjoutes = useMemo(() => new Set(lignes.map((ligne) => ligne.articleId)), [lignes]);

  // Détection du fournisseur + reprise du dernier prix d'achat connu, à partir des articles
  // pré-remplis — même source que `EcranFicheArticle` (`recupererArticle`), PAS un nouvel
  // endpoint. `enabled` lié à `etatPreremplissage` : aucun appel réseau supplémentaire pour un
  // usage direct de l'écran (sans pré-remplissage).
  const requetesArticlesPreremplis = useQueries({
    queries: (etatPreremplissage?.lignes ?? []).map((ligne) => ({
      queryKey: clesPieces.articles.detail(ligne.articleId),
      queryFn: () => recupererArticle(ligne.articleId),
      enabled: etatPreremplissage !== undefined,
    })),
  });
  // Applique le prix d'achat repris UNE SEULE FOIS (`useRef`, pas une dépendance d'effet) :
  // `requetesArticlesPreremplis` change de référence à chaque rendu (comportement normal de
  // `useQueries`), une garde par simple condition rejouerait `setLignes` en boucle.
  const prixRepriseAppliqueRef = useRef(false);
  useEffect(() => {
    if (etatPreremplissage === undefined) return;
    if (requetesArticlesPreremplis.length === 0) return;
    if (!requetesArticlesPreremplis.every((requete) => requete.isSuccess)) return;

    if (!prixRepriseAppliqueRef.current) {
      prixRepriseAppliqueRef.current = true;
      setLignes((valeur) =>
        valeur.map((ligne) => {
          if (ligne.prixAttenduCentimes !== null) return ligne;
          const article = requetesArticlesPreremplis.find(
            (requete) => requete.data?.id === ligne.articleId,
          )?.data;
          return article?.prixAchatCentimes != null
            ? { ...ligne, prixAttenduCentimes: article.prixAchatCentimes }
            : ligne;
        }),
      );
    }

    // Fournisseur détecté SEULEMENT si encore vide (jamais après un choix — manuel ou déjà
    // détecté) et seulement s'il figure parmi les fournisseurs ACTIFS chargés (jamais une valeur
    // que le `<Select>` ne pourrait pas représenter).
    if (fournisseurId !== '') return;
    const referencesFournisseurParArticle = requetesArticlesPreremplis.map(
      (requete) =>
        new Set(
          (requete.data?.references ?? [])
            .filter((refArticle) => refArticle.type === 'fournisseur' && refArticle.fournisseurId)
            .map((refArticle) => refArticle.fournisseurId as string),
        ),
    );
    const [premier, ...reste] = referencesFournisseurParArticle;
    if (!premier || premier.size === 0) return;
    const communs = [...premier].filter((id) => reste.every((ensemble) => ensemble.has(id)));
    if (communs.length !== 1) return;
    const idDetecte = communs[0] as string;
    if (fournisseurs.some((fournisseur) => fournisseur.id === idDetecte)) {
      setFournisseurId(idDetecte);
    }
  }, [requetesArticlesPreremplis, fournisseurs, fournisseurId, etatPreremplissage]);

  function ajouterLigne(
    articleId: string,
    numeroArticle: string,
    designation: string,
    prixVenteTtcCentimes: number,
  ) {
    if (idsDejaAjoutes.has(articleId)) return;
    setLignes((valeur) => [
      ...valeur,
      {
        articleId,
        numeroArticle,
        designation,
        quantiteSaisie: '1',
        prixAttenduCentimes: prixVenteTtcCentimes,
      },
    ]);
    recherche.onSaisieChange('');
  }

  function retirerLigne(articleId: string) {
    setLignes((valeur) => valeur.filter((ligne) => ligne.articleId !== articleId));
  }

  function majLigne(articleId: string, patch: Partial<LigneEnCours>) {
    setLignes((valeur) =>
      valeur.map((ligne) => (ligne.articleId === articleId ? { ...ligne, ...patch } : ligne)),
    );
  }

  function construireEntree(): EntreeCreationCommandeFournisseur | null {
    const lignesEntree: EntreeCreationCommandeFournisseur['lignes'] = [];
    for (const ligne of lignes) {
      const quantiteCommandeeMillieme = saisieVersQuantiteMillieme(ligne.quantiteSaisie);
      if (quantiteCommandeeMillieme === null) return null;
      lignesEntree.push({
        articleId: ligne.articleId,
        quantiteCommandeeMillieme,
        prixAchatAttenduCentimes: ligne.prixAttenduCentimes,
      });
    }
    return {
      fournisseurId,
      siteId,
      dateCommande: dateCommande === '' ? undefined : dateCommande,
      reference: reference.trim() === '' ? undefined : reference.trim(),
      // `reapprovisionnement` uniquement quand CET écran a été ouvert pré-rempli depuis
      // `EcranReapprovisionnement` — même si les lignes/quantités sont ensuite ajustées à la
      // main, l'origine de la démarche reste le réapprovisionnement (RP-12). `manuelle` dans
      // tous les autres cas (usage direct de l'écran), comme avant ce correctif.
      origine: etatPreremplissage !== undefined ? 'reapprovisionnement' : 'manuelle',
      lignes: lignesEntree,
    };
  }

  function soumettre() {
    setErreurValidation(null);
    if (!fournisseurId || !siteId) {
      setErreurValidation(t('validation:requis'));
      return;
    }
    if (lignes.length === 0) {
      setErreurValidation(t('pieces:commandes.nouvelle.aucuneLigne'));
      return;
    }

    const entree = construireEntree();
    if (entree === null) {
      setErreurValidation(t('validation:requis'));
      return;
    }

    const resultat = schemaCreationCommandeFournisseur.safeParse(entree);
    if (!resultat.success) {
      setErreurValidation(t('validation:requis'));
      return;
    }

    creer.mutate(
      { entree: resultat.data, idempotencyKey: idempotence.cle },
      {
        onSuccess: (reponse) => {
          idempotence.regenerer();
          navigate(`/pieces/commandes-fournisseur/${reponse.donnees.id}`);
        },
      },
    );
  }

  const enCours = creer.isPending;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
      <h1 className="texte-titre-page">{t('pieces:commandes.actions.creer')}</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cmd-fournisseur">{t('pieces:commandes.fournisseur')}</Label>
          {fournisseursRequete.isPending ? (
            <EtatChargement lignes={1} />
          ) : fournisseursRequete.isError ? (
            <EtatErreur
              titre={t('pieces:fournisseurs.erreur.titre')}
              description={messageErreur(fournisseursRequete.error, t)}
              onReessayer={() => void fournisseursRequete.refetch()}
            />
          ) : (
            <Select value={fournisseurId} onValueChange={setFournisseurId} disabled={enCours}>
              <SelectTrigger id="cmd-fournisseur" aria-label={t('pieces:commandes.fournisseur')}>
                <SelectValue placeholder={t('pieces:fournisseurs.titre')} />
              </SelectTrigger>
              <SelectContent>
                {fournisseurs.map((fournisseur) => (
                  <SelectItem key={fournisseur.id} value={fournisseur.id}>
                    {fournisseur.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cmd-site">{t('pieces:commandes.site')}</Label>
          <Select value={siteId} onValueChange={setSiteId} disabled={enCours}>
            <SelectTrigger id="cmd-site" aria-label={t('pieces:commandes.site')}>
              <SelectValue placeholder={t('pieces:stock.site')} />
            </SelectTrigger>
            <SelectContent>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cmd-date">{t('pieces:commandes.dateCommande')}</Label>
          <DateInput
            id="cmd-date"
            disabled={enCours}
            value={dateCommande}
            onChange={(valeurISO: string | undefined) => setDateCommande(valeurISO ?? '')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cmd-reference">{t('pieces:commandes.reference')}</Label>
          <Input
            id="cmd-reference"
            disabled={enCours}
            value={reference}
            onChange={(evenement) => setReference(evenement.target.value)}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 texte-libelle font-medium text-foreground">
          {t('pieces:commandes.lignes.titre')}
        </legend>

        {!siteId ? (
          <p className="texte-libelle text-muted-foreground">
            {t('pieces:commandes.nouvelle.choisirSiteDabord')}
          </p>
        ) : (
          <>
            <Input
              placeholder={t('pieces:rechercheComptoir.champRecherche')}
              value={recherche.saisie}
              onChange={(evenement) => recherche.onSaisieChange(evenement.target.value)}
              disabled={enCours}
            />
            {recherche.resultats && recherche.resultats.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {recherche.resultats.map((resultat) => (
                  <li key={resultat.articleId}>
                    <button
                      type="button"
                      disabled={idsDejaAjoutes.has(resultat.articleId) || enCours}
                      onClick={() =>
                        ajouterLigne(
                          resultat.articleId,
                          resultat.numeroArticle,
                          resultat.designation,
                          resultat.prixVenteTtcCentimes,
                        )
                      }
                      className="flex w-full items-center justify-between gap-2 rounded-md border p-2 texte-corps hover:bg-muted disabled:opacity-50"
                    >
                      <span className="flex flex-col items-start">
                        <span className="font-medium">{resultat.designation}</span>
                        <span className="font-mono texte-libelle text-muted-foreground">
                          {resultat.referencePrincipale}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formaterMontant(resultat.prixVenteTtcCentimes)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        {lignes.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {lignes.map((ligne) => (
              <li key={ligne.articleId} className="flex flex-col gap-2 rounded-md bg-muted p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="texte-corps font-medium">{ligne.designation}</span>
                  <button
                    type="button"
                    aria-label={t('commun:actions.annuler')}
                    onClick={() => retirerLigne(ligne.articleId)}
                    disabled={enCours}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`cmd-qte-${ligne.articleId}`}>
                      {t('pieces:commandes.lignes.quantiteCommandee')}
                    </Label>
                    <Input
                      id={`cmd-qte-${ligne.articleId}`}
                      type="text"
                      inputMode="decimal"
                      disabled={enCours}
                      value={ligne.quantiteSaisie}
                      onChange={(evenement) =>
                        majLigne(ligne.articleId, { quantiteSaisie: evenement.target.value })
                      }
                    />
                  </div>
                  <ChampMontant
                    id={`cmd-prix-${ligne.articleId}`}
                    label={t('pieces:commandes.lignes.prixAchatAttendu')}
                    disabled={enCours}
                    valeurCentimes={ligne.prixAttenduCentimes}
                    onChangeCentimes={(centimes) =>
                      majLigne(ligne.articleId, { prixAttenduCentimes: centimes })
                    }
                  />
                </div>
                {saisieVersQuantiteMillieme(ligne.quantiteSaisie) === null ? (
                  <p className="texte-libelle text-destructive">{t('validation:requis')}</p>
                ) : (
                  <p className="texte-libelle text-muted-foreground">
                    {formaterQuantiteMillieme(
                      saisieVersQuantiteMillieme(ligne.quantiteSaisie) ?? 0,
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>

      {erreurValidation ? (
        <p className="texte-libelle text-destructive">{erreurValidation}</p>
      ) : null}
      {creer.error ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(creer.error, t)}
        </p>
      ) : null}

      <Button type="button" className="w-full" disabled={enCours} onClick={soumettre}>
        {enCours ? t('commun:chargement.enCours') : t('pieces:commandes.actions.creer')}
      </Button>
    </div>
  );
}
