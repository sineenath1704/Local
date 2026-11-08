// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Build output — never lint compiled files (they're CommonJS output with
    // `var`, `__dirname`, etc. that the app rules don't expect).
    ignores: ["**/dist/**", ".expo/**"],
  },
  {
    settings: {
      // These packages re-export everything with `export *`, and the only
      // active resolver is the node one (eslint-config-expo's last settings
      // block drops the typescript resolver), so eslint-plugin-import resolves
      // their ESM build and can't follow `export *` → false "not found" errors
      // in every file that imports them. TypeScript resolves these fine.
      //
      // NOTE: this key REPLACES the whole list eslint-config-expo ships, so the
      // first pattern (its own) has to be kept here.
      "import/ignore": [
        "node_modules[\\\\/]+@?react-native",
        "react-native-safe-area-context",
        "expo-file-system/legacy",
        "expo-image-picker",
        "expo-auth-session",
      ],
    },
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
