# Agent Instructions

## Chief of Staff lifecycle reporting

Every coding agent working in this repository must keep Chief of Staff current for meaningful work. Use one stable task title for the life of a task and report these state changes whenever the Chief of Staff integration is available:

1. **started** before substantive implementation begins.
2. **progress** after a material milestone such as a commit, migration, passing test suite, pull request update, or deployment start.
3. **blocked** immediately when a technical or external dependency prevents progress.
4. **waiting_user** immediately when Phil must approve, answer, upload, authenticate, or choose something.
5. **completed_verified** only when concrete evidence exists, such as a merged pull request, passing test, applied migration, successful deployment, or generated artifact.
6. **failed** when the requested result was not achieved and the run is ending.

If `CHIEF_OF_STAFF_URL` and `APP_INGEST_TOKEN` are available in the runtime, send structured events to `POST /api/v1/agent-events`. Never print, log, or commit either credential. A completion claim without qualifying evidence must remain unverified.
