// Android blocks plain http:// by default. The sealed preview (Phase 5e) loads its page from a
// server inside the app on 127.0.0.1, so this allows cleartext to that address only.
const fs = require("node:fs");
const path = require("node:path");

const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withLocalhostCleartext = (config) => {
  config = withDangerousMod(config, [
    "android",
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "network_security_config.xml"), XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return c;
  });
};

module.exports = withLocalhostCleartext;
