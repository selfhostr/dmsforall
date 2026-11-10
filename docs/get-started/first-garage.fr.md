---
title: Configurer votre premier garage
description: Créer le premier compte du garage, puis les sites, les utilisateurs et les réglages de facturation dont un garage a besoin avant sa première facture.
---

À la fin de cette page, le garage dispose de son premier compte, de ses sites, de ses comptes du personnel et des réglages de facturation nécessaires pour émettre une première facture.

## 1. Créer le garage

Une nouvelle installation n'a pas de compte. Au premier démarrage, l'API tire un code d'installation à usage unique et l'affiche dans ses journaux. L'interface web le demande dès son premier écran.

1. Lisez le code d'installation dans les journaux de l'API :

   ```sh
   docker compose logs api
   ```

   Cherchez le bloc qui indique `Code d'installation`, suivi d'un code comme `K7QM-3XRB-9TNA`.

2. Ouvrez `https://<adresse du serveur>:8443` (l'adresse de votre installation, ou `DFA_PUBLIC_URL` derrière un reverse proxy). Sur une nouvelle installation, le navigateur affiche **Créer votre garage** à la place de la page de connexion. Saisissez le nom du garage, votre prénom et votre nom, votre adresse e-mail, un mot de passe saisi deux fois (12 caractères au moins) et le code d'installation.

3. Choisissez **Créer mon garage**. Vous êtes connecté avec le compte `direction`, et l'assistant de mise en route s'ouvre.

Résultat : le garage existe, avec son site (portant le nom du garage), son compte `direction` et une ligne d'audit. Il reçoit aussi ses réglages d'atelier, un taux horaire `ATELIER` (CHF 140.00) et huit motifs de rendez-vous (entretien, pneus, MFK, freins, diagnostic, carrosserie, climatisation, autre), afin de pouvoir prendre des rendez-vous dès le premier jour. Tout peut être modifié dans les réglages. L'assistant de mise en route vous guide dans l'adresse, les coordonnées bancaires, la TVA, le taux horaire et le personnel du garage, avec des valeurs par défaut.

Le code d'installation protège une nouvelle installation joignable depuis internet avant l'arrivée de son propriétaire : seule une personne qui peut lire les journaux du serveur peut créer le premier garage. Le code ne sert qu'une fois. Un nouveau code est tiré à chaque démarrage de l'API tant qu'aucun garage n'existe, et il cesse de fonctionner dès qu'un garage existe. La base n'en garde qu'une empreinte salée. Si vous l'avez perdu, lancez `docker compose restart api` et relisez les journaux. L'écran refuse avec ces codes :

- `INSTALLATION_CODE_INVALIDE` (403) : le code est faux ou périmé ;
- `INSTALLATION_DEJA_FAITE` (409) : un garage existe déjà sur cette installation. Connectez-vous à la place ;
- `AUTH_TROP_DE_TENTATIVES` (429) : trop de tentatives. Patientez, puis réessayez ;
- `MOT_DE_PASSE_FAIBLE` (dans un 400 `VALIDATION_ECHOUEE`) : le mot de passe est trop faible, trop courant, trop prévisible, ou il contient l'adresse e-mail.

### Autre possibilité : la ligne de commande

Pour créer le garage sans le navigateur, lancez une commande. Elle fait exactement la même chose que l'écran (même site, même taux horaire, mêmes motifs de rendez-vous) et n'a pas besoin du code d'installation, car elle s'exécute sur le serveur :

```sh
docker compose exec api node dist/cli/creer-garage.js --garage "Garage Exemple" --email direction@example.ch
```

Facultatif : `--first-name X` et `--last-name Y`. Lancez la commande avec `--help` pour afficher l'aide complète.

En développement, lancez la même commande depuis la racine du dépôt. Elle lit `DATABASE_URL_MIGRATION` dans le `.env` racine, comme l'API :

```sh
pnpm --filter @dfa/api exec tsx src/cli/creer-garage.ts --garage "Garage Exemple" --email direction@example.ch
```

Le mot de passe est lu dans la variable `DFA_PREMIER_MOT_DE_PASSE`. Si elle n'est pas définie, la commande le demande sans l'afficher à l'écran. L'invite interactive n'a pas encore été testée.

La commande se termine avec le statut 1 et l'un de ces codes :

- `MOT_DE_PASSE_FAIBLE` : le mot de passe est trop faible. Le message indique pourquoi : trop courant, trop prévisible, ou il contient l'adresse e-mail ;
- `GARAGE_EXISTANT` : un garage portant ce nom existe déjà ;
- `COURRIEL_EXISTANT` : l'adresse e-mail est déjà utilisée.

Résultat : le compte peut se connecter à l'interface web à l'adresse de votre installation (`https://<adresse du serveur>:8443`, ou `DFA_PUBLIC_URL` derrière un reverse proxy). Une connexion depuis une autre adresse que `DFA_PUBLIC_URL` renvoie `AUTH_ORIGINE_REFUSEE`. Après la première connexion, l'assistant de mise en route vous guide dans l'adresse, les coordonnées bancaires, la TVA, le taux horaire et le personnel du garage, avec des valeurs par défaut.

Le jeu de données de démonstration (`pnpm db:seed`) ne s'exécute pas avec `NODE_ENV=production`. Ne l'utilisez pas sur un serveur qui contient de vraies données.

## 2. Créer les sites

Ouvrez les réglages des sites et créez une entrée par atelier, comptoir ou salle d'exposition. Chaque donnée (clients, véhicules, ordres de réparation, stock) appartient à un seul site.

## 3. Inviter le personnel

Ouvrez les réglages des utilisateurs et créez un compte par personne. Choisissez le rôle qui correspond au travail de la personne. Voir [rôles et droits](../reference/roles-and-rights.md).

Pour un terminal partagé à l'atelier, créez un compte avec le rôle `poste_atelier` et rattachez-le à un seul site.

## 4. Compléter les réglages de facturation

Renseignez la raison sociale et l'adresse de l'entreprise, le numéro et le régime de TVA, les coordonnées bancaires et le bloc créancier. Le bloc créancier est copié sur chaque facture au moment de son émission.

Une facture peut être émise sans bloc créancier complet, par exemple lorsqu'elle est payée en espèces. Elle n'a alors pas de QR-facture, et l'application vous en avertit. Complétez le bloc créancier avant d'envoyer des factures qui doivent être payées par virement.

## 5. Émettre un document de test

Créez un client de test et un devis, émettez-le, puis vérifiez le PDF.

:::caution
Un document émis est verrouillé. Corrigez-le uniquement par un avoir. Utilisez un client de test pour cette étape.
:::
