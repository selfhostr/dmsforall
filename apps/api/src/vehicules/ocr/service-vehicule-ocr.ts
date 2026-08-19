/**
 * Orchestration du scan OCR de permis de circulation. AUCUNE PERSISTANCE DE L'IMAGE : `image`
 * (paramètre de `scanner`) est un `Buffer` en mémoire du bout à bout — reçu par
 * `vehicule-ocr.controller.ts` (multer en mémoire, jamais `diskStorage`), transmis tel quel à
 * `ClientMoteurOcr.scanner` (`fetch`, aucune écriture disque côté client HTTP), jamais copié dans
 * un fichier temporaire ni en base. Le journal d'audit posé ici (`vehicule_ocr_scan_journal`,
 * migration 0058) ne porte JAMAIS le texte lu — seulement des booléens de confirmation et des
 * identifiants de fiches déjà existantes (voir l'en-tête de cette migration).
 *
 * Décision @laupernoe : cet endpoint NE CRÉE RIEN. Toute correspondance rendue ici pointe vers une fiche
 * DÉJÀ EXISTANTE du tenant ; rien n'est jamais inséré dans `vehicule`/`client` depuis ce service.
 *
 * Contrat convergé avec l'écran de scan (`@dfa/shared`, `scan-permis-circulation.ts`) : trois
 * niveaux de confiance (`sure`/`douteuse`/`absente`), correspondances EXACTES uniquement.
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ChampScanne,
  CorrespondancesScan,
  DetenteurScanne,
  NiveauConfianceOcr,
  ReponseScanPermisCirculation,
  RoleUtilisateur,
  VehiculeScanne,
} from '@dfa/shared';
import { sql } from 'drizzle-orm';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
import { JETON_CONFIG } from '../../config/config.jetons';
import { ErreurMetier } from '../../common/erreurs';
import {
  JETON_SERVICE_LIMITATION_DEBIT,
  type ServiceLimitationDebit,
} from '../../common/limitation';
import { ServiceEvenementsTempsReel } from '../../temps-reel';
import {
  rechercherCorrespondanceClient,
  rechercherCorrespondanceTypeApprobationComplete,
  rechercherCorrespondanceVehicule,
} from './correspondance-permis';
import {
  candidatsCodeType,
  detecterRaisonSociale,
  extraireAdresse,
  extraireDate,
  extraireNomEtPrenom,
  extrairePlaque,
  nettoyerTexteLibre,
  rechercherVin,
} from './extraction-permis';
import {
  ErreurMoteurOcr,
  JETON_CLIENT_MOTEUR_OCR,
  type ClientMoteurOcr,
  type ReponseBruteMoteurOcr,
} from './client-moteur-ocr';
import type { ConfigOcrPermis } from './config-ocr';

/**
 * Rôles autorisés à recevoir l'événement temps réel « client déjà identifié » quand un scan
 * retrouve un client existant — arbitrage : les rôles qui tiennent un comptoir/accueillent le
 * client (`receptionnaire`, `vendeur`) plus `direction` (visibilité transverse déjà accordée
 * ailleurs sur les mêmes données). Défini ICI, pas dans `auth/matrice-droits.ts` (hors périmètre) —
 * point à confirmer par @laupernoe si ce choix ne convient pas (signalé dans le rapport de livraison).
 */
const ROLES_NOTIFIES_CORRESPONDANCE_CLIENT: readonly RoleUtilisateur[] = [
  'receptionnaire',
  'vendeur',
  'direction',
];

function champAbsent<T>(): ChampScanne<T> {
  return { valeur: null, confiance: 'absente' };
}

function champ<T>(
  valeur: T | null | undefined,
  confianceSiPresent: NiveauConfianceOcr,
): ChampScanne<T> {
  return valeur === null || valeur === undefined
    ? champAbsent<T>()
    : { valeur, confiance: confianceSiPresent };
}

@Injectable()
export class ServiceVehiculeOcr {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_CLIENT_MOTEUR_OCR) private readonly moteur: ClientMoteurOcr,
    @Inject(JETON_SERVICE_LIMITATION_DEBIT) private readonly limiteur: ServiceLimitationDebit,
    @Inject(JETON_CONFIG) private readonly config: ConfigOcrPermis,
    private readonly evenementsTempsReel: ServiceEvenementsTempsReel,
  ) {}

  async scanner(ctx: ContexteTenant, photo: Buffer): Promise<ReponseScanPermisCirculation> {
    await this.appliquerLimiteDebit(ctx);

    let brut: ReponseBruteMoteurOcr;
    try {
      brut = await this.moteur.scanner(photo);
    } catch (cause) {
      const echec = cause instanceof ErreurMoteurOcr ? cause : null;
      await this.journaliser(
        ctx,
        echec?.code === 'FORMAT_NON_SUPPORTE' ? 'format_non_supporte' : 'moteur_indisponible',
      );
      if (echec?.code === 'FORMAT_NON_SUPPORTE') {
        throw new ErreurMetier('VALIDATION_ECHOUEE', echec.message);
      }
      throw new ErreurMetier('ERREUR_INTERNE', 'Service OCR indisponible, réessayez.', {
        status: 503,
      });
    }

    return this.acces.enTenant(ctx, async (tx) => {
      const candidatsType = brut.champs.codeTypeCh
        ? candidatsCodeType(brut.champs.codeTypeCh.texte)
        : [];
      // Le code type est cherché AVANT le VIN : une fois trouvé, sa marque sert de croisement WMI
      // pour départager d'éventuels candidats VIN concurrents (`rechercherVin`, ci-dessous).
      const correspondanceType = await rechercherCorrespondanceTypeApprobationComplete(
        tx,
        candidatsType,
      );

      const vinExtrait = brut.champs.vin
        ? rechercherVin(
            brut.champs.vin.texte,
            correspondanceType.trouve ? correspondanceType.marque : null,
          )
        : null;
      const plaqueExtraite = brut.champs.plaque ? extrairePlaque(brut.champs.plaque.texte) : null;
      const dateExtraite = brut.champs.premiereMiseEnCirculationLe
        ? extraireDate(brut.champs.premiereMiseEnCirculationLe.texte)
        : null;
      const nomTexteBrut = brut.champs.detenteurNom
        ? nettoyerTexteLibre(brut.champs.detenteurNom.texte)
        : null;
      const nomPrenom = extraireNomEtPrenom(nomTexteBrut);
      const estEntreprise = detecterRaisonSociale(nomTexteBrut);
      const adresseExtraite = brut.champs.detenteurAdresse
        ? extraireAdresse(brut.champs.detenteurAdresse.texte)
        : null;

      const correspondanceVehicule = await rechercherCorrespondanceVehicule(tx, ctx, {
        vin: vinExtrait?.valeur ?? null,
        plaque: plaqueExtraite,
      });
      const correspondanceClient = await rechercherCorrespondanceClient(tx, ctx, {
        nomComplet: nomTexteBrut,
        npa: adresseExtraite?.npa ?? null,
      });

      const vehicule: VehiculeScanne = {
        marque: champ(correspondanceType.trouve ? correspondanceType.marque : null, 'sure'),
        modele: champ(correspondanceType.trouve ? correspondanceType.modele : null, 'sure'),
        vin: champ(vinExtrait?.valeur ?? null, vinExtrait?.checksumValide ? 'sure' : 'douteuse'),
        plaque: champ(plaqueExtraite?.numero ?? null, 'sure'),
        canton: champ(plaqueExtraite?.canton ?? null, 'sure'),
        premiereMiseEnCirculationLe: champ(dateExtraite, 'sure'),
      };

      const detenteur: DetenteurScanne = {
        estEntreprise: champ(estEntreprise, 'douteuse'),
        nom: champ(estEntreprise === true ? null : (nomPrenom?.nom ?? null), 'douteuse'),
        prenom: champ(estEntreprise === true ? null : (nomPrenom?.prenom ?? null), 'douteuse'),
        raisonSociale: champ(estEntreprise === true ? nomTexteBrut : null, 'douteuse'),
        rue: champ(adresseExtraite?.rue ?? null, 'douteuse'),
        npa: champ(adresseExtraite?.npa ?? null, 'douteuse'),
        localite: champ(adresseExtraite?.localite ?? null, 'douteuse'),
      };

      if (tousLesChampsAbsents(vehicule, detenteur)) {
        await this.journaliser(ctx, 'rien_exploitable');
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          'Aucun champ exploitable extrait de la photo (document absent du cadre, flou, ou trop sombre).',
          { status: 422 },
        );
      }

      const correspondances: CorrespondancesScan = {
        ...(correspondanceClient ? { client: correspondanceClient } : {}),
        ...(correspondanceVehicule ? { vehicule: correspondanceVehicule } : {}),
      };

      await tx.execute(sql`
        insert into public.vehicule_ocr_scan_journal
          (tenant_id, utilisateur_id, resultat, duree_traitement_ms, code_type_lu_valide,
           vin_checksum_valide, vehicule_correspondance_id, client_correspondance_id)
        values (
          ${ctx.tenantId}, ${ctx.utilisateurId}, 'succes', ${brut.dureeMs},
          ${correspondanceType.trouve}, ${vinExtrait?.checksumValide ?? false},
          ${correspondanceVehicule?.id ?? null}, ${correspondanceClient?.id ?? null}
        )
      `);

      if (correspondanceClient) {
        await this.evenementsTempsReel.publier(
          ctx.tenantId,
          'vehicule.correspondance_scan_permis',
          { clientId: correspondanceClient.id },
          ROLES_NOTIFIES_CORRESPONDANCE_CLIENT,
        );
      }

      return { donnees: { vehicule, detenteur }, correspondances };
    });
  }

  private async appliquerLimiteDebit(ctx: ContexteTenant): Promise<void> {
    const resultat = await this.limiteur.consommer(
      `ocr-permis:utilisateur:${ctx.utilisateurId}`,
      this.config.LIMITE_OCR_PERMIS_UTILISATEUR,
      this.config.LIMITE_OCR_PERMIS_FENETRE_SECONDES,
    );
    if (!resultat.autorise) {
      throw new ErreurMetier(
        'AUTH_TROP_DE_TENTATIVES',
        'Trop de scans de permis pour cet utilisateur, réessayez plus tard.',
        { enTetes: { 'Retry-After': String(resultat.resteSecondes) } },
      );
    }
  }

  private async journaliser(
    ctx: ContexteTenant,
    resultat:
      | 'image_invalide'
      | 'format_non_supporte'
      | 'moteur_indisponible'
      | 'rien_exploitable'
      | 'erreur_interne',
  ): Promise<void> {
    await this.acces.enTenant(ctx, async (tx) => {
      await tx.execute(sql`
        insert into public.vehicule_ocr_scan_journal
          (tenant_id, utilisateur_id, resultat, duree_traitement_ms)
        values (${ctx.tenantId}, ${ctx.utilisateurId}, ${resultat}, 0)
      `);
    });
  }
}

/** `SCAN_PHOTO_ILLISIBLE` : aucun champ, même douteux, n'a pu être extrait — voir contrat. */
function tousLesChampsAbsents(vehicule: VehiculeScanne, detenteur: DetenteurScanne): boolean {
  const champs: readonly ChampScanne<unknown>[] = [
    vehicule.marque,
    vehicule.modele,
    vehicule.vin,
    vehicule.plaque,
    vehicule.canton,
    vehicule.premiereMiseEnCirculationLe,
    detenteur.estEntreprise,
    detenteur.nom,
    detenteur.prenom,
    detenteur.raisonSociale,
    detenteur.rue,
    detenteur.npa,
    detenteur.localite,
  ];
  return champs.every((c) => c.confiance === 'absente');
}
