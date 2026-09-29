# Connecter Moodle à son assistant IA (MCP)

Un connecteur **gratuit, local et indépendant** pour consulter vos cours Moodle,
devoirs, quiz, notes et calendrier avec un assistant compatible MCP. Chaque
étudiant utilise **son propre compte**. Aucun compte partagé ni serveur de
connexion tiers. Fonctionne avec Polytechnique Montréal et avec d'autres Moodle.

## Installation facile (Windows, Mac, Linux)

1. Ouvrez **[Télécharger la dernière version](https://github.com/CloudDown/moodle-ws-mcp/releases/latest)**.
2. Choisissez le fichier qui correspond à votre ordinateur :

   | Ordinateur | Fichier à télécharger |
   | --- | --- |
   | Windows habituel | `moodle-ws-mcp-windows-x64.zip` |
   | Windows ARM | `moodle-ws-mcp-windows-arm64.zip` |
   | Mac avec puce Apple (M1, M2, M3, M4…) | `moodle-ws-mcp-macos-arm64.zip` |
   | Mac Intel | `moodle-ws-mcp-macos-x64.zip` |
   | Linux habituel | `moodle-ws-mcp-linux-x64.zip` |
   | Linux ARM | `moodle-ws-mcp-linux-arm64.zip` |

   **Vous ne connaissez pas votre puce ?** Sur Mac : menu  → « À propos de ce
   Mac ». Sur Windows, prenez `windows-x64` sauf si « Type du système » indique
   ARM. Pour Linux, la version x64 convient à la plupart des PC.
3. **Décompressez le ZIP** (ouvrez-le puis « Extraire tout » sur Windows).
   Ouvrez le dossier extrait et lancez **`Installer.cmd`** (Windows) ou
   **`Installer.command`** (Mac). Sur Linux, lancez `sh Installer.sh` depuis ce
   dossier. Le programme se copie ensuite dans votre dossier personnel : vous
   pouvez supprimer le ZIP téléchargé.
4. L'assistant demande l'adresse de votre Moodle. Pour Polytechnique Montréal,
   **appuyez simplement sur Entrée** : `https://moodle.polymtl.ca` est déjà
   proposé. Entrez votre identifiant Moodle et votre mot de passe au clavier :
   le mot de passe **ne s'affiche pas**. Choisissez ensuite **1 OpenCode** ou
   **2 Claude Desktop**. Le connecteur ajoute automatiquement la configuration
   MCP dans l'application choisie, sans effacer les autres réglages.
5. Redémarrez votre application IA et demandez : **« Vérifie ma connexion
   Moodle »** (`moodle_status`). Si la connexion échoue, relancez l'installateur
   pour corriger l'identifiant ou le token.

**Pas besoin d'installer Node.js ou npm.** Sur chaque appareil, répétez les
étapes avec *votre* compte. Si Windows ou macOS affiche une alerte car le fichier
provient d'Internet, lisez le nom du programme et sa source sur cette page avant
de l'autoriser. Sur macOS, après la première tentative, les réglages système
« Confidentialité et sécurité » permettent « Ouvrir quand même » pour ce
programme non notarié. Les exécutables ne sont pas signés par Apple/Microsoft.

### Si votre établissement utilise une connexion unique (SSO)

Certains établissements n'acceptent **pas** le mot de passe habituel dans l'API
mobile, même s'il fonctionne dans le navigateur (connexion SSO ou double
authentification). Si l'installateur indique que la connexion est refusée,
relancez-le et répondez **n** à « Obtenir un token avec votre identifiant ? ».
Collez ensuite **un token Web Services personnel** fourni par votre service
informatique ou généré dans Moodle si votre établissement offre cette option.
Ne partagez jamais votre mot de passe avec quelqu'un pour obtenir un token.

## Le token : quel champ prendre ?

Pour les personnes qui utilisent directement l'API, l'adresse indiquée dans la
question est l'API officielle du service mobile Moodle :

`https://moodle.polymtl.ca/login/token.php`

L'exemple `?username=ID&password=PWD&service=moodle_mobile_app` indique les
trois champs attendus : `username` (votre identifiant Moodle), `password` et
`service=moodle_mobile_app`. **Ne remplacez pas `ID` et `PWD` par vos vrais
identifiants dans l'URL du navigateur** :
l'URL peut rester dans l'historique et les journaux. L'installateur effectue
la demande en **POST HTTPS**, sans afficher ni enregistrer le mot de passe.

Exemple de réponse Moodle, avec des valeurs **fictives** :

```json
{
  "token": "EXEMPLE_TOKEN_WEB_SERVICES",
  "privatetoken": "EXEMPLE_TOKEN_PRIVE"
}
```

**Prenez uniquement la valeur de `token`** pour le connecteur. Ne prenez pas
`privatetoken` et ne collez pas tout l'objet JSON. L'installateur extrait lui-même
`token`, vérifie que le site le reconnaît et n'enregistre que ce token dans
`~/.moodle-ws-mcp.json` (dans votre dossier utilisateur Windows également).
Ne publiez jamais votre token dans un dépôt Git ou une conversation publique.

Si la réponse contient `"errorcode": "invalidlogin"`, vérifiez votre
identifiant et votre mot de passe. Si le service mobile est désactivé ou si
vous utilisez le SSO, demandez à l'assistance Moodle de votre établissement
comment obtenir un token personnel pour `moodle_mobile_app`.

## Ce que peut faire le connecteur

- `moodle_status` : vérifier le site et le compte connecté.
- `moodle_my_courses`, `moodle_course_content` : vos cours et activités visibles.
- `moodle_assignments`, `moodle_quizzes`, `moodle_grades`, `moodle_calendar` :
  devoirs, quiz, notes et événements auxquels votre compte a accès.
- `ws_discover` : chercher les fonctions Moodle **autorisées par votre token**.
- `ws_schema`, `ws_call` : inspecter et appeler une fonction de l'API Moodle.
  Les fonctions qui modifient les données sont désactivées par défaut.

Le catalogue embarqué provient de Moodle 5.1.6. Le site de votre établissement,
sa version et les permissions de votre compte décident des fonctions utilisables.
Le connecteur n'ouvre pas les activités cachées ni les notes d'autres étudiants.

## Autres façons de l'installer

Pour les personnes qui ont déjà Node.js 20+, l'installation npm reste possible
après publication sur npm : `npx -y moodle-ws-mcp init`, puis ajoutez
`npx -y moodle-ws-mcp` comme serveur MCP local (Windows : `npx.cmd`). Vous pouvez
aussi fournir `MOODLE_URL` et `MOODLE_TOKEN` dans l'environnement de votre
client MCP. `MOODLE_WSTOKEN` est un alias. Le mode écriture nécessite
`MOODLE_ALLOW_WRITE=true`.

Si vous préférez configurer votre application IA manuellement, indiquez le
chemin installé comme commande d'un serveur MCP local (transport **stdio**) :

| Application | Emplacement de la commande MCP |
| --- | --- |
| OpenCode 1.x | `mcp.moodle.command: ["CHEMIN_VERS_LE_PROGRAMME"]` dans `opencode.json` |
| OpenCode 2.x | `mcp.servers.moodle.command: ["CHEMIN_VERS_LE_PROGRAMME"]` |
| Claude Desktop | `mcpServers.moodle.command: "CHEMIN_VERS_LE_PROGRAMME"` |

L'installateur sauvegarde le fichier de configuration existant avant de le
modifier et accepte les commentaires JSONC d'OpenCode. Si ce fichier est
invalide, il ne le remplace pas : corrigez-le puis relancez l'installateur.

## Développer et publier

```sh
npm ci
npm test
npm run typecheck
npm run build
node dist/index.js --help

# Construction autonome (Bun installé sur la machine de développement)
npm run build:binary
node scripts/smoke-binary.mjs build/moodle-ws-mcp
```

Une poussée Git sur `main` vérifie les exécutables natifs dans GitHub Actions.
Une étiquette `v0.1.0` (correspondant à `package.json`) publie automatiquement
les ZIP Windows, macOS et Linux dans [GitHub Releases](https://github.com/CloudDown/moodle-ws-mcp/releases).

Pour régénérer le catalogue depuis une copie du code Moodle :

```sh
node scripts/generate-catalog.mjs /chemin/vers/moodle
```

Le générateur lit les déclarations Web Services de Moodle; vérifiez sa sortie
avant de changer de version Moodle. Le code du connecteur est sous licence MIT.
Le catalogue contient des extraits du code Moodle sous GPL-3.0-ou-plus : voir
[catalog/LICENSE.md](catalog/LICENSE.md). Moodle est une marque de Moodle Pty Ltd;
ce connecteur communautaire n'est pas un produit officiel de Moodle ou de
Polytechnique Montréal.
