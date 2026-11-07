import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { schemaFiltresSuiviVente, type FiltresSuiviVente } from '@dfa/shared';

import { ServiceContexteRequete } from '../common/contexte';
import { ExigerDroit, GardeDroit } from '../common/droits';
import { ApiReponseProbleme } from '../common/erreurs';
import { PipeZod } from '../common/validation';

import { PageSuiviVenteDto } from './dto';
import { ServiceSuiviVente } from './service-suivi-vente';
import { ExigerModule } from '../common/droits/garde-module';

/**
 * Suivi financement/garantie (`GET /ventes/suivi`) — VUE dérivée, en lecture seule, sur
 * `dossier_vente` × `financement_vente` × `vehicule` (garantie). Répond au besoin « quelles
 * échéances arrivent, une couverture est-elle encore valable, quels dossiers demandent une
 * action » — voir l'en-tête de `contrats/ventes/suivi.ts` pour la doctrine complète (ce qui est
 * honnêtement calculable, la garde RF-116 sur `dureeMois`/`echeanceLe` du financement).
 *
 * Route DÉLIBÉRÉMENT hors de `dossiers-vente/**` (pas `GET /dossiers-vente/suivi`) : un segment
 * statique ajouté APRÈS `GET /dossiers-vente/:dossierVenteId` (déjà enregistré dans
 * `DossierVenteController`) matcherait `:dossierVenteId` en premier pour toute requête vers ce
 * chemin (Nest/Express résolvent les routes dans l'ordre de déclaration, `:dossierVenteId` n'est
 * pas contraint au format uuid au niveau du routeur) — un contrôleur séparé, sur un chemin
 * disjoint, élimine ce risque de collision plutôt que de dépendre d'un ordre de déclaration
 * correct à préserver indéfiniment dans un fichier déjà long.
 *
 * DROIT : `ventes.dossier.lire` — même droit que `GET /dossiers-vente`, cette vue ne fait
 * qu'agréger et filtrer des données déjà accessibles par ce droit pour ce qui concerne le
 * DOSSIER/véhicule (`ventes/references.ts` lit déjà la table `vehicule` sous ce même droit pour
 * construire `VehiculeResume`, aucun droit `vehicules.lire` distinct n'est requis nulle part
 * ailleurs dans ce module pour la même lecture).
 *
 * L'entité `financement` embarquée dans chaque ligne est un domaine DISTINCT, gatée séparément par
 * `ventes.financement.lire` (FAILLE CORRIGÉE, audit sécurité — voir l'en-tête de
 * `suivi-mappers.ts::versLigneSuiviVente` et de `service-suivi-vente.ts` pour la garde transitive
 * sur le tri/curseur) : `ventes.dossier.lire` seul ne suffit plus à la voir. Le détail monétaire du
 * financement (`dureeMois`/`echeanceLe`), lui, reste gated par `roleVoitLesMontants` (RF-116),
 * à l'intérieur de l'entité déjà visible — indépendamment de ce droit d'accès à la ressource et du
 * droit `ventes.financement.lire` ci-dessus.
 */
@ApiTags('Suivi ventes')
@ApiCookieAuth()
@ExigerModule('ventes')
@Controller({ path: 'ventes/suivi', version: '1' })
@UseGuards(GardeDroit)
export class SuiviVenteController {
  constructor(
    private readonly service: ServiceSuiviVente,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @Get()
  @ExigerDroit('ventes.dossier.lire')
  @ApiOperation({
    summary:
      'Liste paginée des dossiers de vente avec financement (crédit/leasing) et/ou garantie à suivre.',
    description:
      "Un dossier n'apparaît ici que s'il porte un financement credit/leasing (quel que soit son état) " +
      'ou un véhicule associé dont `garantieDebut` est renseigné (RM-33). Triée par défaut sur ' +
      "l'échéance la plus proche (les dossiers en retard remontent en premier). Filtrable par " +
      '`dansJours` (échéance dans les N prochains jours, bornes incluses) et par `siteId`.',
  })
  @ApiOkResponse({ type: PageSuiviVenteDto })
  @ApiReponseProbleme(400, 'Filtres, tri ou curseur invalides.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'Droit insuffisant.')
  async lister(
    @Query(new PipeZod(schemaFiltresSuiviVente)) filtres: FiltresSuiviVente,
  ): Promise<PageSuiviVenteDto> {
    const ctx = this.contexte.contexteTenant();
    const { role } = this.contexte.exigerPrincipal();
    return this.service.lister(ctx, role, filtres);
  }
}
