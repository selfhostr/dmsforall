import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { schemaEmail, schemaIde, type CandidatDoublonClient } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import {
  useDoublonsClients,
  type CriteresDoublonsClients,
} from '@/hooks/clients/useDoublonsClients';
import { chemins } from '@/routes/chemins';

const DELAI_DEBOUNCE_MS = 400;

/** `nom` exige `min(2)` côté contrat (`schemaParametresDoublonsClients`, @dfa/shared) — une lettre
 *  seule ne serait pas un critère valide, mais NE DOIT PAS produire un `400` visible pendant la
 *  frappe : on attend simplement la deuxième lettre avant d'interroger le serveur. */
function critereNom(saisie: string): string | undefined {
  const nettoyee = saisie.trim();
  return nettoyee.length >= 2 ? nettoyee : undefined;
}

/** NPA et téléphone n'ont, côté contrat, qu'une borne de longueur maximale — toute saisie non
 *  vide est un critère recevable. */
function critereSimple(saisie: string): string | undefined {
  const nettoyee = saisie.trim();
  return nettoyee === '' ? undefined : nettoyee;
}

/** Valide via le schéma PARTAGÉ (`schemaEmail`, jamais réécrit à la main) : une saisie encore
 *  incomplète (« j », « jean@ ») reste `undefined` plutôt que de déclencher un `400` pendant la
 *  frappe — le critère n'est envoyé qu'une fois syntaxiquement plausible. */
function critereEmail(saisie: string): string | undefined {
  const nettoyee = saisie.trim();
  if (nettoyee === '') return undefined;
  return schemaEmail.safeParse(nettoyee).success ? nettoyee : undefined;
}

/** `schemaIde` (@dfa/shared) exige le format exact `CHE-123.456.789` — même garde-fou anti-400
 *  que `critereEmail`, avec normalisation en majuscules (le schéma ne le fait pas lui-même, à la
 *  différence de `schemaCreationVehicule.vin`) avant validation. */
function critereIde(saisie: string): string | undefined {
  const nettoyee = saisie.trim().toUpperCase();
  if (nettoyee === '') return undefined;
  return schemaIde.safeParse(nettoyee).success ? nettoyee : undefined;
}

/**
 * Doublons clients (RM-05) — outil de recherche autonome, PAS l'aperçu live intégré à
 * `FormulaireNouveauClient.tsx` (même hook `useDoublonsClients`, même endpoint `GET
 * /doublons-clients`, usage différent) : ici on vérifie l'existant AVANT ou EN DEHORS d'une
 * création, typiquement pour dédoublonner une base après import ou avant d'ouvrir un dossier au
 * téléphone. Une seule route d'API existe (`GET /doublons-clients`) — pas de fusion depuis cet
 * écran : `POST /clients/{id}/fusionner` n'est pas exposée côté serveur à ce jour
 * (`client.controller.ts`, commentaire d'en-tête : « hors du périmètre demandé pour ce lot »).
 * `chemins.clients.fusion` et les clés `clients:fusion.*` existent déjà dans le contrat gelé pour
 * quand cette route le sera — pas de lien construit vers un écran qui n'existe pas encore.
 *
 * État vide NOMINAL, pas exceptionnel : « aucun doublon détecté » après une recherche est le cas
 * normal et heureux, rendu avec un ton positif dédié (jamais le même gris que « aucun critère
 * saisi » ou qu'une erreur).
 */
export function EcranDoublonsClients() {
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  // Même convention que le reste du lot (routes/chemins.ts) : le site reste dans l'URL, jamais un
  // état global. `exclureClientId` est optionnel — permet à un futur appelant (fiche client) de
  // renvoyer ici sans se signaler lui-même comme son propre doublon.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const exclureClientId = searchParams.get('exclureClientId') ?? undefined;

  const [nom, setNom] = useState('');
  const [npa, setNpa] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');
  const [ide, setIde] = useState('');

  const [criteres, setCriteres] = useState<CriteresDoublonsClients>({});

  useEffect(() => {
    const identifiant = setTimeout(() => {
      setCriteres({
        nom: critereNom(nom),
        npa: critereSimple(npa),
        email: critereEmail(email),
        telephoneMobile: critereSimple(telephone),
        ide: critereIde(ide),
        exclureClientId,
      });
    }, DELAI_DEBOUNCE_MS);
    return () => clearTimeout(identifiant);
  }, [nom, npa, email, telephone, ide, exclureClientId]);

  const requete = useDoublonsClients(criteres);
  const candidats = requete.data?.candidats ?? [];
  const auMoinsUnCritereSaisi =
    nom.trim() !== '' ||
    npa.trim() !== '' ||
    email.trim() !== '' ||
    telephone.trim() !== '' ||
    ide.trim() !== '';
  const auMoinsUnCritereEffectif = Boolean(
    criteres.nom ?? criteres.npa ?? criteres.email ?? criteres.telephoneMobile ?? criteres.ide,
  );

  const effacer = () => {
    setNom('');
    setNpa('');
    setEmail('');
    setTelephone('');
    setIde('');
  };

  const estErreurReseau = requete.error instanceof ErreurReseau;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="texte-titre font-semibold text-foreground">
          {t('clients:doublonsEcran.titre')}
        </h1>
        <p className="texte-corps text-muted-foreground">
          {t('clients:doublonsEcran.description')}
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2">
            <Label htmlFor="dc-nom">{t('clients:doublonsEcran.champs.nom')}</Label>
            <Input
              id="dc-nom"
              value={nom}
              onChange={(evenement) => setNom(evenement.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dc-npa">{t('clients:doublonsEcran.champs.npa')}</Label>
            <Input
              id="dc-npa"
              value={npa}
              onChange={(evenement) => setNpa(evenement.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dc-email">{t('clients:doublonsEcran.champs.email')}</Label>
            <Input
              id="dc-email"
              type="email"
              value={email}
              onChange={(evenement) => setEmail(evenement.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dc-telephone">{t('clients:doublonsEcran.champs.telephone')}</Label>
            <Input
              id="dc-telephone"
              type="tel"
              value={telephone}
              onChange={(evenement) => setTelephone(evenement.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dc-ide">{t('clients:doublonsEcran.champs.ide')}</Label>
            <Input
              id="dc-ide"
              placeholder="CHE-123.456.789"
              value={ide}
              onChange={(evenement) => setIde(evenement.target.value)}
            />
          </div>
        </CardContent>
        {auMoinsUnCritereSaisi ? (
          <CardContent className="pt-0">
            <Button type="button" variant="ghost" onClick={effacer}>
              {t('commun:actions.effacerFiltres')}
            </Button>
          </CardContent>
        ) : null}
      </Card>

      {!auMoinsUnCritereEffectif ? (
        <EtatVide
          titre={t('clients:doublonsEcran.vide.premier')}
          description={t('clients:doublonsEcran.vide.premierDescription')}
        />
      ) : requete.isPending ? (
        <EtatChargement lignes={3} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'clients:doublonsEcran.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : candidats.length === 0 ? (
        <div
          role="status"
          className="flex flex-col items-center gap-3 rounded-lg border border-statut-succes bg-statut-succes-fond p-10 text-center"
        >
          <CheckCircle2 aria-hidden className="h-8 w-8 text-statut-succes" />
          <h2 className="text-lg font-semibold text-foreground">
            {t('clients:doublonsEcran.vide.aucunDoublon')}
          </h2>
          <p className="max-w-md text-muted-foreground">
            {t('clients:doublonsEcran.vide.aucunDoublonDescription')}
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="texte-titre-section">
              {t('clients:doublonsEcran.resultats', { count: candidats.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {candidats.map((candidat: CandidatDoublonClient) => (
                <li
                  key={`${candidat.clientId}-${candidat.critere}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate texte-corps font-medium text-foreground">
                      {candidat.nom}{' '}
                      <span className="texte-libelle text-muted-foreground">
                        {candidat.numeroClient}
                      </span>
                    </p>
                    <p className="texte-libelle text-muted-foreground">
                      {t(`clients:doublons.criteres.${candidat.critere}`)} ·{' '}
                      {t('clients:doublons.score')} {Math.round(candidat.score * 100)} %
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={chemins.clients.detail(candidat.clientId, site)}>
                      {t('clients:doublons.voir')}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default EcranDoublonsClients;
