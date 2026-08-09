import type { GarageConsole, NiveauSanteGarage } from '@dfa/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { messageErreur } from '@/api/erreurs';
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
import { EtatVide } from '@/composants/commun/EtatVide';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';

import { ConsoleShell } from './ConsoleShell';
import {
  calculerIndicateursConsole,
  garageCorrespondAIndicateur,
  type IdIndicateurConsole,
} from './indicateurs-plateforme';
import { IndicateursPlateformeConsole } from './IndicateursPlateformeConsole';
import { TableGaragesConsole } from './TableGaragesConsole';
import { useVuePlateformeConsole } from './useVuePlateformeConsole';

const STATUTS_FILTRE_GARAGE: readonly NiveauSanteGarage[] = ['critique', 'attention', 'ok'];

/**
 * Chemin du palier 2 (§1 de la conception : `/console/garages/:tenantId`) — la ROUTE elle-même
 * n'est pas montée par ce lot (hors périmètre d'écriture : `routes/`, palier 2 non construit,
 * décision de @laupernoe non prise sur le modèle d'accès). Le lien pointe donc, pour l'instant, vers une
 * page qui répond `EcranPageIntrouvable` : attendu, pas une régression de cet écran — signalé au
 * coordinateur comme le chemin exact dont le câblage de route aura besoin.
 */
function construireCheminGarageConsole(tenantId: string): string {
  return `/console/garages/${tenantId}`;
}

/**
 * Palier 1 — vue plateforme (`docs/conception-console-exploitation-ecrans.md` §2). Seul écran de
 * ce lot : un tableau de bord d'agrégats SANS AUCUNE donnée personnelle (porte 1,
 * `conception-console-exploitation-acces.md` §4.5), qui répond à « où ça va mal, là, sur
 * l'ensemble des garages ? ». Chaque carte d'indicateur filtre la table en dessous — voir
 * `IndicateursPlateformeConsole`/`indicateurs-plateforme.ts`, seule source de vérité partagée
 * entre le total affiché sur la carte et le filtre appliqué à la table.
 *
 * Filtrage et tri intégralement CÔTÉ CLIENT (§2 : « une dizaine de garages », pas une recherche
 * serveur) — deux filtres combinables (texte, statut), jamais de debounce puisqu'aucune requête
 * réseau n'est déclenchée par la saisie. La recherche texte porte sur la raison sociale et le
 * `slug` : le contrat `GarageConsole` (`@dfa/shared`) ne porte ni ville ni canton — porte 1, aucune
 * donnée d'adresse (`docs/conception-console-exploitation-acces.md` §4.5).
 */
export function EcranConsolePlateforme() {
  const { t } = useTranslation(['console', 'commun']);
  const navigate = useNavigate();
  const requete = useVuePlateformeConsole();

  const [qSaisie, setQSaisie] = useState('');
  const [statutFiltre, setStatutFiltre] = useState<NiveauSanteGarage | undefined>(undefined);
  const [filtreIndicateur, setFiltreIndicateur] = useState<IdIndicateurConsole | null>(null);

  const garages = requete.data?.garages ?? [];
  const indisponibles = requete.data?.resume.indicateursIndisponibles ?? [];
  const indicateurs = useMemo(() => calculerIndicateursConsole(garages), [garages]);

  const texteNormalise = qSaisie.trim().toLowerCase();
  const garagesFiltres = useMemo(() => {
    return garages.filter((garage) => {
      if (statutFiltre !== undefined && garage.niveau !== statutFiltre) return false;
      if (filtreIndicateur !== null && !garageCorrespondAIndicateur(garage, filtreIndicateur)) {
        return false;
      }
      if (texteNormalise !== '') {
        const cible = `${garage.raisonSociale} ${garage.slug}`.toLowerCase();
        if (!cible.includes(texteNormalise)) return false;
      }
      return true;
    });
  }, [garages, statutFiltre, filtreIndicateur, texteNormalise]);

  const filtresActifs =
    texteNormalise !== '' || statutFiltre !== undefined || filtreIndicateur !== null;

  function effacerFiltres() {
    setQSaisie('');
    setStatutFiltre(undefined);
    setFiltreIndicateur(null);
  }

  function onEntrer(garage: GarageConsole) {
    navigate(construireCheminGarageConsole(garage.tenantId));
  }

  if (requete.isPending) {
    return (
      <ConsoleShell>
        <div className="flex flex-col gap-6">
          <h1 className="texte-titre font-semibold text-foreground">
            {t('console:plateforme.titre')}
          </h1>
          <EtatChargement lignes={6} />
        </div>
      </ConsoleShell>
    );
  }

  if (requete.isError) {
    return (
      <ConsoleShell>
        <div className="flex flex-col gap-6">
          <h1 className="texte-titre font-semibold text-foreground">
            {t('console:plateforme.titre')}
          </h1>
          <EtatErreur
            titre={t('console:plateforme.etatErreur.titre')}
            description={messageErreur(requete.error, t)}
            onReessayer={() => void requete.refetch()}
          />
        </div>
      </ConsoleShell>
    );
  }

  let contenuVide: ReactNode = undefined;
  if (garages.length === 0) {
    contenuVide = (
      <EtatVide
        titre={t('console:plateforme.etatVide.titre')}
        description={t('console:plateforme.etatVide.description')}
      />
    );
  } else if (garagesFiltres.length === 0) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('console:plateforme.etatVideFiltre.titre')}
        description={t('console:plateforme.etatVideFiltre.description')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  }

  const indicateurFiltreActif = indicateurs.find((candidat) => candidat.id === filtreIndicateur);

  return (
    <ConsoleShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="texte-titre font-semibold text-foreground">
            {t('console:plateforme.titre')}
          </h1>
          <p className="texte-corps text-muted-foreground">{t('console:plateforme.sousTitre')}</p>
        </div>

        <IndicateursPlateformeConsole
          valeurs={indicateurs}
          filtreActif={filtreIndicateur}
          onBasculerFiltre={(id) =>
            setFiltreIndicateur((precedent) => (precedent === id ? null : id))
          }
          indisponibles={indisponibles}
        />

        <BarreFiltres
          q={qSaisie}
          onChangeQ={setQSaisie}
          placeholderRecherche={t('console:plateforme.recherche.placeholder')}
          filtresActifs={filtresActifs}
          onEffacerFiltres={effacerFiltres}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filtre-statut-garage">
              {t('console:plateforme.statutFiltre.label')}
            </Label>
            <Select
              value={statutFiltre ?? 'tous'}
              onValueChange={(valeur) =>
                setStatutFiltre(valeur === 'tous' ? undefined : (valeur as NiveauSanteGarage))
              }
            >
              <SelectTrigger
                id="filtre-statut-garage"
                className="w-[160px]"
                aria-label={t('console:plateforme.statutFiltre.label')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">{t('console:plateforme.statutFiltre.tous')}</SelectItem>
                {STATUTS_FILTRE_GARAGE.map((valeur) => (
                  <SelectItem key={valeur} value={valeur}>
                    {t(`console:plateforme.statut.${valeur}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </BarreFiltres>

        {indicateurFiltreActif ? (
          <div
            role="status"
            className="flex items-center gap-2 texte-libelle text-muted-foreground"
          >
            <span>
              {t('console:plateforme.filtre.actif', {
                libelle: t(`console:plateforme.indicateurs.${indicateurFiltreActif.id}.libelle`),
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFiltreIndicateur(null)}
            >
              {t('console:plateforme.filtre.retirer')}
            </Button>
          </div>
        ) : null}

        <TableGaragesConsole
          garages={garagesFiltres}
          enChargement={false}
          onEntrer={onEntrer}
          contenuVide={contenuVide}
        />
      </div>
    </ConsoleShell>
  );
}
