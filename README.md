# SatSky – satellites en direct (PWA)

Vise le ciel avec ton téléphone : la caméra s'affiche et les satellites sont dessinés à leur position réelle.

## Mettre en ligne (HTTPS obligatoire pour caméra, boussole et GPS)
- **Netlify Drop** : glisse le dossier sur https://app.netlify.com/drop
- **GitHub Pages** : pousse le dossier dans un repo, Settings → Pages → branche `main`
- En local pour tester sur le téléphone : `npx serve .` + un tunnel HTTPS (`cloudflared tunnel --url http://localhost:3000`)

Puis sur le téléphone : « Ajouter à l'écran d'accueil ».

## Fonctionnement
- Orbites : CelesTrak (format TLE), mises en cache 6 h (Cache API) → marche hors ligne avec les dernières données.
- Calcul : SGP4 via satellite.js 5.0.0 (embarqué, MIT), position du Soleil pour savoir si le satellite est éclairé
  et si le ciel est assez sombre (Soleil < −6°) → en ambre = visible à l'œil nu.
- Visée : DeviceOrientation (Android `deviceorientationabsolute`, iOS `webkitCompassHeading`),
  projection perspective avec le champ de vision réglable.
- Carte : vue polaire (zénith au centre), tournée selon la boussole si disponible.

## Réglages utiles
- **Correction du nord** si la boussole du téléphone dérive (vise la Lune pour caler).
- **Champ de vision** si les points ne collent pas à l'image caméra quand tu tournes.
