#!/usr/bin/env bash
# Imprime sur stdout l'adresse IP par laquelle un conteneur Docker rootless (pasta/slirp4netns,
# `--disable-host-loopback`) peut joindre l'hôte.
#
# Ne PAS utiliser localhost/127.0.0.1 ni host.docker.internal : mesuré sur ce dépôt (voir
# e2e/README.md « Pourquoi une IP LAN ») que le mode rootless de Docker bloque explicitement le
# loopback hôte depuis un conteneur. La vraie IP de l'interface LAN de l'hôte, elle, reste
# joignable — ce n'est pas un chemin loopback, juste une route normale vers l'hôte.
#
# Méthode : demander au noyau quelle IP source il choisirait pour atteindre l'extérieur
# (`ip route get`), sans envoyer aucun paquet. Fonctionne quel que soit le nom de l'interface
# (enp86s0 ici, autre chose ailleurs) — jamais d'interface en dur.
set -euo pipefail

ip -4 route get 1.1.1.1 2>/dev/null | grep -oP '(?<=src )\d+\.\d+\.\d+\.\d+' | head -n1
