import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import {
  LIMITE_TAILLE_PHOTO_LIGNE_OCTETS,
  LIMITE_TAILLE_VIGNETTE_PHOTO_OCTETS,
  NOMBRE_MAX_PHOTOS_PAR_LIGNE,
  type ReponseListePhotosLigne,
  type ReponsePhotoLigne,
  type TypeMimePhotoLigne,
} from '@dfa/shared';

import { droitsDuPrincipal } from '../../auth/droits-personne';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
import { auditAtelier, ligneOrPhoto, type LigneLigneOrPhoto } from '../../db/schema';
import { chargerLigneOrPourEcriture, chargerOr, chargerOrOuNull } from '../or-requetes';
import { estOrVerrouille } from '../service-or';

import { detecterTypeImage } from './detection-image';
import { JETON_STOCKAGE_PHOTOS } from './photos.jetons';
import { clePhoto, cleVignettePhoto, type PortStockagePhotos } from './stockage-photos';

/** Encadrement : peut supprimer la photo de n'importe qui (les autres, seulement les leurs).
 *  Accordé par « Encadrer » ou « Accueil : Faire » (réceptionnaire) — plus par une liste de rôles. */
function peutSupprimerLesPhotosDesAutres(principal: PrincipalAuthentifie): boolean {
  const capacites = droitsDuPrincipal(principal).capacites;
  return capacites.has('encadrer') || capacites.has('accueil.faire');
}

export interface FichierRecu {
  readonly buffer: Buffer;
}

export interface EntreeAjoutPhoto {
  readonly photo: FichierRecu;
  readonly vignette?: FichierRecu | undefined;
  readonly legende?: string | undefined;
}

export interface PhotoServie {
  readonly buffer: Buffer;
  readonly typeMime: string;
  readonly nomFichier: string;
}

@Injectable()
export class ServicePhotosLigne {
  private readonly journal = new Logger(ServicePhotosLigne.name);

  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_STOCKAGE_PHOTOS) private readonly stockage: PortStockagePhotos,
  ) {}

  async ajouter(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    ligneId: string,
    entree: EntreeAjoutPhoto,
  ): Promise<ReponsePhotoLigne> {
    // Validation des OCTETS avant tout accès base ou disque : rien n'est écrit pour un fichier refusé.
    const typeMime = this.exigerImageAcceptee(entree.photo.buffer);
    if (entree.vignette) {
      if (entree.vignette.buffer.length > LIMITE_TAILLE_VIGNETTE_PHOTO_OCTETS) {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'La vignette est trop volumineuse.');
      }
      if (detecterTypeImage(entree.vignette.buffer) !== 'image/jpeg') {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'La vignette doit être une image JPEG.');
      }
    }

    const photoId = randomUUID();
    const cleFichier = clePhoto(ctx.tenantId, orId, photoId, typeMime);
    const cleVignette = entree.vignette ? cleVignettePhoto(ctx.tenantId, orId, photoId) : null;

    const ecrits: string[] = [];
    try {
      return await this.acces.enTenant(ctx, async (tx) => {
        const or = await chargerOr(tx, ctx, orId);
        this.garantirOrModifiable(or.statut, orId);
        // Verrou de la ligne : deux envois simultanés ne dépassent pas le plafond de 20.
        const ligne = await chargerLigneOrPourEcriture(tx, ctx, orId, ligneId);
        if (ligne.statut === 'facturee') {
          throw new ErreurMetier(
            'OR_LIGNE_VERROUILLEE',
            'Cette ligne est facturée : on ne peut plus y joindre de photo.',
          );
        }
        const [decompte] = await tx
          .select({ n: count() })
          .from(ligneOrPhoto)
          .where(and(eq(ligneOrPhoto.tenantId, ctx.tenantId), eq(ligneOrPhoto.ligneOrId, ligneId)));
        if ((decompte?.n ?? 0) >= NOMBRE_MAX_PHOTOS_PAR_LIGNE) {
          throw new ErreurMetier(
            'CONFLIT',
            `Cette ligne a déjà ${NOMBRE_MAX_PHOTOS_PAR_LIGNE} photos, le maximum.`,
          );
        }

        await this.stockage.ecrire(cleFichier, entree.photo.buffer);
        ecrits.push(cleFichier);
        if (cleVignette && entree.vignette) {
          await this.stockage.ecrire(cleVignette, entree.vignette.buffer);
          ecrits.push(cleVignette);
        }

        const [ligneCreee] = await tx
          .insert(ligneOrPhoto)
          .values({
            id: photoId,
            tenantId: ctx.tenantId,
            ordreReparationId: orId,
            ligneOrId: ligneId,
            legende: entree.legende ?? null,
            cleFichier,
            cleVignette,
            typeMime,
            tailleOctets: entree.photo.buffer.length,
            creeParId: principal.utilisateurId,
          })
          .returning();
        await tx.insert(auditAtelier).values({
          tenantId: ctx.tenantId,
          entite: 'ligne_or',
          entiteId: ligneId,
          action: 'modification',
          champ: 'photo',
          valeurApres: {
            photoId,
            legende: entree.legende ?? null,
            tailleOctets: entree.photo.buffer.length,
          },
          utilisateurId: principal.utilisateurId,
          requeteId: ctx.requeteId,
        });
        return this.mapper(ligneCreee!, principal, or.statut);
      });
    } catch (erreur) {
      // La transaction a échoué (ou rollback) : ne laisser aucun fichier sans ligne.
      await Promise.all(ecrits.map((cle) => this.supprimerFichierSansBruit(cle)));
      throw erreur;
    }
  }

  async listerParLigne(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    ligneId: string,
  ): Promise<ReponseListePhotosLigne> {
    return this.acces.enTenant(ctx, async (tx) => {
      const or = await chargerOr(tx, ctx, orId);
      const lignes = await tx
        .select()
        .from(ligneOrPhoto)
        .where(
          and(
            eq(ligneOrPhoto.tenantId, ctx.tenantId),
            eq(ligneOrPhoto.ordreReparationId, orId),
            eq(ligneOrPhoto.ligneOrId, ligneId),
          ),
        )
        .orderBy(asc(ligneOrPhoto.creeLe), asc(ligneOrPhoto.id));
      return { donnees: lignes.map((l) => this.mapper(l, principal, or.statut)) };
    });
  }

  async listerParOr(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
  ): Promise<ReponseListePhotosLigne> {
    return this.acces.enTenant(ctx, async (tx) => {
      const or = await chargerOr(tx, ctx, orId);
      const lignes = await tx
        .select()
        .from(ligneOrPhoto)
        .where(
          and(eq(ligneOrPhoto.tenantId, ctx.tenantId), eq(ligneOrPhoto.ordreReparationId, orId)),
        )
        .orderBy(asc(ligneOrPhoto.creeLe), asc(ligneOrPhoto.id));
      return { donnees: lignes.map((l) => this.mapper(l, principal, or.statut)) };
    });
  }

  async lireFichier(ctx: ContexteTenant, photoId: string, vignette: boolean): Promise<PhotoServie> {
    const ligne = await this.acces.enTenant(ctx, async (tx) => {
      const [l] = await tx
        .select()
        .from(ligneOrPhoto)
        .where(and(eq(ligneOrPhoto.tenantId, ctx.tenantId), eq(ligneOrPhoto.id, photoId)))
        .limit(1);
      return l;
    });
    if (!ligne) {
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Photo ${photoId} introuvable.`);
    }
    const cle = vignette && ligne.cleVignette ? ligne.cleVignette : ligne.cleFichier;
    const typeMime = vignette && ligne.cleVignette ? 'image/jpeg' : ligne.typeMime;
    let buffer: Buffer;
    try {
      buffer = await this.stockage.lire(cle);
    } catch {
      // Ligne en base mais fichier absent : jamais un 500 muet, jamais une image vide.
      throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Le fichier de la photo ${photoId} manque.`);
    }
    return {
      buffer,
      typeMime,
      nomFichier: `photo-${photoId}.${typeMime === 'image/png' ? 'png' : 'jpg'}`,
    };
  }

  async supprimer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    photoId: string,
  ): Promise<void> {
    const aEffacer = await this.acces.enTenant(ctx, async (tx) => {
      const [photo] = await tx
        .select()
        .from(ligneOrPhoto)
        .where(and(eq(ligneOrPhoto.tenantId, ctx.tenantId), eq(ligneOrPhoto.id, photoId)))
        .limit(1);
      if (!photo) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Photo ${photoId} introuvable.`);
      }
      const or = await chargerOrOuNull(tx, ctx, photo.ordreReparationId);
      this.garantirOrModifiable(or?.statut ?? 'cloture', photo.ordreReparationId);
      if (!this.peutSupprimer(photo, principal)) {
        throw new ErreurMetier(
          'DROIT_INSUFFISANT',
          'Seul son auteur ou le responsable peut supprimer cette photo.',
        );
      }
      await tx
        .delete(ligneOrPhoto)
        .where(and(eq(ligneOrPhoto.tenantId, ctx.tenantId), eq(ligneOrPhoto.id, photoId)));
      await tx.insert(auditAtelier).values({
        tenantId: ctx.tenantId,
        entite: 'ligne_or',
        entiteId: photo.ligneOrId,
        action: 'modification',
        champ: 'photo',
        valeurAvant: { photoId, legende: photo.legende, tailleOctets: photo.tailleOctets },
        valeurApres: null,
        utilisateurId: principal.utilisateurId,
        requeteId: ctx.requeteId,
      });
      return [photo.cleFichier, photo.cleVignette];
    });
    // Après commit : un échec disque laisse un fichier orphelin (journalisé), jamais une ligne
    // fantôme dont l'image manque.
    for (const cle of aEffacer) {
      if (cle) await this.supprimerFichierSansBruit(cle);
    }
  }

  private exigerImageAcceptee(octets: Buffer): TypeMimePhotoLigne {
    if (octets.length === 0) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'La photo est vide.');
    }
    if (octets.length > LIMITE_TAILLE_PHOTO_LIGNE_OCTETS) {
      throw new ErreurMetier('VALIDATION_ECHOUEE', 'La photo dépasse 8 Mo.');
    }
    const type = detecterTypeImage(octets);
    if (type === 'heic') {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Format HEIC non pris en charge : réglez l’appareil photo sur « le plus compatible » (JPEG) ou envoyez la photo depuis le navigateur.',
      );
    }
    if (type === 'inconnu') {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Format d’image non reconnu : seules les photos JPEG et PNG sont acceptées.',
      );
    }
    return type;
  }

  private garantirOrModifiable(statut: Parameters<typeof estOrVerrouille>[0], orId: string): void {
    if (estOrVerrouille(statut)) {
      throw new ErreurMetier(
        'OR_LIGNE_VERROUILLEE',
        `L’ordre de réparation ${orId} est facturé ou clos : les photos ne peuvent plus changer.`,
      );
    }
  }

  private peutSupprimer(photo: LigneLigneOrPhoto, principal: PrincipalAuthentifie): boolean {
    return (
      peutSupprimerLesPhotosDesAutres(principal) || photo.creeParId === principal.utilisateurId
    );
  }

  private mapper(
    photo: LigneLigneOrPhoto,
    principal: PrincipalAuthentifie,
    statutOr: Parameters<typeof estOrVerrouille>[0],
  ): ReponsePhotoLigne {
    return {
      id: photo.id,
      ordreReparationId: photo.ordreReparationId,
      ligneId: photo.ligneOrId,
      legende: photo.legende,
      typeMime: photo.typeMime as TypeMimePhotoLigne,
      tailleOctets: photo.tailleOctets,
      vignetteDisponible: photo.cleVignette !== null,
      creeParId: photo.creeParId,
      creeLe: photo.creeLe.toISOString(),
      supprimable: !estOrVerrouille(statutOr) && this.peutSupprimer(photo, principal),
    };
  }

  private async supprimerFichierSansBruit(cle: string): Promise<void> {
    try {
      await this.stockage.supprimer(cle);
    } catch (erreur) {
      this.journal.warn(`Fichier photo non supprimé (${cle}) : ${String(erreur)}`);
    }
  }
}
