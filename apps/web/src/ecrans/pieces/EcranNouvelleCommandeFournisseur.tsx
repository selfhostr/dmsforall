import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

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
import { useCreerCommandeFournisseur } from '@/hooks/pieces/useCreerCommandeFournisseur';
import { useListeFournisseurs } from '@/hooks/pieces/useListeFournisseurs';
import { useRechercheComptoirPieces } from '@/hooks/pieces/useRechercheComptoirPieces';
import { useSession } from '@/hooks/useSession';
import { formaterMontant } from '@/lib/formats';

import { formaterQuantiteMillieme, saisieVersQuantiteMillieme } from './utils';

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
 */
export function EcranNouvelleCommandeFournisseur() {
  const { t } = useTranslation(['pieces', 'commun', 'validation', 'erreurs']);
  const navigate = useNavigate();
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
  const [siteId, setSiteId] = useState('');
  const [dateCommande, setDateCommande] = useState('');
  const [reference, setReference] = useState('');
  const [lignes, setLignes] = useState<readonly LigneEnCours[]>([]);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  const recherche = useRechercheComptoirPieces(siteId || undefined);

  const idsDejaAjoutes = useMemo(() => new Set(lignes.map((ligne) => ligne.articleId)), [lignes]);

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
      origine: 'manuelle',
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
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('pieces:commandes.actions.creer')}
      </h1>

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
