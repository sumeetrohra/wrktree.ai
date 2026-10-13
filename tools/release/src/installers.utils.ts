/** Where the release workflow uploads the single-file builds (a GitHub release per tag). */
export const releaseUrl = (version: string, file: string): string =>
  `https://github.com/sumeetrohra/wrktree.ai/releases/download/v${version}/${file}`;

/** The archive each platform's build ships in. */
export function archiveName(version: string, platform: string, arch: string): string {
  return `agentdeck-${version}-${platform}-${arch}.${platform === "win32" ? "zip" : "tar.gz"}`;
}

const DESCRIPTION = "Drive coding agents (Claude Code, Codex, Gemini) on your computers from your phone";

/** A Homebrew formula for the macOS builds (Apple silicon, and Intel when there is one), for a tap. */
export function homebrewFormula(version: string, sha: { arm64: string; x64: string | null }): string {
  const intel =
    sha.x64 === null
      ? ""
      : `
  on_intel do
    url "${releaseUrl(version, archiveName(version, "darwin", "x64"))}"
    sha256 "${sha.x64}"
  end`;
  return `class Agentdeck < Formula
  desc "${DESCRIPTION}"
  homepage "https://github.com/sumeetrohra/wrktree.ai"
  version "${version}"
  license "MIT"

  on_arm do
    url "${releaseUrl(version, archiveName(version, "darwin", "arm64"))}"
    sha256 "${sha.arm64}"
  end${intel}

  def install
    bin.install "agentdeck"
  end

  service do
    run [opt_bin/"agentdeck", "daemon"]
    keep_alive successful_exit: false
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/agentdeck --version")
  end
end
`;
}

/** winget's three manifests for the Windows build: a zip holding a portable `agentdeck.exe`. */
export function wingetManifests(version: string, sha256: string): Record<string, string> {
  const id = "Agentdeck.Agentdeck";
  const head = `PackageIdentifier: ${id}\nPackageVersion: ${version}\n`;
  return {
    [`${id}.yaml`]: `${head}DefaultLocale: en-US\nManifestType: version\nManifestVersion: 1.6.0\n`,
    [`${id}.installer.yaml`]: `${head}InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
  - RelativeFilePath: agentdeck.exe
    PortableCommandAlias: agentdeck
Installers:
  - Architecture: x64
    InstallerUrl: ${releaseUrl(version, archiveName(version, "win32", "x64"))}
    InstallerSha256: ${sha256.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.6.0
`,
    [`${id}.locale.en-US.yaml`]: `${head}PackageLocale: en-US
Publisher: Agentdeck
PackageName: Agentdeck
License: MIT
ShortDescription: ${DESCRIPTION}
PackageUrl: https://github.com/sumeetrohra/wrktree.ai
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`,
  };
}

/** Debian's control file for the Linux build (`dpkg-deb --build`). */
export function debControl(version: string, arch: "amd64" | "arm64"): string {
  return `Package: agentdeck
Version: ${version}
Architecture: ${arch}
Maintainer: Agentdeck <security@agentdeck.dev>
Section: devel
Priority: optional
Homepage: https://github.com/sumeetrohra/wrktree.ai
Recommends: git
Suggests: gh, ffmpeg
Description: ${DESCRIPTION}
 The agentdeck CLI and daemon in one file. Run \`agentdeck login\`, then \`agentdeck install\`.
`;
}

/** An RPM spec that packages an already-built binary (`rpmbuild -bb`). */
export function rpmSpec(version: string, binary: string): string {
  return `Name: agentdeck
Version: ${version}
Release: 1
Summary: ${DESCRIPTION}
License: MIT
URL: https://github.com/sumeetrohra/wrktree.ai
Recommends: git
%global debug_package %{nil}
%global __strip /bin/true

%description
The agentdeck CLI and daemon in one file. Run agentdeck login, then agentdeck install.

%install
mkdir -p %{buildroot}%{_bindir}
install -m 0755 ${binary} %{buildroot}%{_bindir}/agentdeck

%files
%{_bindir}/agentdeck
`;
}
