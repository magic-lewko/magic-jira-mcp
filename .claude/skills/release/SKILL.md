---
name: release
description: Ship a new jira-tools version from this repo. It bumps the version in all three files, rebuilds the bundle, runs the checks, commits on develop, promotes to uat and main, syncs GitLab, and writes a short release note. Use when the user wants to release, ship, or cut a new version, or says "release", "ship it", "cut a release", or "/release".
---

Release a new version of the jira-tools plugin. Follow every step in order. Never add Claude as a co-author. Never commit or push without the user's explicit go-ahead.

## Step 1. Decide the version

Confirm what changed since the last release. Pick the new version number with the user. Use a patch bump for fixes and a minor bump for new features. The current version is the `version` in `package.json`.

## Step 2. Bump the version in all three files

The version lives in three places. All three must hold the same value:

- `package.json` (top level `version`)
- `plugins/jira-tools/.claude-plugin/plugin.json` (`version`)
- `plugins/jira-tools/src/version.mjs` (`VERSION`)

## Step 3. Rebuild the bundle

The server is bundled from `src/` into `plugins/jira-tools/servers/jira-mcp.mjs`, so any change in `src/` needs a rebuild. Run:

```text
npm run build
```

Then confirm the new version on the built bundle:

```text
node plugins/jira-tools/servers/jira-mcp.mjs --version
```

## Step 4. Run the checks

All of these must pass before you commit:

```text
npm test
claude plugin validate ./plugins/jira-tools
```

Confirm no company data leaked in. There must be no real Jira URL, company name, real project keys, passwords, or tokens. Use neutral examples only (`https://jira.example.pl`, `PROJ`). The `DC` sandbox names are the only allowed real identifiers.

## Step 5. Get the user's go-ahead

Show the pending diff and the proposed commit message. Wait for the user to approve. Each approval covers one commit only.

## Step 6. Commit on develop

Work on the `develop` branch. The commit message format is `X.Y.Z: short summary`. Never add a `Co-Authored-By: Claude` trailer.

```text
git add -A
git commit -m "X.Y.Z: short summary"
```

## Step 7. Push GitHub and promote

GitHub (`origin`) is the primary remote. Push develop, then fast-forward `uat` and `main`, then return to develop:

```text
git push origin develop
git checkout uat && git merge --ff-only develop && git push origin uat
git checkout main && git merge --ff-only develop && git push origin main
git checkout develop
```

## Step 8. Sync GitLab

GitLab (`gitlab`) is the secondary remote. Its `main` is protected and has a separate history, so sync through a temporary branch. This stays a fast-forward, not a force push:

```text
git fetch gitlab
git checkout -B gitlab-sync gitlab/main
git merge develop -m "Merge X.Y.Z into gitlab-sync"
git push gitlab gitlab-sync:main
git checkout develop
git branch -D gitlab-sync
```

## Step 9. Write a short release note

Write a short summary of what changed. Keep it to a few bullets in plain language, no em-dashes. This note is for the team, so Polish is fine.
