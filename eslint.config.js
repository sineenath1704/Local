// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // The backend is plain Node, not the Expo client. `expo/no-dynamic-env-var`
    // targets client code, where `process.env.FOO` is inlined at build time by
    // Babel — in Node, `process.env[name]` resolves normally at runtime.
    files: ["backend/**"],
    rules: {
      "expo/no-dynamic-env-var": "off",
    },
  }
]);
