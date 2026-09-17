import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  readVersionFiles,
  validateReleaseVersion,
} from "./release-version.mjs";

const files = readVersionFiles();
const version = JSON.parse(files.package).version;
test("CLI rejects a branch even when its name matches the version tag", () => {
  const result = spawnSync(process.execPath, ["scripts/release-version.mjs"], {
    env: {
      ...process.env,
      GITHUB_REF_TYPE: "branch",
      GITHUB_REF_NAME: `v${version}`,
    },
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must run on a tag/);
});
test("release tag matches every project manifest", () => {
  assert.equal(validateReleaseVersion(files, `v${version}`), version);
});
test("rejects branches, mismatched tags and malformed versions", () => {
  for (const tag of ["main", version, "v9.9.9", `v${version}-beta.1`]) {
    assert.throws(() => validateReleaseVersion(files, tag), /Tag must/);
  }
  for (const invalid of ["01.0.0", "1.0", "1.0.0-beta.1"]) {
    assert.throws(
      () =>
        validateReleaseVersion(
          { ...files, package: JSON.stringify({ version: invalid }) },
          `v${invalid}`,
        ),
      /stable/,
    );
  }
});
test("rejects a mismatched version in each manifest and lockfile", () => {
  for (const key of ["tauri", "cargo", "lock"]) {
    const modified = files[key].replace(`"${version}"`, '"9.9.9"');
    assert.throws(
      () =>
        validateReleaseVersion({ ...files, [key]: modified }, `v${version}`),
      /mismatch/,
    );
  }
  const cargoLock = files.cargoLock.replace(
    /(name = "voice-prompt"\r?\nversion = ")[^"]+/,
    (_, prefix) => `${prefix}9.9.9`,
  );
  assert.throws(
    () => validateReleaseVersion({ ...files, cargoLock }, `v${version}`),
    /mismatch/,
  );
  const lock = JSON.parse(files.lock);
  lock.packages[""].version = "9.9.9";
  assert.throws(
    () =>
      validateReleaseVersion(
        { ...files, lock: JSON.stringify(lock) },
        `v${version}`,
      ),
    /mismatch/,
  );
});
