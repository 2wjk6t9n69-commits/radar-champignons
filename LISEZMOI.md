# Radar Champignon — mise en ligne

Cette app est **100% statique** (pas de serveur, pas de base de données) : c'est juste
un dossier de fichiers. Tu dois l'héberger quelque part avec une adresse HTTPS pour
pouvoir l'installer sur ton téléphone.

## Option la plus simple : Netlify Drop (2 minutes, gratuit)

1. Va sur https://app.netlify.com/drop
2. Glisse-dépose **tout le contenu de ce dossier** (pas le dossier lui-même, son contenu :
   `index.html`, `app.js`, `style.css`, `engine_v32.js`, `manifest.json`, `sw.js`, `icons/`)
3. Netlify te donne une adresse en `https://....netlify.app` — c'est en ligne.
4. (Optionnel) Crée un compte gratuit pour garder l'adresse de façon permanente et pouvoir
   la personnaliser (`monradar.netlify.app`).

## Alternative : GitHub Pages (gratuit, adresse stable)

1. Crée un dépôt GitHub, mets-y tous les fichiers de ce dossier à la racine.
2. Dans les réglages du dépôt → *Pages* → Source : branche `main`, dossier `/root`.
3. Ton app sera accessible à `https://tonpseudo.github.io/nom-du-depot/`.

## Alternative : Vercel

Même principe : dépose le dossier sur https://vercel.com/new, aucune configuration
nécessaire (site 100% statique).

---

## Installer l'app sur ton téléphone

Une fois l'adresse en ligne, ouvre-la dans le navigateur du téléphone :

- **Android (Chrome) :** un bandeau « Ajouter à l'écran d'accueil » apparaît
  automatiquement (ou menu ⋮ → « Installer l'application »).
- **iPhone (Safari, obligatoire — pas Chrome) :** bouton Partager (le carré avec la
  flèche) → « Sur l'écran d'accueil ». L'app propose ce raccourci automatiquement
  dans l'interface.

Une fois installée, elle s'ouvre en plein écran comme une vraie app, avec son icône.

---

## Comment ça marche

- Tu touches un point sur la carte → l'app va chercher la météo réelle de ce point
  (température, pluie, humidité du sol, sur les 35 derniers jours + tendance à venir)
  via l'API gratuite **Open-Meteo**, sans clé ni compte.
- Le moteur `engine_v32.js` (ton moteur, non modifié dans sa logique) croise cette météo
  avec l'habitat/le sol que tu précises dans le panneau « Affiner habitat & sol », et la
  saison, pour donner un score par espèce.
- Aucune donnée n'est envoyée à un serveur à toi : tout tourne dans le navigateur.
  Les seuls appels réseau sont vers les tuiles de carte (OpenStreetMap) et la météo
  (Open-Meteo).

## Limites à connaître

- Il faut du réseau (4G/wifi) pour charger la carte et la météo à chaque nouveau
  secteur — ce n'est pas utilisable complètement hors-ligne en forêt sans couverture.
  Seule l'app elle-même (l'interface) est mise en cache et s'ouvre hors-ligne.
- Le score reste une estimation de compatibilité écologique, pas une garantie de
  présence — ton moteur l'indique déjà lui-même dans chaque résultat.
