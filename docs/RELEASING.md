# Manual releases

1. Push the code you want to release to `main`.
2. Open **Actions → Release Windows → Run workflow**.
3. Select **main** and click **Run workflow**. Other branches are skipped.
4. After the build and publish jobs succeed, download the installer ZIP from **Releases**, extract it, and run the `.exe` inside.

The workflow runs only when manually dispatched. It does not run on ordinary pushes or pull requests. No personal access token or OpenRouter key needs to be added: publishing uses the job's built-in `GITHUB_TOKEN` with `contents: write`. Repository or organization policies must allow GitHub Actions and that permission.

## Version and output

The version comes from `package.json`. It must match `package-lock.json` (both root version entries), `src-tauri/Cargo.toml`, the application's entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Use a stable `MAJOR.MINOR.PATCH` version, for example `0.7.0`.

The pipeline creates tag `v0.7.0` and release **Voice Prompt v0.7.0**, targeting the exact commit selected when the workflow started. It uploads:

- `Voice Prompt_0.7.0_x64-setup.zip`: contains `Voice Prompt_0.7.0_x64-setup.exe`, the Windows x64 NSIS installer including the verified Whisper runtime, `small`, and `large-v3-turbo-q5_0` models and speech license files. The executable is not uploaded separately.
- `SHA256SUMS.txt`: SHA-256 checksum of the ZIP, verified again by the publication job.

The installer is unsigned, like the existing local build. The release is first created as a draft, then published only after both assets have uploaded. Successful releases are marked Latest. The build artifact is retained in Actions for seven days.

## Preparing the next release

Update the app version in all manifests and lockfiles, commit, and push before running the workflow again. For the npm manifest and lockfile, `npm version 0.8.0 --no-git-tag-version` updates both without creating a tag. Update the Cargo package and Tauri versions to match, then run `cargo check --manifest-path src-tauri/Cargo.toml` in a prepared development checkout to refresh the Cargo lockfile's application entry. Inspect the diff to avoid unrelated dependency updates.

Existing tags and releases are not overwritten. Running the same version again fails; it does not bump versions automatically. Runs are serialized to avoid concurrent publication.

## Build and failure behavior

The Windows build job has read-only repository permissions. It installs locked npm dependencies, runs the frontend tests, builds the frontend, downloads the SHA256-verified speech runtime and both models, runs Rust tests with `--locked`, and packages the installer. Live API tests remain ignored. The separate publication job has release write permission and only downloads the resulting artifacts; it does not run application build scripts.

A clean hosted runner must download roughly 1 GB of speech models and compile Rust dependencies, so the first run can take considerably longer than an incremental local build. Failed downloads or checksum validation stop the workflow. The build timeout is 90 minutes; publication has 20 minutes.

If upload or publication fails after a draft has been created, inspect the draft and logs. Either finish uploading and publish that same draft after verifying its assets, or remove only the failed draft and any corresponding unpublished tag before retrying. Do not delete or rewrite an already published release to recover a failed run.

The workflow syntax, version-validation step, and ZIP packaging and integrity were checked locally. A full hosted build and publication are verified only after you run the workflow.

References: [Tauri GitHub build guidance](https://v2.tauri.app/distribute/pipelines/github/), [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create), [publishing a draft](https://cli.github.com/manual/gh_release_edit).
