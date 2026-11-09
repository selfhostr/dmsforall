---
title: Questions fréquentes
description: Réponses aux questions les plus courantes sur dmsforall, sa licence, ses fonctions et ses limites.
---

## Existe-t-il une version hébergée ?

Non. dmsforall est un logiciel que vous faites fonctionner sur votre propre serveur. Le projet n'offre ni service hébergé ni édition payante. La licence est MIT.

## Combien cela coûte-t-il ?

Le logiciel est gratuit sous licence MIT. Vos coûts sont le serveur, le nom de domaine, le certificat TLS, les sauvegardes et votre temps.

## Quelles langues l'interface utilise-t-elle ?

Le français, l'allemand et l'italien. La documentation est en français.

## Plusieurs garages peuvent-ils utiliser une seule installation ?

Oui. Chaque garage est un locataire, avec ses propres données, séparées par la sécurité au niveau des lignes (row-level security). Chaque garage a ses propres utilisateurs et ses propres sites.

## Prend-il en charge mon logiciel de comptabilité ?

L'export comptable n'est disponible que pour WinBIZ. Les autres formats, comme Bexio, Abacus, Banana et le CSV générique, ne sont pas disponibles dans cette version.

## Envoie-t-il des SMS ?

Non. Les SMS sont prévus dans le modèle de données, mais aucun fournisseur de SMS n'est connecté dans cette version. Les rappels sont envoyés par e-mail.

## Lit-il les relevés bancaires ?

Non. La réconciliation des relevés bancaires (camt.054) n'est pas disponible dans cette version.

## Puis-je voir la marge sur chaque pièce ?

Pas de façon fiable. La valorisation du stock selon la méthode FIFO est décidée, mais pas encore implémentée.

## Puis-je importer les données de mon logiciel actuel ?

Oui, à partir d'archives Microsoft Access et dBase/FoxPro. L'import a été testé avec des archives exportées depuis Auto-i. Projet non affilié à Auto-i. Voir [Importer des données](../using/data-import.fr.md).

## Est-il conforme au droit suisse ?

dmsforall est conçu pour le droit et la TVA suisses, avec des factures à QR-facture et des montants en centimes. Le projet ne donne aucune garantie juridique ni fiscale. Faites vérifier vos factures, votre TVA et vos exports par une fiduciaire avant de vous y fier.

## Où mes données sont-elles stockées ?

Sur le serveur que vous exploitez. dmsforall n'envoie aucune donnée au projet ni à un tiers. Le lieu d'hébergement de ce serveur est votre choix.

## Existe-t-il une démo ?

Pour un développeur, `pnpm db:seed` charge un garage de démonstration sur une base de développement. Voir [Contribuer](../development/contributing.fr.md). Les comptes de démonstration ne sont pas créés en production.

## Cela fonctionne-t-il sur une tablette ou un téléphone ?

L'interface fonctionne dans un navigateur. Elle propose des réglages de densité pour les écrans de bureau, les tablettes, ainsi que pour les écrans de rendez-vous et de pointage.

## Puis-je changer le thème ?

Oui. Les thèmes clair et sombre sont disponibles dans l'interface. Le choix est mémorisé dans le navigateur de chaque appareil.

## Comment passer à une nouvelle version ?

Suivez [Mettre à jour dmsforall](upgrading.md).
