# Logez-moi

`site/dist/` contient la vitrine de location meublée, les photos et les calendriers des huit logements. `api/` contient le service de disponibilités. Les liens iCal privés se configurent dans les secrets du serveur. Pour construire le Worker : `cd api && npm run build && npm run validate`.

La demande de réservation requiert un séjour disponible de 31 nuits minimum. Le formulaire transmet les coordonnées et les dates par FormSubmit à ROOM pour confirmation manuelle. Activer le formulaire par courriel si demandé et vérifier les deux boîtes de réception.
