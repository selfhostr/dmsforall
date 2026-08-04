import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import type { ClientResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { BandeauAlerteClient } from '@/composants/motifs/BandeauAlerteClient';
import { useClient } from '@/hooks/clients/useClient';
import { useOrdresClient } from '@/hooks/clients/useOrdresClient';
import { useVehiculesClient } from '@/hooks/clients/useVehiculesClient';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { OngletAdresses } from './onglets/OngletAdresses';
import { OngletConditions } from './onglets/OngletConditions';
import { OngletConsentements } from './onglets/OngletConsentements';
import { OngletContacts } from './onglets/OngletContacts';
import { OngletNotes } from './onglets/OngletNotes';
import { texteOuVide } from './utils';

/** `chemins.ts` (routes/) n'a pas encore d'entrée Atelier — module en cours de câblage par un
 *  autre agent (périmètre disjoint, voir routeur.tsx : `EcranFonctionAVenir`). Même sémantique que
 *  `construireChemin` : le site n'est ajouté que s'il est déjà défini, jamais inventé — répété ici
 *  plutôt que d'éditer un fichier hors périmètre. */
function cheminOr(id: string, site: string | undefined): string {
  return site
    ? `/ordres-reparation/${id}?site=${encodeURIComponent(site)}`
    : `/ordres-reparation/${id}`;
}

function cheminNouvelOr(clientId: string, site: string | undefined): string {
  const parametres = new URLSearchParams({ clientId });
  if (site) parametres.set('site', site);
  return `/atelier/ordres-reparation/nouveau?${parametres.toString()}`;
}

/** `:id` — convention assumée en l'absence de routage câblé à ce jour (hors périmètre, un agent
 *  dédié câble `src/routes/routeur.tsx`) ; à ajuster ici si le nom réel du paramètre diffère. */
export function EcranFicheClient() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  const navigate = useNavigate();
  // Le site sélectionné est un paramètre de requête, jamais un état global (routes/chemins.ts) :
  // deux onglets sur deux sites différents ne doivent pas se contredire.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const requete = useClient(id);
  const vehicules = useVehiculesClient(id);
  const ordres = useOrdresClient(id);

  if (requete.isLoading) {
    return (
      <div className="p-6">
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (requete.isError || !requete.data) {
    const estErreurReseau = requete.error instanceof ErreurReseau;
    return (
      <div className="p-6">
        <EtatErreur
          titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
          description={requete.error ? messageErreur(requete.error, t) : ''}
          onReessayer={() => void requete.refetch()}
        />
      </div>
    );
  }

  const client = requete.data;
  const lignesVehicules = vehicules.data?.pages.flatMap((page) => page.donnees) ?? [];
  const lignesOrdres = ordres.data?.pages.flatMap((page) => page.donnees) ?? [];

  // `IdentiteClient` prend un `ClientResume` (projection de LISTE) ; `GET /clients/{id}` renvoie
  // `ReponseClient` (fiche complète), qui n'a pas `localite`/`nombreVehicules` — des agrégats que
  // `IdentiteClient` ne lit d'ailleurs pas (seuls nomAffiche/numeroClient/statut le sont). Valeurs
  // neutres ci-dessous, jamais affichées.
  const clientPourIdentite: ClientResume = {
    id: client.id,
    numeroClient: client.numeroClient,
    nomAffiche: client.nomAffiche,
    type: client.type,
    statut: client.statut,
    langueCorrespondance: client.langueCorrespondance,
    poObligatoire: client.poObligatoire,
    telephone: client.telephone,
    localite: null,
    nombreVehicules: 0,
    dernierPassageLe: client.dernierPassageLe,
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <BandeauAlerteClient
        bloque={client.statut === 'bloque'}
        alertes={client.notesAlerte.map((note) => ({ id: note.id, texte: note.texte }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="texte-libelle text-muted-foreground">{t('clients:fiche.titre')}</p>
          <IdentiteClient
            client={clientPourIdentite}
            alerte={client.notesAlerte.length > 0}
            className="mt-1"
          />
        </div>
        {/* Action primaire unique de la fiche (RM-21) — chemin assumé en l'absence de câblage
         *  du module atelier à ce jour, à ajuster par l'agent de routage si besoin. */}
        <Button type="button" onClick={() => navigate(cheminNouvelOr(client.id, site))}>
          <Wrench aria-hidden className="h-4 w-4" />
          {t('clients:fiche.ouvrirOr')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 texte-corps">
            <dt className="text-muted-foreground">{t('clients:identite.ide')}</dt>
            <dd>{texteOuVide(client.ide)}</dd>
            <dt className="text-muted-foreground">{t('clients:identite.langue')}</dt>
            <dd>{t(`commun:langues.${client.langueCorrespondance}`)}</dd>
            <dt className="text-muted-foreground">{t('clients:identite.telephone')}</dt>
            <dd>{texteOuVide(client.telephone)}</dd>
            <dt className="text-muted-foreground">{t('clients:identite.email')}</dt>
            <dd>{texteOuVide(client.email)}</dd>
            {client.poObligatoire ? (
              <>
                <dt className="text-muted-foreground">{t('clients:identite.po')}</dt>
                <dd className="font-medium text-foreground">{t('clients:identite.po')}</dd>
              </>
            ) : null}
          </dl>

          <OngletConditions clientId={client.id} />

          <Tabs defaultValue="contacts">
            <TabsList>
              <TabsTrigger value="contacts">{t('clients:fiche.onglets.contacts')}</TabsTrigger>
              <TabsTrigger value="adresses">{t('clients:fiche.onglets.adresses')}</TabsTrigger>
              <TabsTrigger value="consentements">
                {t('clients:fiche.onglets.consentements')}
              </TabsTrigger>
              <TabsTrigger value="notes">{t('clients:fiche.onglets.notes')}</TabsTrigger>
            </TabsList>
            <TabsContent value="contacts" className="pt-4">
              <OngletContacts clientId={client.id} />
            </TabsContent>
            <TabsContent value="adresses" className="pt-4">
              <OngletAdresses clientId={client.id} />
            </TabsContent>
            <TabsContent value="consentements" className="pt-4">
              <OngletConsentements clientId={client.id} />
            </TabsContent>
            <TabsContent value="notes" className="pt-4">
              <OngletNotes clientId={client.id} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="min-w-0 space-y-6">
          <section className="space-y-2">
            <h2 className="texte-titre-section font-medium text-foreground">
              {t('clients:fiche.vehicules')}
            </h2>
            {vehicules.isLoading ? (
              <EtatChargement lignes={2} />
            ) : lignesVehicules.length === 0 ? (
              <p className="texte-corps text-muted-foreground">
                {t('clients:fiche.vehiculesVide')}
              </p>
            ) : (
              <ul className="space-y-2">
                {lignesVehicules.map((vehicule) => (
                  <li key={vehicule.id}>
                    <button
                      type="button"
                      onClick={() => navigate(chemins.vehicules.detail(vehicule.id, site))}
                      className="w-full rounded-md border p-3 text-left hover:bg-muted"
                    >
                      <IdentiteVehicule vehicule={vehicule} taillePlaque="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="texte-titre-section font-medium text-foreground">
              {t('clients:fiche.derniersOr')}
            </h2>
            {ordres.isLoading ? (
              <EtatChargement lignes={2} />
            ) : lignesOrdres.length === 0 ? (
              <p className="texte-corps text-muted-foreground">
                {t('clients:fiche.derniersOrVide')}
              </p>
            ) : (
              <ul className="space-y-2">
                {lignesOrdres.map((or) => (
                  <li key={or.id}>
                    <button
                      type="button"
                      onClick={() => navigate(cheminOr(or.id, site))}
                      className="w-full space-y-1 rounded-md border p-3 text-left hover:bg-muted"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="texte-corps font-medium text-foreground">{or.numero}</span>
                        <BadgeStatutOr etat={or.etatAffiche} />
                      </div>
                      <span className="texte-libelle text-muted-foreground">
                        {or.ouvertLe ? formaterDate(or.ouvertLe) : texteOuVide(null)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
