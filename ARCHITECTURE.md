# dmsforall (DFA) — Architecture (v0.2)

> DMS pour garages et concessions suisses.
> 100% navigateur, multi-tenant, API-first, connecteurs par marque.
> Document de travail — chaque section est à valider ensemble avant le code.

---

## 1. Vision et positionnement

- **Marché initial : Suisse.** TVA suisse, QR-facture, CHF, multilingue FR/DE/IT dès la conception.
- **Cibles : les deux dès le départ.** Le modèle de données est pensé "concession" (multi-sites, multi-marques, VN/VO, primes constructeur) ; un garage indépendant en utilise un sous-ensemble.
- **Différenciateurs :**
  1. 100% navigateur — zéro installation, zéro serveur chez le client.
  2. Hébergement en Suisse (nLPD).
  3. API ouverte — tout ce que fait l'UI est faisable par l'API.
  4. Facturation QR-facture native + export fiduciaire (Bexio, WinBIZ, Abacus, Banana).

## 2. Principes d'architecture

1. **API-first.** La web UI est un client de l'API publique, sans accès privilégié. Chaque fonctionnalité existe d'abord comme endpoint documenté (OpenAPI), puis comme écran.
2. **Multi-tenant, une seule instance.** Un tenant = un groupe/garage. PostgreSQL unique avec `tenant_id` sur chaque table + Row-Level Security (RLS) en garde-fou : même un bug applicatif ne peut pas faire fuiter les données d'un autre tenant.
3. **Couche connecteurs standardisée.** Le cœur ne connaît aucune marque. Des interfaces stables (`PartsCatalogProvider`, `VehicleReferenceProvider`, `OrderProvider`, `ListingPublisher`, `AccountingExporter`) sont implémentées par des adaptateurs. Ajouter une marque ou un fournisseur = un adaptateur, zéro changement au cœur.
4. **i18n dès le jour 1.** Aucune chaîne en dur ; FR d'abord, DE/IT ensuite. Les documents clients (factures, devis, OR) sont générés dans la langue du client final.
5. **Piste d'audit.** Toute modification sur les entités sensibles (documents de vente, OR, mouvements de stock) est journalisée (qui, quoi, quand, avant/après). Nécessaire pour la confiance et les litiges.

## 3. Stack (validée le 27.07.2026)

| Couche                    | Choix                                        | Pourquoi                                                                                                                            |
| ------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Backend                   | **TypeScript + NestJS**                      | Un seul langage sur toute la stack, structure modulaire imposée (bien pour un gros produit métier), OpenAPI généré automatiquement. |
| Base de données           | **PostgreSQL** + Drizzle ORM                 | RLS pour le multi-tenant, JSONB pour les attributs spécifiques marque, solide pour le reporting.                                    |
| Front                     | **React + Vite** (SPA) + shadcn/ui           | UI moderne et rapide ; SPA suffit (app métier derrière login, pas de besoin SEO).                                                   |
| Jobs/asynchrone           | BullMQ (Redis)                               | Imports catalogues, génération PDF, envois d'e-mails, synchros connecteurs.                                                         |
| PDF (factures, OR, devis) | Génération serveur (Typst ou Playwright)     | QR-facture = exigences de mise en page précises.                                                                                    |
| Auth                      | Sessions + rôles par tenant ; TOTP en option | Rôles : direction, vendeur, **réceptionnaire**, chef d'atelier, technicien, magasinier, comptable, admin.                           |
| Hébergement               | **Infomaniak ou Exoscale** (Suisse)          | nLPD + argument de vente. Docker Compose au début, on complexifie seulement si nécessaire.                                          |
| Monitoring                | Sentry + logs structurés                     | Toi seul au support au début : il faut voir les erreurs avant les clients.                                                          |

Alternatives considérées : Go (backend plus performant mais deux langages à maintenir), .NET (très bon mais écosystème front séparé), Next.js full-stack (couplage UI/API contraire au principe API-first). Le choix TypeScript/NestJS optimise pour **un développeur solo productif sur toute la stack**.

## 4. Modèle de données — entités principales

### Socle

- **Tenant** — groupe/entreprise cliente. Paramètres : n° TVA, IBAN/QR-IBAN, langues, logo.
- **Site** — point de vente/atelier d'un tenant (une concession peut en avoir plusieurs). Chaque donnée opérationnelle est rattachée à un site.
- **Utilisateur** — appartient à un tenant, rôles par site.
- **Marque** — référentiel global (pas par tenant) ; un tenant active les marques qu'il représente ou répare.

### Clients & véhicules

- **Client** — particulier ou entreprise ; coordonnées, langue, consentements marketing, conditions (rabais, délai de paiement).
- **Véhicule** — VIN, plaque, marque/modèle/version, motorisation, dates (1re mise en circulation, expertise), kilométrage historisé. Lié à un **propriétaire** (client) avec historique de détention — critique pour l'atelier ("le véhicule revient, le propriétaire a changé").
- **VéhiculeStock** — un véhicule _en stock du garage_ (VN/VO/démo/reprise) : prix d'achat, frais, prix affiché, statut (commandé → en transport → en stock → réservé → vendu → livré), photos/360°, publication d'annonces.

### Atelier

- **Rendez-vous** — planning par site, lié à client + véhicule, motif, durée estimée, ressources (pont, technicien).
- **Ordre de réparation (OR)** — le document central de l'atelier : lignes de travaux (forfaits ou temps barémés), lignes de pièces (réservation sur stock), affectation techniciens, statuts (ouvert → en cours → attente pièces → terminé → facturé). Signature client à la réception (navigateur/tablette).
- **Pointage** — temps réel par technicien et par OR ; base du calcul de productivité atelier.

### Pièces

- **Article** — référence, désignations multilingues, marque, prix d'achat/vente, TVA, emplacement, équivalences (référence remplacée par).
- **Stock** — quantité par site, seuil d'alerte, réservations (par OR), mouvements journalisés.
- **Fournisseur / Commande fournisseur** — réappro manuel d'abord, automatisable ensuite (suggestion sous seuil).

### Ventes & facturation

- **Devis / Bon de commande / Facture / Avoir** — chaîne documentaire avec numérotation continue par type et par année, verrouillage à l'émission (une facture émise ne se modifie plus, elle s'annule par avoir).
- **Facture** — QR-facture suisse native ; paiements (espèces, carte, virement) ; rapprochement camt.054 (phase 2).
- **VenteVéhicule** — dossier de vente : véhicule, reprise éventuelle, financement, primes constructeur, marge calculée.
- **ExportComptable** — écritures agrégées exportables vers Bexio/WinBIZ/Abacus/Banana (interface `AccountingExporter`, un adaptateur par cible).

## 5. Couche connecteurs

```
        ┌─────────────────────────────┐
        │        Cœur GarageOS        │   ne connaît AUCUNE marque
        └──────────────┬──────────────┘
                       │  interfaces stables
   ┌───────────┬───────┴───────┬───────────────┐
   │ PartsCatalog  VehicleRef   ListingPublisher  AccountingExporter
   │ Provider      Provider     │                 │
   ▼               ▼            ▼                 ▼
 TecDoc        Eurotax/       AutoScout24,     Bexio, WinBIZ,
 (générique)   auto-i-dat     tutti, Facebook  Abacus, Banana
 puis OEM      (cotes VO)     Marketplace
 marque par
 marque
```

- **Phase 1 (indépendants)** : catalogue générique (TecDoc — licence à négocier), saisie/import manuel, export comptable.
- **Phase 2 (Suisse VO)** : Eurotax/auto-i-dat pour les cotes et données véhicules, AutoScout24 pour la publication d'annonces (acteur dominant en Suisse).
- **Phase 3 (OEM)** : adaptateurs constructeur, marque par marque, au rythme des agréments obtenus. L'architecture est prête dès la phase 1 ; seul le calendrier commercial décide.

## 6. État actuel et feuille de route

| Étape                    | Contenu                                                                          | État                                                                              |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **0. Socle**             | Auth, tenants, sites, rôles, i18n, API OpenAPI, squelette UI, CI/CD, hébergement | ✅ Livré, vérifié                                                                 |
| **1. Atelier + Clients** | Clients, véhicules, RDV, OR, planning, pointage sur OR                           | ✅ Livré (API + écrans)                                                           |
| **2. Facturation**       | Devis/facture/avoir, QR-facture, export fiduciaire WinBIZ, encaissement          | ✅ Livré (API + écrans + jeu démo)                                                |
| **Lot 2. Pointage**      | Pointage par technicien/OR (temps réel, tracé historisé, statut OR=en_cours)     | 🟨 API livrée, écrans en cours                                                    |
| **3. Pièces**            | Articles, stock par site, mouvements (casse/transfert/retour), réservations      | 🟨 API + écrans livrés, commandes fournisseur EN COURS                            |
| **4. Ventes VN/VO**      | Stock garage, dossiers de vente, reprises, financement                           | 🟨 Schéma + contrats livrés (migrations 0031-0032), API EN COURS, écrans EN COURS |
| **5. Connecteurs**       | Interfaces pour TecDoc, AutoScout24, exports comptables, OEM                     | 🟨 Contrats définis, implémentation EN COURS                                      |

Jalon clé : **fin d'étape 2 (31.07.2026) = premier garage prêt pour une utilisation réelle.** Étapes 3-5 élargissent le périmètre ; aucune n'est bloquante pour le pilote.

## 7. Décisions et questions ouvertes

Décidé (27.07.2026 et confirmé 31.07.2026) :

- [x] **Nom : dmsforall (DFA).**
- [x] **Stack validée** (§3) : TypeScript + NestJS + PostgreSQL/Drizzle + React/Vite.

- [x] **Dev hybride** : Postgres + Redis dans Docker (installé), backend/front en Node local en dev, tout conteneurisé en prod.
- [x] **Étapes 1-2 livrées** : atelier (OR, planning, pointage), clients, véhicules, facturation (QR-facture, export WinBIZ, encaissement).
- [x] **Décision ventes VN/VO** (§4) : un véhicule en stock n'est pas un second objet ; c'est le même enregistrement `vehicule` étendu (colonnes `prix_*`, `statut_stock`, photos, etc.).

Encore ouvert :

- [ ] Premier garage : à confirmer avant démarrage etape 2 production.
- [ ] Licence TecDoc : coûts à évaluer avant étape 3 (pièces).
- [ ] Migration données Auto-i/Nextlane : modalités par premier garage — voir `docs/specification-reprise-donnees.md`.
- [ ] Étape 3 : commandes fournisseur et consignes pièces (socle posé, implémentation EN COURS).
- [ ] Étape 4 : endpoints ventes VN/VO (schéma confirmé 31.07, implémentation EN COURS).
- [ ] Étape 5 : adaptateurs connecteurs (TecDoc, AutoScout24 prioritaires ; OEM au rythme agréments commerciaux).
