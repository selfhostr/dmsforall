import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ClientResume, ReponseDocumentVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useListeClients } from '@/hooks/clients/useListeClients';
import { useVehiculesClient } from '@/hooks/clients/useVehiculesClient';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useCreerDevis } from '@/hooks/facturation/useCreerDevis';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useSitePrincipal } from '@/hooks/site/useSitePrincipal';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

const SANS_VEHICULE = '__aucun__';

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** Client déjà connu (entrée depuis sa fiche) : le champ de recherche disparaît. */
  readonly client?: Pick<ClientResume, 'id' | 'nomAffiche'>;
  /** Véhicule présélectionné (entrée depuis sa fiche) ; l'utilisateur peut encore le retirer. */
  readonly vehiculeIdInitial?: string;
}

/**
 * « Nouveau devis » : pour un client, avec ou sans véhicule — la réponse à « combien pour changer
 * les freins ? » sans ouvrir un OR (qui exige, lui, un véhicule réceptionné et un kilométrage).
 * Crée un devis en brouillon puis l'ouvre pour y poser les lignes (main-d'œuvre, pièces). L'OR se
 * crée ensuite DEPUIS le devis envoyé (fiche du devis, `POST .../creer-ordre-reparation`) : un
 * formulaire d'OR vierge ouvert d'ici ne reprendrait ni les lignes ni le lien avec le devis.
 */
export function DialogueNouveauDevis({
  ouvert,
  onOuvertChange,
  client: clientFixe,
  vehiculeIdInitial,
}: Props) {
  const { t } = useTranslation(['facturation', 'commun']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const session = useSession();
  const creation = useCreerDevis();

  const sites = (session.data?.sites ?? []).filter((site) => site.actif);
  const siteUrl = searchParams.get('site') ?? undefined;
  const { estMonoSite, siteId: siteImplicite } = useSiteImplicite();

  const [recherche, setRecherche] = useState('');
  const [rechercheTemporisee] = useValeurDebouncee(recherche.trim(), 300);
  const [clientChoisi, setClientChoisi] = useState<Pick<ClientResume, 'id' | 'nomAffiche'> | null>(
    null,
  );
  const [vehiculeId, setVehiculeId] = useState(vehiculeIdInitial ?? SANS_VEHICULE);
  const [siteChoisi, setSiteChoisi] = useState<string | undefined>(undefined);
  const [erreurClient, setErreurClient] = useState(false);
  const [devisCree, setDevisCree] = useState<ReponseDocumentVente | null>(null);

  const client = clientFixe ?? clientChoisi;
  // Le site du devis : celui de l'URL, sinon le choix du formulaire, sinon le site principal.
  const sitePrincipal = useSitePrincipal();
  const siteId = siteUrl ?? siteChoisi ?? sitePrincipal ?? siteImplicite;

  const resultats = useListeClients(
    { q: rechercheTemporisee },
    { enabled: !clientFixe && !clientChoisi && rechercheTemporisee.length >= 2 },
  );
  const clientsTrouves = resultats.data?.pages.flatMap((page) => page.donnees) ?? [];
  const vehicules = useVehiculesClient(client?.id);
  const vehiculesClient = vehicules.data?.pages.flatMap((page) => page.donnees) ?? [];

  function fermer(valeur: boolean) {
    if (!valeur) {
      creation.reset();
      setDevisCree(null);
      setErreurClient(false);
      setClientChoisi(null);
      setRecherche('');
      setVehiculeId(vehiculeIdInitial ?? SANS_VEHICULE);
    }
    onOuvertChange(valeur);
  }

  function creer() {
    if (!client) {
      setErreurClient(true);
      return;
    }
    if (!siteId) return;
    setErreurClient(false);
    creation.mutate(
      {
        siteId,
        clientId: client.id,
        vehiculeId: vehiculeId === SANS_VEHICULE ? undefined : vehiculeId,
      },
      { onSuccess: (reponse) => setDevisCree(reponse.donnees) },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={fermer}>
      <DialogContent>
        {devisCree ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('facturation:devis.cree.titre')}</DialogTitle>
              <DialogDescription>{t('facturation:devis.cree.description')}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-wrap">
              <Button
                type="button"
                onClick={() => {
                  fermer(false);
                  navigate(chemins.facturation.detail(devisCree.id, siteId));
                }}
              >
                {t('facturation:devis.cree.ouvrir')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(evenement) => {
              evenement.preventDefault();
              creer();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('facturation:devis.nouveau.titre')}</DialogTitle>
              <DialogDescription>{t('facturation:devis.nouveau.description')}</DialogDescription>
            </DialogHeader>

            <LegendeChampsObligatoires>
              {t('commun:formulaires.champsObligatoiresLegende')}
            </LegendeChampsObligatoires>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="devis-client" requis>
                {t('facturation:devis.nouveau.client')}
              </Label>
              {client ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="texte-corps font-medium">{client.nomAffiche}</span>
                  {clientFixe ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setClientChoisi(null);
                        setVehiculeId(SANS_VEHICULE);
                      }}
                    >
                      {t('commun:actions.modifier')}
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <Input
                    id="devis-client"
                    value={recherche}
                    autoComplete="off"
                    aria-required="true"
                    placeholder={t('facturation:devis.nouveau.clientPlaceholder')}
                    onChange={(evenement) => setRecherche(evenement.target.value)}
                  />
                  {erreurClient ? (
                    <p role="alert" className="texte-libelle text-destructive">
                      {t('facturation:devis.nouveau.clientRequis')}
                    </p>
                  ) : null}
                  {resultats.isError ? (
                    <p role="alert" className="texte-libelle text-destructive">
                      {messageErreur(resultats.error, t)}
                    </p>
                  ) : null}
                  {rechercheTemporisee.length >= 2 &&
                  !resultats.isPending &&
                  clientsTrouves.length === 0 ? (
                    <p className="texte-libelle text-muted-foreground">
                      {t('facturation:devis.nouveau.aucunClient')}
                    </p>
                  ) : null}
                  {clientsTrouves.length > 0 ? (
                    <ul className="flex max-h-48 flex-col overflow-y-auto">
                      {clientsTrouves.map((candidat) => (
                        <li key={candidat.id}>
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left texte-corps hover:bg-muted"
                            onClick={() => setClientChoisi(candidat)}
                          >
                            <span className="font-medium">{candidat.nomAffiche}</span>
                            <span className="texte-libelle text-muted-foreground">
                              {candidat.localite ?? candidat.numeroClient}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </div>

            {client ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="devis-vehicule">{t('facturation:devis.nouveau.vehicule')}</Label>
                <Select value={vehiculeId} onValueChange={setVehiculeId}>
                  <SelectTrigger
                    id="devis-vehicule"
                    aria-label={t('facturation:devis.nouveau.vehicule')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SANS_VEHICULE}>
                      {t('facturation:devis.nouveau.sansVehicule')}
                    </SelectItem>
                    {vehiculesClient.map((vehicule) => (
                      <SelectItem key={vehicule.id} value={vehicule.id}>
                        {[vehicule.plaque, vehicule.designation].filter(Boolean).join(' · ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="texte-libelle text-muted-foreground">
                  {t('facturation:devis.nouveau.vehiculeAide')}
                </p>
              </div>
            ) : null}

            {!siteUrl && !estMonoSite && sites.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="devis-site" requis>
                  {t('facturation:devis.nouveau.site')}
                </Label>
                <Select value={siteChoisi ?? sitePrincipal} onValueChange={setSiteChoisi}>
                  <SelectTrigger
                    id="devis-site"
                    aria-label={t('facturation:devis.nouveau.site')}
                    aria-required="true"
                  >
                    <SelectValue placeholder={t('facturation:devis.nouveau.site')} />
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
            ) : null}

            {creation.isError ? (
              <p role="alert" className="texte-libelle text-destructive">
                {messageErreur(creation.error, t)}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => fermer(false)}>
                {t('commun:actions.annuler')}
              </Button>
              <Button type="submit" enChargement={creation.isPending} disabled={!siteId}>
                {t('facturation:devis.nouveau.creer')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
