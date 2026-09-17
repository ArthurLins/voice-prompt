# Releases from version tags

Pushing a stable version tag such as `v1.0.0` starts **Release Windows and macOS**. Ordinary branch pushes and pull requests do not publish releases.

## Publish 1.0.0

After the version changes and workflow are committed on main:

```sh
git switch main
git pull --ff-only
git tag -a v1.0.0 -m "Voice Prompt 1.0.0"
git push origin v1.0.0
```

Do not create or push the tag until the intended release commit is ready. The pipeline builds that exact tagged commit. It verifies that the tag matches `package.json`, both root versions in `package-lock.json`, `src-tauri/Cargo.toml`, the application's entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Mismatches fail before either native build starts. Only stable `vMAJOR.MINOR.PATCH` tags are accepted.

## Release assets

Once both native builds and tests succeed, the workflow publishes **Voice Prompt v1.0.0** with:

- `Voice Prompt_1.0.0_x64-setup.exe`: Windows x64 NSIS installer, including the CPU speech runtime and Vulkan acceleration.
- `Voice Prompt_1.0.0_aarch64.dmg`: macOS 13+ Apple Silicon installer, including Metal acceleration and CPU fallback. Intel Macs are not targeted.
- `SHA256SUMS.txt`: SHA-256 checksums of both installers, verified again before publication.

Models are downloaded and verified inside the application on first use; no provider keys or personal data are packaged. Windows is unsigned. The Mac app is ad-hoc signed and not notarized; see [MACOS.md](MACOS.md) for installation and signing requirements.

The native build jobs run in parallel with read-only repository permissions. Windows runs frontend/Rust tests and builds the verified CPU/Vulkan runtime. Mac reuses `build-macos.yml`, including frontend/Rust tests, real CPU transcription, ARM64 and code-signature checks, and an application launch check. Builds time out after 90 minutes on Windows and 60 minutes on Mac.

Only the separate publication job has `contents: write`. It downloads artifacts from the current run, verifies both checksums, and creates a draft release for the existing tag using `--verify-tag`. It publishes and marks the release Latest only after all assets upload successfully. If either build fails, no release is published. Actions artifacts are retained for 14 days.

## Next release and recovery

Update all version files, commit, and push a new matching tag. For example, `npm version 1.0.1 --no-git-tag-version` updates the npm files; update Cargo and Tauri as well. Run:

```sh
node --test scripts/release-version.test.mjs
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

Re-run a failed Actions run after fixing transient infrastructure issues. Alternatively, manually dispatch the release workflow against an existing tag:

```sh
gh workflow run release.yml --ref v1.0.0
```

Manual dispatch against a branch is rejected. Existing releases and assets are not overwritten. If publication failed after creating a draft, inspect the draft and complete it after verifying its assets, or remove only that unpublished draft before retrying. Preserve the original tag. If source code must change, create a new version and tag instead of moving a published tag.

The workflow uses the built-in `GITHUB_TOKEN`; no personal access token or API provider credentials are required. Repository policies must allow GitHub Actions and release write permission.

References: [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create), [Tauri distribution](https://v2.tauri.app/distribute/).
