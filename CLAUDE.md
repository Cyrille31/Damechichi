# Règles du dépôt (CGExcel)

Ces règles s'appliquent à toutes les sessions qui travaillent sur ce dépôt.

## Licence : MIT + BAL 1.0

- Le fichier `LICENSE` contient le texte standard de la licence MIT avec la
  ligne « Copyright (c) 2026 Cyrille Gindre — CGExcel », suivi de la section
  « BAL 1.0 — Bonne Action License ». Ne pas le remplacer ni le modifier
  sans demande explicite.
- Partout ailleurs où la licence est mentionnée (README, écran « À propos »,
  en-têtes des fichiers source, nouveaux fichiers…), écrire
  « Licence MIT + BAL 1.0 — Bonne Action License » suivi de cette phrase
  obligatoire, **mot pour mot** :

  > En échange, une seule chose vous est demandée, sur l'honneur : faire une bonne action chaque jour. Aider un voisin, sourire à un inconnu, ramasser un papier… c'est vous qui voyez.

- Cartouche à utiliser dans les en-têtes et le pied de page de l'application :
  « CGExcel — Cyrille Gindre — © 2026 ».
- Tout nouveau fichier source reçoit le même en-tête que les fichiers
  existants (voir `js/game.js`) : cartouche, mention de licence, phrase
  obligatoire, renvoi au fichier `LICENSE`.
- Si le README ou l'écran « À propos » n'existent pas, ajouter au moins une
  section Licence au README.

## Règles du jeu à respecter

- Saut long : n cases vides, un pion, n cases vides, puis la case d'arrivée.
- Un pion peut traverser les triangles des autres joueurs mais ne peut pas
  s'y arrêter (seulement au centre, chez lui ou dans son triangle d'arrivée).
