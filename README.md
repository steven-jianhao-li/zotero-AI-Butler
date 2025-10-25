# Zotero Plugin Template

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

This is a plugin template for [Zotero](https://www.zotero.org/).

[English](README.md) | [简体中文](doc/README-zhCN.md) | [Français](doc/README-frFR.md)

- Documentation for plugins development
  - [📖 Plugin Development Documentation](https://zotero-chinese.com/plugin-dev-guide/) (Chinese, not yet complete)
  - [📖 Plugin Development Documentation for Zotero 7](https://www.zotero.org/support/dev/zotero_7_for_developers)
- Tools for plugins development
  - [🛠️ Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) | [API Documentation](https://github.com/windingwind/zotero-plugin-toolkit/blob/master/docs/zotero-plugin-toolkit.md)
  - [🛠️ Zotero Plugin Scaffold](https://github.com/northword/zotero-plugin-scaffold)
  - [ℹ️ Zotero Type Definitions](https://github.com/windingwind/zotero-types)
  - [📜 Zotero Source Code](https://github.com/zotero/zotero)
  - [📌 Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) (This repo)

> [!tip]
> 👁 Watch this repo so that you can be notified whenever there are fixes & updates.

## Plugins built with this template

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
[![GitHub Repo stars](https://img.shields.io/github/stars/daeh/zotero-citation-tally?label=citation-tally&style=flat-square)](https://github.com/daeh/zotero-citation-tally)

If you are using this repo, I recommended that you put the following badge on your README:

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

```md
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
```

## Features

- Event-driven, functional programming, under extensive skeleton;
- Simple and user-friendly, works out-of-the-box.
- Abundant examples in `src/modules/examples.ts`, covering most of the commonly used APIs in plugins (using [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit));
- TypeScript support:
  - Full type definition support for the whole Zotero project, which is written in JavaScript (using [zotero-types](https://github.com/windingwind/zotero-types));
  - Global variables and environment setup;
- Plugin develop/build/release workflow:
  - ⭐ [New!] Auto hot reload! Whenever the source code is modified, automatically compile and reload. [See here→](#auto-hot-reload)
  - Automatically generate/update plugin id/version, update configrations, and set environment variables (`development` / `production`);
  - Automatically release to GitHub;
- Prettier and ES Lint integration.

## Examples

This repo provides examples for [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) APIs.

Search `@example` in `src/examples.ts`. The examples are called in `src/hooks.ts`.

### Basic Examples

- registerNotifier
- registerPrefs, unregisterPrefs

### Shortcut Keys Examples

- registerShortcuts
- exampleShortcutLargerCallback
- exampleShortcutSmallerCallback
- exampleShortcutConflictionCallback

### UI Examples

![image](https://user-images.githubusercontent.com/33902321/211739774-cc5c2df8-5fd9-42f0-9cdf-0f2e5946d427.png)

- registerStyleSheet(the official make-it-red example)
- registerRightClickMenuItem
- registerRightClickMenuPopup
- registerWindowMenuWithSeprator
- registerExtraColumn
- registerExtraColumnWithCustomCell
- registerCustomItemBoxRow
- registerLibraryTabPanel
- registerReaderTabPanel

### Preference Pane Examples

![image](https://user-images.githubusercontent.com/33902321/211737987-cd7c5c87-9177-4159-b975-dc67690d0490.png)

- Preferences bindings
- UI Events
- Table
- Locale

See [`src/modules/preferenceScript.ts`](./src/modules/preferenceScript.ts)

### HelperExamples

![image](https://user-images.githubusercontent.com/33902321/215119473-e7d0d0ef-6d96-437e-b989-4805ffcde6cf.png)

- dialogExample
- clipboardExample
- filePickerExample
- progressWindowExample
- vtableExample(See Preference Pane Examples)

### PromptExamples

An Obsidian-style prompt(popup command input) module. It accepts text command to run callback, with optional display in the popup.

Activate with `Shift+P`.

![image](https://user-images.githubusercontent.com/33902321/215120009-e7c7ed27-33a0-44fe-b021-06c272481a92.png)

- registerAlertPromptExample

## Quick Start Guide

### 0 Requirement

1. Install a beta version of Zotero: <https://www.zotero.org/support/beta_builds>
2. Install [Node.js latest LTS version](https://nodejs.org/en/) and [Git](https://git-scm.com/)

> [!note]
> This guide assumes that you have an initial understanding of the basic structure and workings of the Zotero plugin. If you don't, please refer to the [documentation](https://www.zotero.org/support/dev/zotero_7_for_developers) and official plugin examples [Make It Red](https://github.com/zotero/make-it-red) first.

### 1 Creat Your Repo

1. Click `Use this template`
2. Git clone your new repo
   <details >
   <summary>💡 Start with GitHub Codespace</summary>

   _GitHub CodeSpace_ enables you getting started without the need to download code/IDE/dependencies locally.

   Replace the steps above and build you first plugin in 30 seconds!
   - Goto top of the [homepage](https://github.com/windingwind/zotero-plugin-template), click the green button `Use this template`, click `Open in codespace`. You may need to login to your GitHub account.
   - Wait for codespace to load.

   </details>

3. Enter the repo folder

### 2 Config Template Settings and Environment

1. Modify the settings in `./package.json`, including:

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

   > [!warning]
   > Be careful to set the addonID and addonRef to avoid conflict.

   If you need to host your XPI packages outside of GitHub, modify `updateURL` and add `xpiDownloadLink` in `zotero-plugin.config.ts`.

2. Copy the environment variable file. Modify the commands that starts your installation of the beta Zotero.

   > Create a development profile (Optional)  
   > Start the beta Zotero with `/path/to/zotero -p`. Create a new profile and use it as your development profile. Do this only once

   ```sh
   cp .env.example .env
   vim .env
   ```

   If you are developing more than one plugin, you can store the bin path and profile path in the system environment variables, which can be omitted here.

3. Install dependencies with `npm install`

   > If you are using `pnpm` as the package manager for your project, you need to add `public-hoist-pattern[]=*@types/bluebird*` to `.npmrc`, see <https://github.com/windingwind/zotero-types?tab=readme-ov-file#usage>.

   If you get `npm ERR! ERESOLVE unable to resolve dependency tree` with `npm install`, which is an upstream dependency bug of typescript-eslint, use the `npm i -f` command to install it.

### 3 Coding

Start development server with `npm start`, it will:

- Prebuild the plugin in development mode
- Start Zotero with plugin loaded from `build/`
- Watch `src/**` and `addon/**`, rebuild and reload plugin in Zotero when source code changed.

#### Auto Hot Reload

Tired of endless restarting? Forget about it!

1. Run `npm start`.
2. Coding. (Yes, that's all)

When file changes are detected in `src` or `addon`, the plugin will be automatically compiled and reloaded.

<details style="text-indent: 2em">
<summary>💡 Steps to add this feature to an existing plugin</summary>

Please see [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold).

</details>

#### Debug in Zotero

You can also:

- Test code snippets in Tools -> Developer -> Run Javascript;
- Debug output with `Zotero.debug()`. Find the outputs in Help->Debug Output Logging->View Output;
- Debug UI. Zotero is built on the Firefox XUL framework. Debug XUL UI with software like [XUL Explorer](https://udn.realityripple.com/docs/Archive/Mozilla/XUL_Explorer).
  > XUL Documentation: <http://www.devdoc.net/web/developer.mozilla.org/en-US/docs/XUL.html>

### 4 Build

Run `npm run build` to build the plugin in production mode. The build output will be located in the `.scaffold/build/` directory.

For detailed build steps, refer to the [zotero-plugin-scaffold documentation](https://northword.github.io/zotero-plugin-scaffold/build.html). In short, the process can be divided into the following steps:

- Create or clear the `build/` directory
- Copy `addon/**` to `.scaffold/build/addon/**`
- Replace placeholders: substitute keywords and configurations defined in `package.json`
- Prepare localization files to avoid conflicts (see the [zotero_7_for_developers](https://www.zotero.org/support/dev/zotero_7_for_developers#avoiding_localization_conflicts) for more information):
  - Rename `**/*.flt` to `**/${addonRef}-*.flt`
  - Prefix each message with `addonRef-`
  - Generate type declaration files for FTL messages
- Prepare preferences files: prefix preference keys with `package.json#prefsPrefix` and generate type declaration files for preferences
- Use ESBuild to compile `.ts` source code to `.js`, building from `src/index.ts` to `.scaffold/build/addon/content/scripts`
- _(Production mode only)_ Compress the `.scaffold/build/addon` directory into `.scaffold/build/*.xpi`
- _(Production mode only)_ Prepare `update.json` or `update-beta.json`

> [!note]
>
> **What's the difference between dev & prod?**
>
> - This environment variable is stored in `Zotero.${addonInstance}.data.env`. The outputs to console is disabled in prod mode.
> - You can decide what users cannot see/use based on this variable.
> - In production mode, the build script will pack the plugin and update the `update.json`.

### 5 Release

To build and release, use

```shell
# version increase, git add, commit and push
# then on ci, npm run build, and release to GitHub
npm run release
```

> [!note]
> This will use [Bumpp](https://github.com/antfu-collective/bumpp) to prompt for the new version number, locally bump the version, run any (pre/post)version scripts defined in `package.json`, commit, build (optional), tag the commit with the version number and push commits and git tags. Bumpp can be configured in `zotero-plugin-config.ts`; for example, add `release: { bumpp: { execute: "npm run build" } }` to also build before committing.
>
> Subsequently GitHub Action will rebuild the plugin and use `zotero-plugin-scaffold`'s `release` script to publish the XPI to GitHub Release. In addition, a separate release (tag: `release`) will be created or updated that includes update manifests `update.json` and `update-beta.json` as assets. These will be available at `https://github.com/{{owner}}/{{repo}}/releases/download/release/update*.json`.

#### About Prerelease

The template defines `prerelease` as the beta version of the plugin, when you select a `prerelease` version in Bumpp (with `-` in the version number). The build script will create a new `update-beta.json` for prerelease use, which ensures that users of the regular version won't be able to update to the beta. Only users who have manually downloaded and installed the beta will be able to update to the next beta automatically.

When the next regular release is updated, both `update.json` and `update-beta.json` will be updated (on the special `release` release, see above) so that both regular and beta users can update to the new regular release.

> [!warning]
> Strictly, distinguishing between Zotero 6 and Zotero 7 compatible plugin versions should be done by configuring `applications.zotero.strict_min_version` in `addons.__addonID__.updates[]` of `update.json` respectively, so that Zotero recognizes it properly, see <https://www.zotero.org/support/dev/zotero_7_for_developers#updaterdf_updatesjson>.

## Details

### About Hooks

> See also [`src/hooks.ts`](https://github.com/windingwind/zotero-plugin-template/blob/main/src/hooks.ts)

1. When install/enable/startup triggered from Zotero, `bootstrap.js` > `startup` is called
   - Wait for Zotero ready
   - Load `index.js` (the main entrance of plugin code, built from `index.ts`)
   - Register resources if Zotero 7+
2. In the main entrance `index.js`, the plugin object is injected under `Zotero` and `hooks.ts` > `onStartup` is called.
   - Initialize anything you want, including notify listeners, preference panes, and UI elements.
3. When uninstall/disabled triggered from Zotero, `bootstrap.js` > `shutdown` is called.
   - `events.ts` > `onShutdown` is called. Remove UI elements, preference panes, or anything created by the plugin.
   - Remove scripts and release resources.

### About Global Variables

> See also [`src/index.ts`](https://github.com/windingwind/zotero-plugin-template/blob/main/src/index.ts)

The bootstrapped plugin runs in a sandbox, which does not have default global variables like `Zotero` or `window`, which we used to have in the overlay plugins' window environment.

This template registers the following variables to the global scope:

```plain
Zotero, ZoteroPane, Zotero_Tabs, window, document, rootURI, ztoolkit, addon;
```

### Create Elements API

The plugin template provides new APIs for bootstrap plugins. We have two reasons to use these APIs, instead of the `createElement/createElementNS`:

- In bootstrap mode, plugins have to clean up all UI elements on exit (disable or uninstall), which is very annoying. Using the `createElement`, the plugin template will maintain these elements. Just `unregisterAll` at the exit.
- Zotero 7 requires createElement()/createElementNS() → createXULElement() for remaining XUL elements, while Zotero 6 doesn't support `createXULElement`. The React.createElement-like API `createElement` detects namespace(xul/html/svg) and creates elements automatically, with the return element in the corresponding TS element type.

```ts
createElement(document, "div"); // returns HTMLDivElement
createElement(document, "hbox"); // returns XUL.Box
createElement(document, "button", { namespace: "xul" }); // manually set namespace. returns XUL.Button
```

### About Zotero API

Zotero docs are outdated and incomplete. Clone <https://github.com/zotero/zotero> and search the keyword globally.

> ⭐The [zotero-types](https://github.com/windingwind/zotero-types) provides most frequently used Zotero APIs. It's included in this template by default. Your IDE would provide hint for most of the APIs.

A trick for finding the API you want:

Search the UI label in `.xhtml`/`.flt` files, find the corresponding key in locale file. Then search this keys in `.js`/`.jsx` files.

### Directory Structure

This section shows the directory structure of a template.

- All `.js/.ts` code files are in `./src`;
- Addon config files: `./addon/manifest.json`;
- UI files: `./addon/content/*.xhtml`.
- Locale files: `./addon/locale/**/*.flt`;
- Preferences file: `./addon/prefs.js`;

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

## Disclaimer

Use this code under AGPL. No warranties are provided. Keep the laws of your locality in mind!

If you want to change the license, please contact me at <wyzlshx@foxmail.com>
