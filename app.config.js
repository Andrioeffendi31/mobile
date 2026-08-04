const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * Everything static lives in app.json; this file exists for one decision that
 * cannot be expressed there.
 *
 * `android.googleServicesFile` must point at a real file or prebuild aborts — so
 * declaring it unconditionally makes every build fail until somebody downloads
 * the Firebase config. Attaching it only when the file is present means the app
 * builds and runs today, with push announcing itself as unconfigured (the status
 * card in the Info tab), and starts delivering notifications the moment
 * `google-services.json` is dropped in. No app.json edit, no second code path.
 *
 * Plain JS, like babel.config.js next to it: Expo's tsconfig resolves modules
 * with the `react-native` condition, under which the Node built-ins this needs
 * do not type-resolve. A .ts version would only add a tsconfig fight.
 */
const GOOGLE_SERVICES = "google-services.json";

module.exports = ({ config }) => {
  const present = existsSync(resolve(__dirname, GOOGLE_SERVICES));

  return {
    ...config,
    android: {
      ...config.android,
      ...(present ? { googleServicesFile: `./${GOOGLE_SERVICES}` } : {}),
    },
  };
};
