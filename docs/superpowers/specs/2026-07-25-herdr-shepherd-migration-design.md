# Herdr Shepherd Migration Design

**Date:** 2026-07-25  
**Status:** Approved  
**Source project:** `talberthoule/coordinating-herdr-agents`  
**New project:** `talberthoule/herdr-shepherd`

## Goal

Retire Coordinating Herdr Agents and launch the same product as Herdr Shepherd with a clean plugin identity, a fresh local installation, and a separate public GitHub repository. Preserve the complete Git history and the old local audit log while preventing compatibility aliases or mixed branding.

## Identity

| Surface | New value |
|---|---|
| Product display name | Herdr Shepherd |
| GitHub repository | `talberthoule/herdr-shepherd` |
| Local checkout | `%OneDriveCommercial%\Code\herdr-shepherd` |
| Plugin ID | `herdr-shepherd` |
| Skill ID and directory | `herdr-shepherd` |
| Marketplace namespace | `shepherd` |
| Skill invocation | `$herdr-shepherd` |
| Windows audit state | `%LOCALAPPDATA%\Herdr\shepherd-audit` |
| Linux audit state | `${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/shepherd-audit` |

The external `herdr` executable, its CLI commands, the `herdr.exec` wrapper action, and protocol-level Herdr names remain unchanged. They belong to the upstream platform rather than this plugin.

## Repository Strategy

Create a new public GitHub repository instead of renaming the existing one. Clone the current repository into the adjacent `herdr-shepherd` folder so every tracked file and the complete commit history are preserved without copying local audit data, ignored files, or checkout-specific state.

The old repository remains public and writable until the new repository is fully verified. After the new project passes local checks, GitHub Actions, and a fresh-install check:

1. update the old README and repository description with the retirement and replacement;
2. make the old repository private;
3. archive it so it becomes read-only.

The old repository currently has no issues, pull requests, releases, forks, stars, or watchers to migrate. Its local checkout remains intact as a rollback copy. Deleting that folder is outside this migration.

## Rebrand Scope

Replace the old product identity across every functional reference, including historical files that contain commands or examples, so a repository-wide search does not expose stale installation or invocation instructions. Deliberate source-project and retirement references may keep the old name when they clearly describe history rather than current usage. The rebrand includes:

- Codex and Claude plugin manifests;
- marketplace manifests;
- the skill directory, frontmatter name, agent metadata, and invocation examples;
- hook and runtime paths;
- installer and uninstaller paths, messages, junction names, and state directories;
- README titles, descriptions, clone URLs, install commands, and troubleshooting text;
- repository URLs and GitHub metadata;
- tests, fixtures, temporary-directory prefixes, and assertions;
- project guidance and historical design/plan documents;
- user-visible audit viewer and hook messages where they name the product rather than the upstream platform.

Do not add compatibility shims for `coordinating-herdr-agents`, its old plugin ID, its old skill path, or its old install commands. Git history and the archived repository are the only retained records of the former identity.

## Migration Sequence

1. Confirm the source checkout is clean and synchronized with `origin/main`.
2. Create the empty public `talberthoule/herdr-shepherd` repository.
3. Clone the source repository into the adjacent `herdr-shepherd` folder and point that clone only at the new repository.
4. Create `agent/herdr-shepherd-rebrand` from the copied `main`.
5. Apply the identity and path changes in the new checkout.
6. Run the complete Node test suite and platform-appropriate installer syntax checks.
7. Search tracked files for the old product ID and display name, allowing only explicit history or retirement references, then confirm remaining `Herdr` terms belong to the upstream platform.
8. Push the branch, open a pull request, wait for GitHub Actions, and merge it into the new repository's `main`.
9. Run the old uninstaller without its audit-purge option.
10. Install from the new checkout and verify the new skill links, hooks, invocation name, and an absent or empty `shepherd-audit` state namespace.
11. Confirm the previous durable audit files, `audit.jsonl` and `state.json`, remain byte-for-byte unchanged as an archive. The old uninstaller may remove the ephemeral `viewer.json` lease after stopping its viewer process.
12. Add a retirement pointer to the old repository, push it, then make that repository private and archive it.

## Verification

The migration is complete only when all of these checks pass:

- `node --test --test-concurrency=1 tests/*.test.mjs` passes in the new checkout;
- PowerShell installer scripts parse successfully;
- POSIX installer scripts pass `sh -n` where a POSIX shell is available;
- GitHub Actions passes on Windows and Ubuntu;
- the new public repository's default branch contains the rebrand;
- the new checkout's `origin` points only to `talberthoule/herdr-shepherd`;
- active manifests expose `herdr-shepherd` under marketplace namespace `shepherd`;
- the old installed skill and hooks are removed;
- the new installed skill and hooks resolve to the new checkout and identity;
- the new audit namespace starts clean;
- the old `audit.jsonl` and `state.json` hashes are unchanged;
- the old GitHub repository is private and archived.

## Failure and Rollback

Do not change the old repository's visibility or archive status until every new-project check succeeds. If the code rebrand, CI, or fresh installation fails, fix it in the new repository while the old repository remains the active fallback.

If the new installation fails after the old plugin is uninstalled, reinstall the old plugin from the preserved source checkout. Do not purge or move the old audit directory during rollback.

GitHub repository creation, visibility changes, and archival are explicit user-authorized external mutations. The visibility change is intentionally last because GitHub removes stars and watchers and detaches public forks when a public repository becomes private, while archival makes repository content read-only until unarchived.

## Deliberate Omissions

- No compatibility alias or transitional package.
- No local audit-log migration.
- No deletion of the old checkout.
- No new abstraction, packaging layer, or runtime behavior beyond the identity and state-path changes.
