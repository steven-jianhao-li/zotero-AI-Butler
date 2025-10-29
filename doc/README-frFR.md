# Modèle d'extension Zotero

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Ceci est un modèle pour développer une extension pour [Zotero](https://www.zotero.org/).

[English](../README.md) | [简体中文](./README-zhCN.md) | [Français](./README-frFR.md)

- Documentation
  - [📖 Plugin Development Documentation](https://zotero-chinese.com/plugin-dev-guide/) (Chinese, not yet complete)
  - [📖 Plugin Development Documentation for Zotero 7](https://www.zotero.org/support/dev/zotero_7_for_developers)
- Outils pour le développement de pluqgins
  - [🛠️ Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) | [API Documentation](https://github.com/windingwind/zotero-plugin-toolkit/blob/master/docs/zotero-plugin-toolkit.md)
  - [🛠️ Zotero Plugin Scaffold](https://github.com/northword/zotero-plugin-scaffold)
  - [ℹ️ Zotero Type Definitions](https://github.com/windingwind/zotero-types)
  - [📜 Zotero Source Code](https://github.com/zotero/zotero)
  - [📌 Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) (Ce dépot)

> [!TIP]
> 👁 Surveillez ce dépôt afin d'être informé des corrections et des mises à jour.

## Exetensions développées sur la base de ce modèle

[![GitHub Repo stars](https://img.shields.io/github/stars/windingwind/zotero-better-notes?label=zotero-better-notes&style=flat-square)](https://github.com/windingwind/zotero-better-notes)
[![GitHub Repo stars](https://img.shields.io/github/stars/windingwind/zotero-pdf-preview?label=zotero-pdf-preview&style=flat-square)](https://github.com/windingwind/zotero-pdf-preview)
[![GitHub Repo stars](https://img.shields.io/github/stars/windingwind/zotero-pdf-translate?label=zotero-pdf-translate&style=flat-square)](https://github.com/windingwind/zotero-pdf-translate)
[![GitHub Repo stars](https://img.shields.io/github/stars/windingwind/zotero-tag?label=zotero-tag&style=flat-square)](https://github.com/windingwind/zotero-tag)
[![GitHub Repo stars](https://img.shields.io/github/stars/iShareStuff/ZoteroTheme?label=zotero-theme&style=flat-square)](https://github.com/iShareStuff/ZoteroTheme)
[![GitHub Repo stars](https://img.shields.io/github/stars/MuiseDestiny/zotero-reference?label=zotero-reference&style=flat-square)](https://github.com/MuiseDestiny/zotero-reference)
[![GitHub Repo stars](https://img.shields.io/github/stars/MuiseDestiny/zotero-citation?label=zotero-citation&style=flat-square)](https://github.com/MuiseDestiny/zotero-citation)
[![GitHub Repo stars](https://img.shields.io/github/stars/MuiseDestiny/ZoteroStyle?label=zotero-style&style=flat-square)](https://github.com/MuiseDestiny/ZoteroStyle)
[![GitHub Repo stars](https://img.shields.io/github/stars/volatile-static/Chartero?label=Chartero&style=flat-square)](https://github.com/volatile-static/Chartero)
[![GitHub Repo stars](https://img.shields.io/github/stars/l0o0/tara?label=tara&style=flat-square)](https://github.com/l0o0/tara)
[![GitHub Repo stars](https://img.shields.io/github/stars/redleafnew/delitemwithatt?label=delitemwithatt&style=flat-square)](https://github.com/redleafnew/delitemwithatt)
[![GitHub Repo stars](https://img.shields.io/github/stars/redleafnew/zotero-updateifsE?label=zotero-updateifsE&style=flat-square)](https://github.com/redleafnew/zotero-updateifsE)
[![GitHub Repo stars](https://img.shields.io/github/stars/northword/zotero-format-metadata?label=zotero-format-metadata&style=flat-square)](https://github.com/northword/zotero-format-metadata)
[![GitHub Repo stars](https://img.shields.io/github/stars/inciteful-xyz/inciteful-zotero-plugin?label=inciteful-zotero-plugin&style=flat-square)](https://github.com/inciteful-xyz/inciteful-zotero-plugin)
[![GitHub Repo stars](https://img.shields.io/github/stars/MuiseDestiny/zotero-gpt?label=zotero-gpt&style=flat-square)](https://github.com/MuiseDestiny/zotero-gpt)
[![GitHub Repo stars](https://img.shields.io/github/stars/zoushucai/zotero-journalabbr?label=zotero-journalabbr&style=flat-square)](https://github.com/zoushucai/zotero-journalabbr)
[![GitHub Repo stars](https://img.shields.io/github/stars/MuiseDestiny/zotero-figure?label=zotero-figure&style=flat-square)](https://github.com/MuiseDestiny/zotero-figure)
[![GitHub Repo stars](https://img.shields.io/github/stars/l0o0/jasminum?label=jasminum&style=flat-square)](https://github.com/l0o0/jasminum)
[![GitHub Repo stars](https://img.shields.io/github/stars/lifan0127/ai-research-assistant?label=ai-research-assistant&style=flat-square)](https://github.com/lifan0127/ai-research-assistant)
[![GitHub Repo stars](https://img.shields.io/github/stars/daeh/zotero-markdb-connect?label=zotero-markdb-connect&style=flat-square)](https://github.com/daeh/zotero-markdb-connect)

Si vous utilisez ce dépôt, je vous recommande de mettre le badge suivant dans votre README :

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

```md
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
```

## Fonctionalités

- Architecture orientée événements, basée sur la programmation fonctionnelle utilisant des squeletteq étendus ;
- Simple et convivial, il est prêt à l'emploi.
- ⭐ [Nuveauté !] Rechargement automatique à chaud ! Chaque fois que le code source est modifié, il est automatiquement compilé et rechargé. [Voir ici→]((#auto-hot-reload)
- Nombreux exemples dans `src/modules/examples.ts` ; ils couvrent la plupart des usages des APIs habituellement utilisées dans les extensions (en utilisant [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit));
- Support de TypeScript :
  - Prise en charge complète de la définition des types pour l'ensemble du projet Zotero, qui est écrit en JavaScript (avec les [zotero-types](https://github.com/windingwind/zotero-types));
  - Variables globales et configuration de l'environnement ;
- Gestion des workflows pour le développement, la finalisation et la publication des extensions :
  - - Génére / met à jour automatiquement l'id/version de l'extension, met à jour les configurations, et définit les variables d'environnement (`development` / `production`);
  - Construit et recharge automatiquement le code dans Zotero ;
  - Publie automatiquement les nouvelles versions sur GitHub.
- Intégration avec Prettier et ES Lint (analyseur et formatteur de code).

## Exemples

Ce dépot fournit des exemples pour les API [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit).

Recherchez `@example` dans `src/examples.ts`. Les exemples sont appelés dans `src/hooks.ts`.

### Exemples basiques

- registerNotifier
- registerPrefs, unregisterPrefs

### Exemples utilisant les raccourcis clavier

- registerShortcuts
- exampleShortcutLargerCallback
- exampleShortcutSmallerCallback
- exampleShortcutConflictionCallback

### Exemples d'interface utilisateur (UI)

![image](https://user-images.githubusercontent.com/33902321/211739774-cc5c2df8-5fd9-42f0-9cdf-0f2e5946d427.png)

- registerStyleSheet (utilisé par l'extension officielle make-it-red qui sert d'exemple)
- registerRightClickMenuItem
- registerRightClickMenuPopup
- registerWindowMenuWithSeprator
- registerExtraColumn
- registerExtraColumnWithCustomCell
- registerCustomItemBoxRow
- registerLibraryTabPanel
- registerReaderTabPanel

### Exemples avec des panneaux de préférences

![image](https://user-images.githubusercontent.com/33902321/211737987-cd7c5c87-9177-4159-b975-dc67690d0490.png)

- Liaisons avec les préférences

- Événements de l'interface utilisateur

- Table

- Locale

Voir [`src/modules/preferenceScript.ts`](../src/modules/preferenceScript.ts)

### Exemples de fenêtre d'aide

![image](https://user-images.githubusercontent.com/33902321/215119473-e7d0d0ef-6d96-437e-b989-4805ffcde6cf.png)

- dialogExample
- clipboardExample
- filePickerExample
- progressWindowExample
- vtableExample (voir Exemples avec des panneaux de préférences)

### Exemples de prompts

Un module d'invite (entrée de commande contextuelle) de style Obsidian. Il accepte les commandes textuelles pour exécuter le callback, avec un affichage optionnel dans la fenêtre popup.

S'active avec `Shift+P`.

![image](https://user-images.githubusercontent.com/33902321/215120009-e7c7ed27-33a0-44fe-b021-06c272481a92.png)

- registerAlertPromptExample

## Guide de démarrage rapide

### 0. Pré-requis

1. Installez une version beta de Zotero: <https://www.zotero.org/support/beta_builds>
2. Installez [Node.js latest LTS version](https://nodejs.org/en/) and [Git](https://git-scm.com/)

> [!NOTE]
> Ce guide suppose que vous avez une compréhension initiale de la structure de base et du fonctionnement des extensiosn Zotero. Si ce n'est pas le cas, veuillez vous référer à la [documentation](https://www.zotero.org/support/dev/zotero_7_for_developers)et aux exemples officiels de l'extension [Make It Red](https://github.com/zotero/make-it-red) en premier lieu.

### 1. Créez votre dépôt

1. Cliquez sur `Use this template`
2. Clonez votre dépôt avec git.
   <details >
   <summary>💡 Démarrer votre projet avec GitHub Codespace</summary>

   _GitHub CodeSpace_ vous permet de démarrer votre projet sans avoir à télécharger le code/IDE/dépendances localement.

   Effectuez les étapes ci-dessus et créez votre première extension en 30 secondes!
   - Allez en haut de la [page d'accueil](https://github.com/windingwind/zotero-plugin-template), cliquez sur le bouton vert `Use this template`, cliquez sur `Open in codespace`. ous devrez peut-être vous connecter à votre compte GitHub.
   - Attendez que _GitHub CodeSpace_ se charge.

   </details>

3. Entrez dans le dossier du dépôt

### 2. Configurez les paramètres du Modèle et l'environnement de développement

1. Modifier les paramètres dans `./package.json`, y compris :

   ```jsonc
   {
     "version": "0.0.0",
     "description": "",
     "config": {
       "addonName": "", // name to be displayed in the plugin manager
       "addonID": "", // ID to avoid conflict. IMPORTANT!
       "addonRef": "", // e.g. Element ID prefix
       "addonInstance": "", // the plugin's root instance: Zotero.${addonInstance}
       "prefsPrefix": "extensions.zotero.${addonRef}", // the prefix of prefs
     },
     "repository": {
       "type": "git",
       "url": "git+https://github.com/your-github-name/repo-name.git",
     },
     "author": "Your Name",
     "bugs": {
       "url": "https://github.com/your-github-name/repo-name/issues",
     },
     "homepage": "https://github.com/your-github-name/repo-name#readme",
   }
   ```

   > ![WARNING]
   > Veillez à bien définir addonID et addonRef pour éviter tout conflit.

   Si vous avez besoin d'héberger vos paquets XPI en dehors de GitHub, modifiez `updateURL` et ajoutez `xpiDownloadLink` dans `zotero-plugin.config.ts`.

2. Copiez le fichier de la variable d'environnement. Modifiez la commandes quilance la version beta de Zotero.

   > Créez un profil de développement (Optionnel)  
   > Démarrez la version beta de Zotero avec `/path/to/zotero -p`. Créez un nouveau profil et utilisez-le comme profil de développement. Ne le faites qu'une seule fois !

```sh
cp .env.example .env
vim .env
```

    Si vous développez plus d'une extension, vous pouvez stocker le chemin bin et le chemin profile dans les variables d'environnement du système, qui peuvent être omises ici.

3. Installez les dépendances avec `npm install`

   > Si vous utilisez `pnpm` comme gestionnaire de paquets pour votre projet, vous devez ajouter `public-hoist-pattern[]=*@types/bluebird*` à `.npmrc`, voir <https://github.com/windingwind/zotero-types?tab=readme-ov-file#usage>.

   Si vous obtenez `npm ERR ! ERESOLVE unable to resolve dependency tree` avec `npm install`, qui est un bogue de dépendance en amont de typescript-eslint, utilisez la commande `npm i -f` pour l'installer.

### 3. Codez

Démarrez le serveur de développement avec `npm start`:

- Il fera La pré-construction de l'extension en mode développement
- Il démarrera Zotero avec l'extension chargée depuis `build/`
- Il surveillera `src/**` et `addon/**`.
  - Si `src/**` a changé, lancez esbuild et rechargez.
  - Si `addon/**` a changé, reconstruisez l'extension (en mode développement) et recharger là.

#### Rechargement automatique à chaud

Fatigué des redémarrages incessants ? Oubliez-les !

1. Lancez `npm start`.
2. Coder. (Oui, c'est tout)

Lorsque des changements de fichiers sont détectés dans `src` ou `addon`, l'extension 'sera automatiquement compilé et rechargé.

<details style="text-indent: 2em">
<summary>💡 Étapes pour ajouter cette fonctionnalité à une extension existante :</summary>

Voir [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold).

</details>

#### Déboguer dans Zotero

Vous pouvez également :

- Tester les extraits de code dans Outils -> Développeur -> Run Javascript ;
- Déboguer la sortie avec`Zotero.debug()`. Trouver les sorties dans Aide->Journal de débogage->Voir le journal;
- Déboguer l'interface utilisateur. Zotero est construit sur le cadre XUL de Firefox. Déboguez l'interface utilisateur XUL avec un logiciel comme [XUL Explorer](https://udn.realityripple.com/docs/Archive/Mozilla/XUL_Explorer).
  > Documentation de XUL : <http://www.devdoc.net/web/developer.mozilla.org/en-US/docs/XUL.html>

### 4. Construction (Build)

Exécutez `npm run build` construire l'extension en mode production : t le xpi pour l'installation et le code construit se trouve dans le dossier `build`.

Étapes de la construction :

- Créez/videz `build/`.
- Copiez `addon/**` dans `build/addon/**`.
- Remplacez les espaces réservés : utilisez `replace-in-file` pour remplacer les mots-clés et les configurations définis dans `package.json` dans les fichiers non-construits (`xhtml`, `json`, et al.).

- Préparez les fichiers de locale pour [éviter les conflits](https://www.zotero.org/support/dev/zotero_7_for_developers#avoiding_localization_conflicts)
- Renommer `**/*.flt` en `**/${addonRef}-*.flt`
- Préfixez chaque message fluent[TODO] avec `addonRef-`
- Utilisez ESBuild pour construire le code source `.ts` vers `.js`, construisez `src/index.ts` vers `./build/addon/content/scripts`.
- (Mode production uniquement) Zipper le fichier `./build/addon` vers `./build/*.xpi`.
- (Mode production uniquement) Préparez `update.json` ou `update-beta.json`

> [!NOTE]
>
> **Quelle est la différence entre mode développement et production ?**
>
> - Cette variable d'environnement est stockée dans `Zotero.${addonInstance}.data.env`. La sortie vers la console est désactivée en mode production.
> - Vous pouvez décider ce que les utilisateurs ne peuvent pas voir/utiliser en fonction de cette variable.
> - En mode production, le script de construction va empaqueter l'extension et mettre à jour le fichier `update.json`.

### 5. Produire une Release

pour construire et produire une Release, utilisez :

```shell
# version increase, git add, commit and push
# then on ci, npm run build, and release to GitHub
npm run release
```

> [!NOTE]
> Cela utilisera [Bumpp](https://github.com/antfu-collective/bumpp) pour saisir le nouveau numéro de version, modifier localement la version, exécuter tous les scripts (pré/post) version définis dans `package.json`, commit, build (optionnel), marquer le commit avec le numéro de version et pousser les commits et les tags git. Bumpp peut être configuré dans `zotero-plugin-config.ts` ; par exemple, ajoutez `release : { bumpp : { execute : « npm run build » } }` pour construire également avant de commiter.
> Par la suite, GitHub Action reconstruira l'extensions et utilisera le script `release` de `zotero-plugin-scaffold` pour publier l'XPI sur GitHub Release. De plus, une version séparée (tag : `release`) sera créée ou mise à jour qui inclura les manifestes de mise à jour `update.json` et `update-beta.json` en tant qu'actifs. Ceux-ci seront disponibles à `https://github.com/{{owner}}/{{repo}}/releases/download/release/update*.json`.

#### À propos des pré-releases

Le modèle définit `prerelease` comme la version beta de l'extension, lorsque vous sélectionnez une version `prerelease` dans Bumpp (avec `-` dans le numéro de version). Le script de construction créera un nouveau `update-beta.json` pour l'utilisation de la prerelease, ce qui assure que les utilisateurs de la version normale ne seront pas en mesure de mettre à jour vers la version beta. Seuls les utilisateurs qui ont téléchargé et installé manuellement la version bêta seront en mesure de mettre à jour automatiquement vers la prochaine version bêta.

Lorsque la prochaine version normale sera mise à jour, `update.json` et `update-beta.json` seront tous deux mis à jour (sur la version spéciale `release`, voir ci-dessus) afin que les utilisateurs de la version normale et de la version bêta puissent se mettre à jour vers la nouvelle version normale.

> [!WARNING]
> La distinction entre les versions des extensions compatibles avec Zotero 6 et Zotero 7 devrait être strictement faite en configurant `applications.zotero.strict_min_version` dans `addons.__addonID__.updates[]` de `update.json` respectivement, afin que Zotero le reconnaisse correctement, voir <https://www.zotero.org/support/dev/zotero_7_for_developers#updaterdf_updatesjson>.

## Détails

### À propos des hooks

> Voir également [`src/hooks.ts`](https://github.com/windingwind/zotero-plugin-template/blob/main/src/hooks.ts)

1. Lorsque l'installation/activation/démarrage est déclenché par Zotero, `bootstrap.js` > `startup` est appelé
   - Attendez que Zotero soit prêt ;
   - Chargez de `index.js` (l'entrée principale du code de lextension, construit à partir de `index.ts`) ;
   - Enregistrez les ressources si Zotero 7+
2. Dans l'entrée principale `index.js`, l'objet extension est injecté sous `Zotero` et `hooks.ts` > `onStartup` est appelé.
   - Initialisez tout ce que vous voulez, y compris les auditeurs de notifications (hooks), les panneaux de préférences et les éléments de l'interface utilisateur.
3. Lorsque la désinstallation/désactivation est déclenchée depuis Zotero, `bootstrap.js` > `shutdown` est appelé.
   - `events.ts` > `onShutdown` est appelé. Cela supprime les éléments de l'interface utilisateur, les panneaux de préférences, ou tout ce qui a été créé par l'extension'.
   - Supprimez les scripts et libérez les ressources.

### À propos des variables globales

> Voir aussi [`src/index.ts`](https://github.com/windingwind/zotero-plugin-template/blob/main/src/index.ts)

L'extension 'bootstrappé' fonctionne dans un bac à sable, qui n'a pas de variables globales par défaut comme `Zotero` ou `window`, que nous avions l'habitude d'avoir en superposition dans la fenêtre d'environnement des extensions.

Ce modèle enregistre les variables suivantes avec une portée globale :

```plain
Zotero, ZoteroPane, Zotero_Tabs, window, document, rootURI, ztoolkit, addon;
```

### Création d'une API pour les éléments de l'extension

Le modèle d'extension fournit de nouvelles API pour les extensions 'bootstrappées'. Nous avons deux raisons d'utiliser ces APIs, au lieu de `createElement/createElementNS` :

- En mode bootstrap, les extensions doivent nettoyer tous les éléments de l'interface utilisateur à la sortie (désactivation ou désinstallation), ce qui est très ennuyeux. En utilisant `createElement`, le modèle de l'eextensions va maintenir ces éléments. Il suffit de lancer `unregisterAll` à la sortie.
- Zotero 7 requiert createElement()/createElementNS() → createXULElement() pour les éléments XUL restants, alors que Zotero 6 ne supporte pas `createXULElement`. L'API React.createElement-like `createElement` détecte l'espace de noms (xul/html/svg) et crée des éléments automatiquement, avec l'élément de retour dans le type d'élément TS correspondant.

```ts
createElement(document, "div"); // returns HTMLDivElement
createElement(document, "hbox"); // returns XUL.Box
createElement(document, "button", { namespace: "xul" }); // manually set namespace. returns XUL.Button
```

### À propos de l'API Zotero

La documentation de Zotero est obsolète et incomplète. Clonez <https://github.com/zotero/zotero> et recherchez le mot-clé globalement.

> ⭐Le [zotero-types](https://github.com/windingwind/zotero-types) fournit les API de Zotero les plus fréquemment utilisées. Il est inclus dans ce modèle par défaut. Votre IDE devrait fournir des indices pour la plupart des API.

Une astuce pour trouver l'API que vous voulez :

Recherchez le label de l'interface utilisateur dans les fichiers `.xhtml`/`.flt`, trouvez la clé correspondante dans le fichier locale. Ensuite, recherchez cette clé dans les fichiers `.js`/`.jsx`.

### Structure des répertoires

Cette section montre la structure des répertoires d'un modèle.

- Tous les fichiers de code `.js/.ts` sont dans `./src` ;
- Les fichiers de configuration des addons : `./addon/manifest.json` ;
- Fichiers d'interface utilisateur : `./addon/content/*.xhtml`.
- Les fichiers des Locales : `./addon/locale/**/*.flt` ;
- Fichier de préférences : `./addon/prefs.js` ;

```shell
.
|-- .github/                  # github conf
|-- .vscode/                  # vscode conf
|-- addon                     # static files
|   |-- bootstrap.js
|   |-- content
|   |   |-- icons
|   |   |   |-- favicon.png
|   |   |   `-- favicon@0.5x.png
|   |   |-- preferences.xhtml
|   |   `-- zoteroPane.css
|   |-- locale
|   |   |-- en-US
|   |   |   |-- addon.ftl
|   |   |   |-- mainWindow.ftl
|   |   |   `-- preferences.ftl
|   |   `-- zh-CN
|   |       |-- addon.ftl
|   |       |-- mainWindow.ftl
|   |       `-- preferences.ftl
|   |-- manifest.json
|   `-- prefs.js
|-- build                         # build dir
|-- node_modules
|-- src                           # source code of scripts
|   |-- addon.ts                  # base class
|   |-- hooks.ts                  # lifecycle hooks
|   |-- index.ts                  # main entry
|   |-- modules                   # sub modules
|   |   |-- examples.ts
|   |   `-- preferenceScript.ts
|   `-- utils                 # utilities
|       |-- locale.ts
|       |-- prefs.ts
|       |-- wait.ts
|       |-- window.ts
|       `-- ztoolkit.ts
|-- typings                   # ts typings
|   `-- global.d.ts

|-- .env                      # enviroment config (do not check into repo)
|-- .env.example              # template of enviroment config, https://github.com/northword/zotero-plugin-scaffold
|-- .gitignore                # git conf
|-- .gitattributes            # git conf
|-- .prettierrc               # prettier conf, https://prettier.io/
|-- eslint.config.mjs         # eslint conf, https://eslint.org/
|-- LICENSE
|-- package-lock.json
|-- package.json
|-- tsconfig.json             # typescript conf, https://code.visualstudio.com/docs/languages/jsconfig
|-- README.md
`-- zotero-plugin.config.ts   # scaffold conf, https://github.com/northword/zotero-plugin-scaffold
```

## Clause de non-responsabilité

Utilisez ce code sous AGPL. Aucune garantie n'est fournie. Gardez à l'esprit les lois de votre pays !

Si vous souhaitez modifier la licence, veuillez me contacter à l'adresse suivante : <wyzlshx@foxmail.com>
