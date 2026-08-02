# Claude Guidance

The coordination doctrine for this repository lives in one place: [skills/herdr-shepherd/SKILL.md](skills/herdr-shepherd/SKILL.md). Read it there.

This file used to mirror six of its sections verbatim, which meant every doctrine edit had to land in three files and a test suite existed to catch the drift when it did not. The skill ships `SKILL.md` and its scripts — never this file — so the copies bought nothing a link does not, and cost a synchronization step on every change.

Repository-specific facts that are not part of the skill:

- **Durable record binding** — see `.herdr-shepherd.json` at the repo root, which is the canonical, runtime-neutral record of the tracker, its container, and the ID format. Do not restate it here; a second copy is the thing this file exists to stop.
- **Gates** — `node --test --test-concurrency=1 tests/*.test.mjs`, run on Windows and Ubuntu in CI.

When editing the skill, edit `SKILL.md` alone.
