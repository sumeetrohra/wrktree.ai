import { describe, expect, it } from "vitest";

import {
  archiveName,
  debControl,
  homebrewFormula,
  releaseUrl,
  rpmSpec,
  wingetManifests,
} from "./installers.utils.js";

describe("installer manifests", () => {
  it("name each platform's archive and where the release keeps it", () => {
    expect(archiveName("1.2.0", "darwin", "arm64")).toBe("agentdeck-1.2.0-darwin-arm64.tar.gz");
    expect(archiveName("1.2.0", "win32", "x64")).toBe("agentdeck-1.2.0-win32-x64.zip");
    expect(releaseUrl("1.2.0", "a.zip")).toBe(
      "https://github.com/sumeetrohra/wrktree.ai/releases/download/v1.2.0/a.zip",
    );
  });

  it("Homebrew: both Mac CPUs with their checksums, a service, a test", () => {
    const rb = homebrewFormula("1.2.0", { arm64: "a".repeat(64), x64: "b".repeat(64) });
    expect(rb).toContain(
      `url "${releaseUrl("1.2.0", "agentdeck-1.2.0-darwin-arm64.tar.gz")}"\n    sha256 "${"a".repeat(64)}"`,
    );
    expect(rb).toContain(`sha256 "${"b".repeat(64)}"`);
    expect(rb).toContain('run [opt_bin/"agentdeck", "daemon"]');
    expect(rb).toContain('shell_output("#{bin}/agentdeck --version")');
    expect(homebrewFormula("1.2.0", { arm64: "a".repeat(64), x64: null })).not.toContain("on_intel");
  });

  it("winget: a portable exe in a zip, checksum upper-case", () => {
    const m = wingetManifests("1.2.0", "c".repeat(64));
    expect(Object.keys(m)).toEqual([
      "Agentdeck.Agentdeck.yaml",
      "Agentdeck.Agentdeck.installer.yaml",
      "Agentdeck.Agentdeck.locale.en-US.yaml",
    ]);
    const installer = m["Agentdeck.Agentdeck.installer.yaml"] ?? "";
    expect(installer).toContain("NestedInstallerType: portable");
    expect(installer).toContain(`InstallerSha256: ${"C".repeat(64)}`);
  });

  it("Debian and RPM", () => {
    expect(debControl("1.2.0", "amd64")).toMatch(
      /^Package: agentdeck\nVersion: 1.2.0\nArchitecture: amd64\n/,
    );
    expect(rpmSpec("1.2.0", "/tmp/agentdeck")).toContain(
      "install -m 0755 /tmp/agentdeck %{buildroot}%{_bindir}/agentdeck",
    );
  });
});
