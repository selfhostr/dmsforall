# syntax=docker/dockerfile:1
#
# Image du service `backup` (docker-compose.yml) : sauvegarde nocturne de PostgreSQL,
# planifiée par un simple boucle bash (planifier.sh), jamais par un cron/systemd du serveur —
# cohérent avec le choix du reste de docker-compose.yml (« TOUT en conteneurs »).
#
# Construite sur `postgres:16-alpine` — la MÊME image et le MÊME tag que le service `postgres`
# de docker-compose.yml — plutôt qu'une base générique, pour la raison qui motive déjà ce
# choix ailleurs dans ce dépôt (voir le commentaire du service `postgres`) : `pg_dump`/`pg_restore`
# doivent être EXACTEMENT la même version majeure que le serveur sauvegardé. Un `pg_dump` 17 (ou
# 15) contre un serveur 16 est un risque de format de dump subtilement incompatible, découvert le
# jour où on a besoin de restaurer — jamais avant. Coût accepté : cette image embarque aussi le
# serveur PostgreSQL lui-même (jamais démarré ici), plus lourd qu'une image `-client` dédiée qui
# n'existe pas officiellement pour Alpine — non chiffrant à ce stade (philosophie §0 : pas de
# multi-stage sophistiqué avant besoin réel de taille d'image).
FROM postgres:16-alpine

# bash      : scripts plus lisibles que POSIX sh strict (tableaux, mktemp --suffix, [[ ]]).
# coreutils : `date`/`mktemp` GNU — le `date` de busybox (fourni par défaut dans Alpine) ne sait
#             ni parser fiablement une date arbitraire (`date -d "20260101"`) ni servir à
#             l'arithmétique de purger.sh (échéances hebdo/mensuelles) ; `mktemp --suffix` est
#             également une extension GNU absente de busybox.
# age       : chiffrement asymétrique au repos (voir sauvegarder.sh — clé publique seulement ici
#             en usage normal ; la clé de TEST, voir restaurer-test.sh/planifier-test.sh, est
#             l'exception documentée et bornée — jamais la clé privée RÉELLE).
# tzdata    : nécessaire pour qu'Europe/Zurich soit réellement résolu par `date` (musl seul ne
#             suffit pas, il lui faut la base de données de zones sur disque).
# rclone    : copie hors site (copier-hors-site.sh) et récupération pour le test mensuel
#             (planifier-test.sh) — paquet Alpine officiel, PAS un client propre à un fournisseur
#             (S3/B2/SFTP/WebDAV/… derrière une seule interface) : l'hébergement de ce projet n'est
#             pas encore choisi (voir docs/exploitation-sauvegardes.md), ce mécanisme ne doit
#             présumer d'aucun fournisseur — changer de destination est un changement de fichier de
#             config (secrets/rclone.conf, jamais commité), jamais un changement de ce Dockerfile.
RUN apk add --no-cache bash coreutils age tzdata rclone

ENV TZ=Europe/Zurich

# Utilisateur non-root DÉDIÉ avec uid/gid EXPLICITES (10001) — contrairement à `apps/api/Dockerfile`
# (qui laisse Alpine attribuer le premier uid système disponible, fragilité documentée dans
# docker-compose.yml), pour que le service `init-sauvegardes` de docker-compose.yml
# puisse chown()er le volume `dfa_postgres_backups` vers une valeur STABLE, connue sans devoir
# lancer un conteneur pour la découvrir.
RUN addgroup -g 10001 sauvegarde \
  && adduser -D -u 10001 -G sauvegarde -h /var/lib/sauvegarde -s /bin/bash sauvegarde

# TOUS les scripts de ce répertoire dans l'image, y compris ceux qui ne servaient QUE depuis le
# poste de @laupernoe jusqu'ici (restaurer-test.sh) : le test de restauration mensuel automatisé
# (planifier-test.sh, service `restauration-test` de docker-compose.yml) tourne DANS un
# conteneur construit sur CETTE image — voir son en-tête pour pourquoi (pas de socket Docker,
# initdb/pg_ctl locaux). `restaurer.sh` (restauration RÉELLE de production, jamais automatisée,
# toujours lancée à la main depuis le CHECKOUT sur le serveur — voir son en-tête, il pilote
# `docker compose exec` depuis l'HÔTE) reste volontairement HORS de l'image : il n'a rien à y
# faire, une image ne peut pas lancer `docker compose` sur son propre hôte sans le socket Docker
# qu'on a justement écarté ci-dessus pour restaurer-test.sh.
COPY --chmod=0555 planifier.sh sauvegarder.sh purger.sh verifier-vivant.sh copier-hors-site.sh restaurer-test.sh planifier-test.sh /scripts/

USER sauvegarde
WORKDIR /var/lib/sauvegarde

# ENTRYPOINT par défaut = service `backup` (sauvegarde nocturne). Le service `restauration-test`
# (docker-compose.yml, MÊME image, MÊME raison que `worker` réutilise l'image `api` : jamais
# deux images à faire dériver l'une de l'autre) remplace cet ENTRYPOINT par `planifier-test.sh` via
# `entrypoint:` — voir ce service.
ENTRYPOINT ["/scripts/planifier.sh"]
