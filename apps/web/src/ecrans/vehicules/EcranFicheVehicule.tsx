import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BlocDonneesAtelier } from '@/composants/vehicule/BlocDonneesAtelier';
import { BlocEcheances } from '@/composants/vehicule/BlocEcheances';
import { EncartAlertesVehicule } from '@/composants/vehicule/EncartAlertesVehicule';
import { FriseDetentions } from '@/composants/vehicule/FriseDetentions';
import { FriseKilometrage } from '@/composants/vehicule/FriseKilometrage';
import { ListeTravauxReportes } from '@/composants/vehicule/ListeTravauxReportes';
import { useContexteAtelier } from '@/hooks/vehicules/useContexteAtelier';
import { useDetentionsVehicule } from '@/hooks/vehicules/useDetentionsVehicule';
import { useKilometragesVehicule } from '@/hooks/vehicules/useKilometragesVehicule';
import { useVehicule } from '@/hooks/vehicules/useVehicule';

import { EnTeteFicheVehicule } from './EnTeteFicheVehicule';
import { FormulaireKilometrage } from './FormulaireKilometrage';

/**
 * Fiche véhicule — ce que le comptoir doit voir en ouvrant un dossier : identité, alertes SANS
 * CLIQUER (`EncartAlertesVehicule`, alimenté par `contexte-atelier`), échéances, données
 * d'atelier, travaux reportés, historiques kilométrage/détention.
 *
 * Deux requêtes PRIMAIRES bloquent l'écran entier (véhicule + contexte-atelier, la donnée qui
 * fait la valeur du produit) ; kilométrages et détentions sont SECONDAIRES et gèrent leur
 * chargement/erreur par section, pour qu'un historique en échec n'empêche jamais de voir les
 * alertes.
 */
export function EcranFicheVehicule() {
  const { t } = useTranslation(['vehicules', 'commun']);
  const { vehiculeId } = useParams<{ vehiculeId: string }>();
  const [formulaireKmOuvert, setFormulaireKmOuvert] = useState(false);

  const requeteVehicule = useVehicule(vehiculeId);
  const requeteContexte = useContexteAtelier(vehiculeId);
  const requeteKilometrages = useKilometragesVehicule(vehiculeId);
  const requeteDetentions = useDetentionsVehicule(vehiculeId);

  if (requeteVehicule.isPending || requeteContexte.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('commun:titres.vehiculeDetail')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requeteVehicule.isError || requeteContexte.isError) {
    const erreur = requeteVehicule.error ?? requeteContexte.error;
    return (
      <div className="flex flex-col gap-6">
        <h1 className="sr-only">{t('commun:titres.vehiculeDetail')}</h1>
        <EtatErreur
          titre={t('vehicules:fiche.erreur.titre')}
          description={messageErreur(erreur, t)}
          onReessayer={() => {
            void requeteVehicule.refetch();
            void requeteContexte.refetch();
          }}
        />
      </div>
    );
  }

  const vehicule = requeteVehicule.data;
  const contexte = requeteContexte.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t('commun:titres.vehiculeDetail')}</h1>

      <EnTeteFicheVehicule vehicule={vehicule} dernierKilometrage={contexte.dernierKilometrage} />

      <EncartAlertesVehicule
        travauxReportes={contexte.travauxReportes}
        campagnesOuvertes={contexte.campagnesOuvertes}
        expertise={contexte.expertise}
        garantie={contexte.garantie}
        importe={contexte.vehicule.importe}
        alertesClient={contexte.alertesClient}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <BlocEcheances
          expertise={contexte.expertise}
          garantieConstructeur={contexte.garantie.constructeur}
          garantieGarage={contexte.garantie.garage}
        />
        <BlocDonneesAtelier donnees={vehicule} />
      </div>

      <ListeTravauxReportes travaux={contexte.travauxReportes.elements} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="texte-titre-section">{t('vehicules:kilometrage.titre')}</CardTitle>
          <Button type="button" variant="outline" onClick={() => setFormulaireKmOuvert(true)}>
            {t('vehicules:kilometrage.relever')}
          </Button>
        </CardHeader>
        <CardContent>
          {requeteKilometrages.isPending ? (
            <EtatChargement lignes={3} />
          ) : requeteKilometrages.isError ? (
            <EtatErreur
              titre={t('vehicules:fiche.erreurSection.titre')}
              description={messageErreur(requeteKilometrages.error, t)}
              onReessayer={() => void requeteKilometrages.refetch()}
            />
          ) : (
            <FriseKilometrage releves={requeteKilometrages.data} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('vehicules:detentions.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          {requeteDetentions.isPending ? (
            <EtatChargement lignes={3} />
          ) : requeteDetentions.isError ? (
            <EtatErreur
              titre={t('vehicules:fiche.erreurSection.titre')}
              description={messageErreur(requeteDetentions.error, t)}
              onReessayer={() => void requeteDetentions.refetch()}
            />
          ) : (
            <FriseDetentions detentions={requeteDetentions.data} />
          )}
        </CardContent>
      </Card>

      {vehiculeId ? (
        <FormulaireKilometrage vehiculeId={vehiculeId} ouvert={formulaireKmOuvert} onOuvertChange={setFormulaireKmOuvert} />
      ) : null}
    </div>
  );
}
