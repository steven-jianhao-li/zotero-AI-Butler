# Issue #272 i18n Manual QA Checklist

This checklist records the remaining manual evidence needed after the automated i18n gates pass. It is an internal QA aid for the i18n migration and is not user-facing documentation.

## Before manual QA

Run and record the result of:

```powershell
npm run i18n:check
npm run build
npm run i18n:check:build
npm run lint:check
npm run test:i18n
git diff --check
npm test
```

Expected baseline:

- All commands pass.
- Full Zotero test run reports all tests passed.
- No replacement-character scan hits are present in source, locale, scripts, tests, or bundled static pages.

## Automated baseline evidence

Last CLI verification in this worktree: 2026-07-16 20:50-20:53 Asia/Shanghai.

- `npm run i18n:check`: passed.
- `npm run build`: passed, including `prebuild` i18n check and `postbuild` built-locale check.
- `npm run i18n:check:build`: passed.
- `npm run lint:check`: passed.
- `npm run test:i18n`: passed.
- `git diff --check`: passed.
- `npm test`: passed, `198 passed`.
- Replacement-character scan: passed, no `U+FFFD` hits.

This is automated evidence only. It does not replace the zh-CN/en-US manual Zotero UI pass below.

## Locale setup

Verify both Zotero UI locales. Do not use plugin-level language switching; the plugin should follow Zotero's current UI locale.

| Locale | Zotero UI language | Expected plugin language |
| ------ | ------------------ | ------------------------ |
| zh-CN  | Chinese            | Chinese UI text          |
| en-US  | English            | English UI text          |

For every path below, record evidence as either a screenshot, short screen recording, or copied visible text. Evidence should show there are no raw Fluent keys such as `task-queue-title`, no `aiButler-*` raw ids, and no unexpected Chinese text in the English run.

## Main entry points

Check in both zh-CN and en-US:

- [ ] Library toolbar AI Butler button is visible and localized.
- [ ] Reader toolbar AI chat button is visible and localized.
- [ ] Item context menu entries are localized.
- [ ] Optional collapsed "AI Butler" submenu is localized when enabled.
- [ ] Disabled/hidden context-menu entries do not leave stale untranslated separators or labels.

Evidence notes:

- zh-CN:
- en-US:

## Main window tabs

Open the AI Butler main window and check in both zh-CN and en-US:

- [ ] Window title is localized.
- [ ] Top navigation labels are localized: dashboard, summary, task queue, literature review, settings.
- [ ] Dashboard status cards and empty states are localized.
- [ ] Summary tab initial state, loading state, stop button, saved-summary state, and error state are localized.
- [ ] Task queue title, filters, search placeholder, clear-completed button, empty state, status badges, and action buttons are localized.
- [ ] Literature review page title, selected-count text, buttons, and empty/error states are localized.
- [ ] No visible raw key appears after switching tabs multiple times.

Evidence notes:

- zh-CN:
- en-US:

## Settings pages

Open Settings and check every settings category in both zh-CN and en-US:

- [ ] Model Platforms: titles, endpoint cards, routing labels, PDF-mode labels, test connection buttons/results, add/delete/details buttons.
- [ ] API Configuration: provider form labels, placeholders, model list, key test status, failure messages.
- [ ] AI Summary Prompt: title, buttons, prompt variable notice, reset/import/export flows.
- [ ] AI Deep Reading Prompt: template list, phase labels, variable notice, validation messages.
- [ ] Table Summary Prompt: labels, buttons, validation messages.
- [ ] Mind Map: labels, help text, toggle/options.
- [ ] One-image Summary: provider labels, preset confirmation dialog, connection test results, error messages.
- [ ] Auto Note Export: watched collection list, folder picker, format labels, conflict strategy, save status.
- [ ] Interface Settings: context-menu customization labels, ordering buttons, visibility toggles.
- [ ] Data Management: clear/reset confirmations, empty-note cleanup dialog, progress/result messages.
- [ ] About: tutorial button, feature list, project info labels.

Evidence notes:

- zh-CN:
- en-US:

## Item pane sidebar

Select a regular paper item with a PDF and check in both zh-CN and en-US:

- [ ] AI Butler item-pane section header and sidenav label are localized.
- [ ] Full Chat and Quick Chat buttons/tooltips are localized.
- [ ] Quick Chat placeholder, send/stop buttons, loading state, answer actions, copy/save status, and error state are localized.
- [ ] Table Summary, One-image Summary, and Mind Map sections are localized, including empty states and regenerate/generate buttons.
- [ ] Non-paper item or no-selection state is localized.

Evidence notes:

- zh-CN:
- en-US:

## Dialogs, confirmations, and progress windows

Exercise the common dialogs in both zh-CN and en-US:

- [ ] No item selected: summary/deep-read/table/image/mindmap commands show localized errors.
- [ ] No PDF attachment: localized error/progress text.
- [ ] Missing or unusable endpoint/API key: localized error text.
- [ ] Collection clean/delete/regenerate confirmation dialog is localized.
- [ ] Collection export dialog is localized.
- [ ] Setup wizard confirmation dialog is localized.
- [ ] Image preset apply confirmation dialog is localized.
- [ ] Task progress windows and completion/failure toasts are localized.
- [ ] Copy-to-clipboard success/failure messages are localized.

Evidence notes:

- zh-CN:
- en-US:

## Generated Zotero notes and exported files

Generate or inspect representative artifacts in both zh-CN and en-US:

- [ ] AI Summary note structural headings/metadata labels are localized.
- [ ] AI Deep Reading note structural headings/metadata labels are localized.
- [ ] Multi-model summary headings and failed-provider section are localized.
- [ ] Follow-up chat note title and speaker labels are localized.
- [ ] One-image summary note title, alt text, and description labels are localized.
- [ ] Auto-export DOCX/Markdown headings and warnings are localized.
- [ ] Brand names, provider names, model names, API names, and tags remain unchanged, e.g. `AI Butler`, `OpenAI`, `Gemini`, `AI-Generated`.

Evidence notes:

- zh-CN:
- en-US:

## Static HTML/XHTML pages

Open bundled static pages through normal plugin flows in both zh-CN and en-US:

- [ ] Preferences pane button/description is localized.
- [ ] Mind map generation page static labels, export buttons, iframe title, and OPML title are localized.
- [ ] Mind map viewer static labels and export/status messages are localized.
- [ ] Image summary viewer labels, image alt text, and error/status messages are localized.

Evidence notes:

- zh-CN:
- en-US:

## Failure criteria

Treat the QA run as failed if any of these appear:

- Raw Fluent key, e.g. `settings-about-title`.
- Raw scaffold-prefixed id, e.g. `aiButler-settings-about-title`.
- Unexpected Chinese text in the en-US run, excluding user content, paper titles, prompts, tags, provider/model/API names, and imported note contents.
- Mojibake or replacement characters, e.g. `\uFFFD`, `\u9983`, `\u9241`, `\u00C3`, `\u00E2\u20AC\u00A6`.
- Empty button/tooltip/placeholder where a localized label is expected.
- English-only UI in the zh-CN run for plugin-owned text, excluding brand/provider/model/API names.
- Layout overflow that makes localized text unreadable in normal window sizes.

## Final sign-off

- QA date:
- Zotero version:
- Plugin build/version:
- zh-CN evidence location:
- en-US evidence location:
- Known acceptable exceptions:
- Reviewer:
