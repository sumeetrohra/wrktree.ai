import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { archiveName, debControl, homebrewFormula, rpmSpec, wingetManifests } from "./installers.utils.js";

const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Whether a program runs here (`dpkg-deb`, `rpmbuild`). */
function has(program: string): boolean {
  try {
    execFileSync(program, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Packs this platform's single-file build next to it, named as the installers expect. */
export function archiveSea(bin: string, version: string, dir: string): string {
  const name = archiveName(version, process.platform, process.arch);
  const file = basename(bin);
  rmSync(join(dir, name), { force: true });
  // bsdtar (Windows' tar.exe) writes a zip when the name ends in .zip; relative names keep "C:" out.
  execFileSync("tar", process.platform === "win32" ? ["-a", "-cf", name, file] : ["-czf", name, file], {
    cwd: dir,
  });
  return join(dir, name);
}

/**
 * From the release's archives (`archives`, as the binaries workflow collects them): a Homebrew
 * formula, winget manifests, and a .deb and .rpm where `dpkg-deb` and `rpmbuild` exist. Writes them
 * to `out`; publishing them (tap, winget-pkgs, the release) is the maintainer's.
 */
export function buildInstallers(version: string, archives: string, out: string): string[] {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const at = (platform: string, arch: string): string | null => {
    const p = join(archives, archiveName(version, platform, arch));
    return existsSync(p) ? p : null;
  };
  const made: string[] = [];
  const macArm = at("darwin", "arm64");
  const macX64 = at("darwin", "x64");
  if (macArm) {
    writeFileSync(
      join(out, "agentdeck.rb"),
      homebrewFormula(version, { arm64: sha256(macArm), x64: macX64 === null ? null : sha256(macX64) }),
    );
    made.push("agentdeck.rb");
  }
  const win = at("win32", "x64");
  if (win) {
    const dir = join(out, "winget");
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(wingetManifests(version, sha256(win)))) {
      writeFileSync(join(dir, name), text);
      made.push(`winget/${name}`);
    }
  }
  const linux = at("linux", "x64");
  if (linux && process.platform === "linux") {
    const root = join(out, "deb");
    mkdirSync(join(root, "DEBIAN"), { recursive: true });
    mkdirSync(join(root, "usr", "bin"), { recursive: true });
    execFileSync("tar", ["-xzf", linux, "-C", join(root, "usr", "bin")]);
    chmodSync(join(root, "usr", "bin", "agentdeck"), 0o755);
    writeFileSync(join(root, "DEBIAN", "control"), debControl(version, "amd64"));
    if (has("dpkg-deb")) {
      const deb = `agentdeck_${version}_amd64.deb`;
      execFileSync("dpkg-deb", ["--build", "--root-owner-group", root, join(out, deb)], { stdio: "inherit" });
      made.push(deb);
    }
    if (has("rpmbuild")) {
      const top = join(out, "rpmbuild");
      writeFileSync(join(out, "agentdeck.spec"), rpmSpec(version, join(root, "usr", "bin", "agentdeck")));
      execFileSync("rpmbuild", ["-bb", "--define", `_topdir ${top}`, join(out, "agentdeck.spec")], {
        stdio: "inherit",
      });
      made.push(`rpmbuild/RPMS/x86_64/agentdeck-${version}-1.x86_64.rpm`);
    }
    rmSync(root, { recursive: true, force: true });
  }
  return made;
}
