# Logez-moi

Site de logements meublés à Montréal pour des séjours de 31 nuits et plus.

- `site/dist/` : site vitrine, photos, fiches et recherche de disponibilités.
- `api/worker/index.js` : lecture des huit calendriers iCal et recherche des séjours disponibles.

Les URL iCal sont fournies au serveur dans les variables secrètes ICAL_* indiquées dans le Worker. Ne jamais les ajouter au dépôt. Le formulaire prépare une demande de test sans l’envoyer ni bloquer les dates.

Pour servir la vitrine localement : `python3 -m http.server 4173 --directory site/dist`. Pour construire et vérifier le service : `cd api && npm run build && npm run validate`. La vitrine utilise le service de disponibilités hébergé; son accès dépend des autorisations de cet hébergement.
