// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default [
  ...zotero({
    overrides: [
      {
        files: ["**/*.ts"],
        rules: {
          // We disable this rule here because the template
          // contains some unused examples and variables
          "@typescript-eslint/no-unused-vars": "off",
        },
      },
    ],
  }),
  // Disable linting for third-party bundled libraries and build scripts
  {
    files: [
      "addon/lib/**/*.js",
      "addon/content/**/*.js",
      "scripts/**/*.mjs",
      "scripts/**/*.ts",
    ],
    rules: {
      // Disable all rules for these files
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": "off",
      "no-control-regex": "off",
      "no-prototype-builtins": "off",
      "no-fallthrough": "off",
      "no-constant-condition": "off",
      "no-useless-escape": "off",
      "no-cond-assign": "off",
      "no-unreachable": "off",
    },
  },
];
