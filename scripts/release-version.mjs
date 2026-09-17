import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateReleaseVersion(files, tag) {
  const version = JSON.parse(files.package).version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Use a stable MAJOR.MINOR.PATCH version.");
  }
  if (tag !== `v${version}`)
    throw new Error(`Tag must be v${version}; received ${tag}.`);
  const lock = JSON.parse(files.lock);
  const versions = [
    lock.version,
    lock.packages?.[""]?.version,
    JSON.parse(files.tauri).version,
    files.cargo.match(/\[package\][\s\S]*?^version = "([^"]+)"/m)?.[1],
    files.cargoLock.match(
      /^name = "voice-prompt"\r?\nversion = "([^"]+)"/m,
    )?.[1],
  ];
  if (versions.some((candidate) => candidate !== version)) {
    throw new Error(
      "Version mismatch between npm, Cargo, lockfiles, and Tauri.",
    );
  }
  return version;
}

export function readVersionFiles() {
  return Object.fromEntries(
    Object.entries({
      package: "package.json",
      lock: "package-lock.json",
      tauri: "src-tauri/tauri.conf.json",
      cargo: "src-tauri/Cargo.toml",
      cargoLock: "src-tauri/Cargo.lock",
    }).map(([key, path]) => [key, readFileSync(path, "utf8")]),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.env.GITHUB_REF_TYPE !== "tag")
    throw new Error("Releases must run on a tag, not a branch.");
  const version = validateReleaseVersion(
    readVersionFiles(),
    process.env.GITHUB_REF_NAME,
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Validated release v${version}`);
}
