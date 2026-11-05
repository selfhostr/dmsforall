import i18next from '@/i18n';

/**
 * Traductions FR du namespace `ventes` (clés `ventes:stock.*`) utilisées par les écrans de ce
 * sous-module — le namespace n'est PAS encore enregistré dans `apps/web/src/i18n/index.ts` (hors
 * périmètre de ce lot, un lot i18n distinct le fait EN PARALLÈLE, voir le rapport de
 * livraison pour la liste complète attendue côté production). Enregistrée ICI, dans un fichier de
 * test, via `i18next.addResourceBundle` — ça n'édite AUCUN fichier sous `i18n/**`, ça ajoute une
 * ressource en mémoire pour la durée du test, seul moyen de vérifier le texte RÉELLEMENT rendu
 * (`screen.getByText(...)`) plutôt que la clé brute que i18next retournerait sinon (namespace
 * absent de `ns`/`resources`).
 */
export function enregistrerTraductionsTestVentes(): void {
  i18next.addResourceBundle(
    'fr',
    'ventes',
    {
      stock: {
        liste: {
          titre: 'Véhicules en stock',
          vide: {
            recherche: {
              titre: 'Aucun véhicule trouvé',
              description: 'Aucun véhicule du parc ne correspond à cette recherche.',
            },
            filtre: {
              titre: 'Aucun véhicule avec ces filtres',
              description: 'Aucun véhicule du parc ne correspond aux filtres choisis.',
            },
            premierUsage: {
              titre: 'Aucun véhicule en stock',
              description: 'Mettez votre premier véhicule en stock.',
            },
          },
          rechercherPlaceholder: 'Plaque, VIN, désignation…',
          erreur: { titre: "Impossible d'afficher les véhicules en stock" },
          actions: {
            mettreEnStock: 'Mettre un véhicule en stock',
            ficheCommerciale: 'Fiche commerciale',
          },
          colonnes: {
            vehicule: 'Véhicule',
            type: 'Type',
            provenance: 'Provenance',
            statut: 'Statut',
            joursStock: 'Jours de stock',
            prixVente: 'Prix de vente',
          },
          tri: {
            label: 'Trier par',
            dateEntreeStockDesc: 'Entrée en stock (récent d’abord)',
            dateEntreeStockAsc: 'Entrée en stock (ancien d’abord)',
            joursStockDesc: 'Jours de stock (décroissant)',
            prixVenteAsc: 'Prix de vente (croissant)',
            prixVenteDesc: 'Prix de vente (décroissant)',
          },
        },
        champs: {
          typeVehicule: 'Type de véhicule',
          statutCommercial: 'Statut commercial',
          provenance: 'Provenance',
          site: 'Site',
          dateEntreeStock: "Date d'entrée en stock",
          prixAchat: "Prix d'achat",
          prixVenteAffiche: 'Prix de vente affiché',
          fraisRemiseEtatCumules: 'Frais de remise en état',
          vendeurPrecedentAssujetti: 'Vendeur précédent assujetti TVA',
          joursStock: 'Jours de stock',
          receptionneLe: 'Réceptionné le',
          reserveLe: 'Réservé le',
          venduLe: 'Vendu le',
          livreLe: 'Livré le',
          motif: 'Motif',
        },
        filtres: {
          typeTous: 'Tous les types',
          statutTous: 'Tous les statuts',
          provenanceToutes: 'Toutes les provenances',
        },
        prixNonFixe: 'Non fixé',
        types: { vn: 'VN', vo: 'VO' },
        statuts: {
          en_commande: 'En commande',
          disponible: 'Disponible',
          reserve: 'Réservé',
          vendu: 'Vendu',
          livre: 'Livré',
        },
        provenances: {
          neuf_constructeur: 'Neuf constructeur',
          reprise: 'Reprise',
          achat_particulier: 'Achat particulier',
          achat_professionnel: 'Achat professionnel',
          retour_leasing: 'Retour de leasing',
          demonstrateur: 'Démonstrateur',
        },
        assujetti: { nonRenseigne: 'Non renseigné', oui: 'Oui', non: 'Non' },
        fiche: {
          titre: 'Fiche commerciale du véhicule',
          erreur: { titre: "Impossible d'afficher cette fiche" },
          voirFicheVehicule: 'Voir la fiche véhicule complète',
          donneesCommerciales: 'Données commerciales',
          historique: 'Historique',
          creeLe: 'Créé le',
          modifieLe: 'Modifié le',
          prixAchatVerrouille: "Le prix d'achat est verrouillé après la vente.",
          receptionnerDescription: 'Le véhicule passe du statut « en commande » à « disponible ».',
          remettreDisponibleDescription:
            'Correction exceptionnelle : le véhicule redevient disponible à la vente.',
          marquerVenduDescription: 'Correction exceptionnelle : le véhicule est marqué vendu.',
          actions: {
            mettreAJour: 'Mettre à jour',
            receptionner: 'Réceptionner',
            remettreDisponible: 'Remettre disponible',
            marquerVendu: 'Marquer vendu',
            autresActions: 'Autres actions',
          },
        },
        entree: {
          titre: 'Mettre un véhicule en stock',
          rechercherVehiculePlaceholder: 'Rechercher un véhicule (plaque, VIN, désignation)',
          vehiculeIntrouvable: "Le véhicule n'existe pas encore dans DFA ?",
          creerVehicule: "Créez-le d'abord",
          aucunVehiculeTitre: 'Aucun véhicule trouvé',
          aucunVehiculeDescription: 'Aucun véhicule actif ne correspond à cette recherche.',
          choisirVehicule: 'Choisir',
          changerVehicule: 'Changer de véhicule',
          provenanceAutre: 'Autre (préciser)',
          mettreEnStock: 'Mettre en stock',
        },
      },
    },
    true,
    true,
  );
}
