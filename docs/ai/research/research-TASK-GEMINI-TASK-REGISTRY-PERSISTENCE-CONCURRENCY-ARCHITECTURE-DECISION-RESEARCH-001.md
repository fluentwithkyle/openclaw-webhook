# Research Record — TASK-GEMINI-TASK-REGISTRY-PERSISTENCE-CONCURRENCY-ARCHITECTURE-DECISION-RESEARCH-001

## Task Identity

- **task_name**: TASK-GEMINI-TASK-REGISTRY-PERSISTENCE-CONCURRENCY-ARCHITECTURE-DECISION-RESEARCH-001
- **agent**: Gemini
- **date**: 2026-10-02
- **task_mode**: RESEARCH_DOCUMENT
- **repository**: fluentwithkyle/openclaw-webhook
- **base_branch**: main
- **current_head**: 25856a042dfa8f05a1d329e7eb29ffcf35ea1072
- **status**: BLOCKED for implementation — persistence/concurrency decision unresolved

## Executive Conclusion

The TaskRegistry currently uses a JSON file with a process-local `Map` cache and atomic file replacement (`fs.renameSync`). This provides per-file atomic replacement only; it does NOT provide cross-process compare-and-set semantics. No inter-process locking, database transaction, or version-check mechanism exists anywhere in the repository.

**The single authoritative persistence/concurrency mechanism for TaskRegistry mutations remains UNRESOLVED.** No mechanism was found that can safely serialize TaskRegistry create/recover/claim mutations across the actual (unknown) Render process/instance topology.

Until a mechanism is resolved and authorized, the external-activation execution-claim implementation remains BLOCKED. No new persistence dependency should be introduced silently.

## Repository Truth

### VERIFIED

Current `main` resolves to `25856a042dfa8f05a1d329e7eb29ffcf35ea1072`.

**TaskRegistry persistence — `poc/task-registry.js`:**
- `REGISTRY_FILE = path.join(__dirname, 'task-registry.json')` (line 25)
- process-local `memoryCache = new Map()` (line 28)
- `loadFromFile()` uses `fs.readFileSync()` (line 41)
- `atomicWrite()` uses `fs.writeFileSync(BACKUP_FILE, …)` + `fs.renameSync(BACKUP_FILE, REGISTRY_FILE)` (lines 62–66)
- `persistCache()` serializes `Object.fromEntries(memoryCache)` + approvals → `atomicWrite()` (lines 68–72)
- Mutation pattern across all writes: `getCache()` → read entry → mutate object → `cache.set()` → `persistCache()`

**No cross-process synchronization mechanism found in application code.** Grep for `pg`, `Pool`, `Client(`, `DATABASE_URL`, `REDIS_URL`, `redis`, `valkey`, `O_EXCL`, `LOCK_EX`, `lockFile`, `.lock` — zero matches in production/POC application code. `package.json` dependencies are only: `express`, `axios`, `googleapis`, `@xenova/transformers`. No database or ORM driver is present.

**Render configuration — `openclaw-render.json`:**
- Contains only `gateway.mode` and `gateway.bind` (Render gateway config, not persistence/database config)
- AGENTS.md §3 explicitly states: "`gateway.mode` is an OpenClaw configuration key, not an environment variable. Do not add `GATEWAY_MODE` or similar guessed environment variables to this application."

**No `render.yaml` or `.render/` directory exists** in the repository — no Render service configuration with persistence/disk/database attachment is present.

**Crash/recovery logic exists only for task rehydration, not for atomic claims:**
- `rehydrateTask()` (lines 716–826): resolves lineage, reads current entry, replays if no active task, or re-transitions from observed state
- `replayTask()` (lines 195–240): fingerprint-based replay/idempotency — blocks payload-mismatch, prevents duplicate task creation
- `resolveCurrentLineage()` (lines 313–327): walks `lineage.superseded_by` chain
- These are recovery/replay mechanisms, NOT atomic claim primitives.

**Runtime topology evidence:**
- `index.js` starts Express on `process.env.PORT || 3000` (line 95)
- AGENTS.md §3 states: "Hosted on Render. The application start command is `node index.js`."
- AGENTS.md §3 states: "Production application start command is `node index.js`."

### INFERRED

- Render deploys the application as Node.js/Express on port 3000 (or `PORT`)
- The production Render environment likely uses process-local filesystem for `poc/task-registry.json` (no persistent disk is evident from repository config)
- If Render scales beyond a single instance, the JSON file approach would already be unsafe for task creation (not just claim)
- `services/deepseek-runtime.js` calls `taskRegistry.getTask()`, `taskRegistry.getTasksByParent()`, `taskRegistry.isCancelled()`, `taskRegistry.isSuperseded()` as read operations only (lines 326–331, 378–381, 400–401, 407, 430–431, 432, 438, 459, 467, 471–472)

### UNKNOWN

- Actual Render service scaling: single instance or multiple instances (Render web services default to scale=1 unless autoscale is configured; this is NOT verifiable from repository alone)
- Whether Render persistent disk is attached to the service (no `render.yaml` or Render dashboard config in repository)
- Whether any external database (Postgres, Redis, Valkey, Key Value store) is provisioned in the Render service environment (no config evidence; would only be visible at runtime via env vars)
- Whether `process.env` contains any database connection string or lock-provider URL at deploy time
- The actual crash/restart behavior of the single Render instance (ephemeral disk vs. persistent disk persistence across restarts)
- Whether the JSON file survives Render instance restarts (depends on persistent disk configuration)

## Root Architectural Failure

The root failure is not a code bug but an **architectural authority gap**: the execution-claim protocol (defined in `research-TASK-CHATGPT-EXTERNAL-ACTIVATION-EXECUTION-CLAIM-RECOVERY-RESEARCH-001.md`) requires atomic compare-and-set on TaskRegistry state to establish exclusive execution ownership. The current TaskRegistry provides atomic file replacement (`renameSync`) but performs read-modify-write over process-local state with no cross-process coordination.

Two concurrent Render requests for the same claimable task can each:
1. Read the same unclaimed task from `memoryCache`
2. Independently decide to claim it
3. Both proceed toward external invocation (GitHub workflow dispatch)
4. Persist their respective writes via `renameSync` — last writer wins, losing the first claim

Atomic replacement is necessary but NOT sufficient for atomic logical compare-and-set.

## Mechanism Evaluation

Each candidate mechanism is evaluated against the claim protocol's required outcomes (see `research-TASK-CHATGPT-EXTERNAL-ACTIVATION-EXECUTION-CLAIM-RECOVERY-RESEARCH-001.md` §Claim Protocol) and crash/recovery windows A–E.

### Mechanism 1: JSON File-Backed with Hardening (Status Quo Enhanced)

**Description:** Extend the current `poc/task-registry.js` with file-based advisory locking (e.g., `fs.open` with `O_EXCL` lock file, or `proper-lockfile` npm package) to serialize read-modify-write across processes on the same host.

| Criterion | Assessment |
|---|---|
| Cross-process atomic CAS | PARTIAL — works only on same host/filesystem; `flock`/`O_EXCL` is filesystem-local |
| Survives process crash (window C: claim persisted, carrier dies, agent may or may not have started) | PARTIAL — lock auto-releases on process exit (crash), but claim record persists; requires separate stale-claim detection |
| Multi-instance Render scaling | NO — does not coordinate across Render instances |
| No new dependency | YES if using `fs.open`+`O_EXCL`; NO if using npm `proper-lockfile` |
| Reuses existing TaskRegistry | YES — minimal extension |
| Does not introduce second control plane/store | YES |

**Verdict:** ACCEPTABLE IF AND ONLY IF Render operates as a single instance (scale=1) with an ephemeral or local filesystem, AND a stale-lease detection mechanism is added. NOT acceptable for multi-instance Render or for the uncertain `claim persisted → carrier dies` recovery window without additional lease expiry logic.

### Mechanism 2: Render Persistent Disk

**Description:** Attach a Render persistent disk to the service; the TaskRegistry JSON file lives on the shared persistent disk. Use `flock`-style or `O_EXCL`-based locking on the shared disk path.

| Criterion | Assessment |
|---|---|
| Cross-process atomic CAS | PARTIAL — works across processes on the same Render instance sharing the disk |
| Survives instance restart | YES — persistent disk survives restart (claim record durability) |
| Multi-instance Render scaling | NO — Render persistent disks are not multi-attach SAN; only one instance can mount a persistent disk |
| No new dependency | YES |
| Reuses existing TaskRegistry | YES |
| Does not introduce second control plane/store | YES |

**Verdict:** This is a **RENDER-LEVEL configuration**, not a repository code decision. The repository cannot enforce or verify persistent-disk attachment. If Render uses persistent disk + single instance, Mechanism 1 (with file locking) becomes viable. Repository code change alone (without Render config) cannot establish this. VERDICT: DEPENDENT ON UNKNOWN RENDER CONFIGURATION.

### Mechanism 3: Render Postgres

**Description:** Use a Render Postgres database table as the authoritative TaskRegistry store with `SELECT … FOR UPDATE` or `UPDATE … WHERE status = '<unclaimed>' RETURNING *` for atomic claims.

| Criterion | Assessment |
|---|---|
| Cross-process atomic CAS | YES — `SELECT FOR UPDATE` / conditional `UPDATE` within a transaction is atomic across all processes |
| Survives process crash (window C) | YES — claim record persists in DB; stale-claim detection via lease expiry |
| Multi-instance Render scaling | YES — Postgres is the single source of truth regardless of instance count |
| Survives instance restart | YES |
| No new dependency | NO — requires `pg` or `@neondatabase/pg` npm package |
| Reuses existing TaskRegistry | PARTIAL — TaskRegistry interface stays, storage backend changes to DB |
| Does not introduce second control plane/store | YES — TaskRegistry remains authoritative, storage backend only changes |

**Verdict:** STRONGLY CORRECT for concurrency but REQUIRES: (1) a new npm dependency (`pg`), (2) Render Postgres addon provisioning (environment-level), (3) a new `node_modules` dependency not in `package.json`. AGENTS.md §5 Change Discipline: "Do not add dependencies unless explicitly required." The task constraints say "Do not introduce a new persistence dependency unless explicitly required." This mechanism requires an authorization decision outside this RESEARCH_DOCUMENT task.

### Mechanism 4: Render Key Value (Valkey/Redis)

**Description:** Use Render Key Value (managed Valkey/Redis) with `SET key value NX EX ttl` for atomic claim acquisition with automatic lease expiry.

| Criterion | Assessment |
|---|---|
| Cross-process atomic CAS | YES — `SET NX` is atomic compare-and-set across all clients |
| Survives process crash (window C) | YES — `EX ttl` provides automatic lease expiry; claim record persists |
| Multi-instance Render scaling | YES — Valkey is the shared truth regardless of instance count |
| Survives instance restart | YES |
| No new dependency | NO — requires `redis` or `ioredis` npm package |
| Reuses existing TaskRegistry | PARTIAL — TaskRegistry interface stays, but claim/leasing logic delegates to Valkey |
| Does not introduce second control plane/store | PARTIAL — Valkey becomes an authoritative persistence tier alongside TaskRegistry; must be treated as TaskRegistry's storage backend, NOT a second TaskRegistry |
| Stale-claim recovery | BEST — automatic `EX ttl` lease expiry handles the `claim persisted → carrier dies` window natively |

**Verdict:** STRONGLY CORRECT, particularly for the crash/recovery windows (B, C, D) where automatic TTL lease expiry resolves the hard uncertainty (`claim persisted → carrier dies → agent may or may not have started`). REQUIRES: (1) a new npm dependency (`redis`/`ioredis`), (2) Render Key Value addon provisioning (environment-level). Same authorization concern as Mechanism 3.

### Mechanism 5: Re-evaluate Current JSON + Process-Local — Acceptable Under Specific Topology

**Description:** The current mechanism is acceptable as-is IF the runtime topology is provably single-process, single-instance, and crash-recovery is handled by replay/fingerprint (existing mechanism), accepting that the `claim persisted → carrier dies` window is handled by explicit operator recovery (fail-closed).

| Criterion | Assessment |
|---|---|
| Claims atomic per-process | YES within one process |
| Replay/idempotency | YES — existing `replayTask()` / `computePayloadFingerprint()` handle duplicate admission |
| Reuses existing TaskRegistry | YES — zero changes |
| No new dependency | YES |
| Does not introduce second control plane/store | YES |

**Verdict:** ACCEPTABLE ONLY IF Render is provably single-instance AND operator accepts that a process crash between claim-persist and carrier-invocation requires manual recovery (the existing `rehydrateTask()` + `replayTask()` provides the recovery mechanism). The hard uncertainty window (C) is NOT resolved — it is preserved as an explicit fail-closed recovery path.

## Crash/Recovery Windows Analysis

Mapping the current TaskRegistry mutation model against the five failure windows from the prior research record:

### Window A: Before claim (no claim exists)
- **Current behavior**: Task is `UNCLAIMED` (no execution claim field yet — the concept is PROPOSED/TARGET, not implemented). Any concurrent admission either creates a new task (via `createTask` guard on duplicate `request_id`) or matches via `replayTask()`.
- **Gap**: No actual claim field exists. This is part of the BLOCKED implementation, not a persistence issue.

### Window B: After claim, before agent invocation
- **Requirement**: No blind duplicate; explicit lease/recovery policy.
- **Current behavior**: N/A — no claim mechanism exists.
- **JSON/file mechanism**: Would need file locking + claim record. Single-process risk only.
- **Valkey mechanism**: `SET claim_key carrier_id NX EX 300` — automatic lease. Clean.

### Window C: After agent invocation, before callback/evidence
- **The hardest uncertainty**: claim persisted → carrier dies → agent may or may not have started.
- **Current behavior**: No claim exists; the dispatcher is called immediately after TaskRegistry create in `routes/poc.js` (line 1008). If the process dies after dispatch but before callback, there is no durable record of invocation.
- **JSON/file mechanism**: Cannot prove whether the GitHub workflow was invoked. No carrier invocation record persisted.
- **Valkey mechanism**: Could record `invocation_started` flag with TTL; on recovery, if flag exists but no callback, follow explicit recovery (not blind re-invocation).
- **Postgres mechanism**: Same capability as Valkey via transactional state.

### Window D: Callback duplicated
- **Current behavior**: `orchestrator.handleKiloCompletion()` checks idempotency (line 49-51: `task.kilo.status === 'success' || 'failure' || 'blocked'` → returns duplicate). This is state-based idempotency on the TaskRegistry entry.
- **Gap**: Works within process-local cache; across processes, the read-modify-write in `updateAgentResult()` has the same race vulnerability.

### Window E: Terminal task
- **Current behavior**: `rehydrateTask()` reads terminal states and returns `action: 'none'` or `action: 'complete'` without re-execution. `replayTask()` returns `task_terminated: true` for terminal states. This works correctly.

## Claim Semantics Mapping

The required claim outcomes from the prior research, mapped to each mechanism:

| Claim Outcome | Meaning | JSON/file (harnessed) | Render Persistent Disk | Render Postgres | Render Key Value (Valkey) |
|---|---|---|---|---|---|
| UNCLAIMED | No claim exists | Detect absence of claim field | Same as JSON/file | `SELECT … WHERE claim_id IS NULL` | `GET` returns nil |
| CLAIMED | This carrier owns the task | Read-modify-write with file lock | Read-modify-write + lock on shared disk | `UPDATE … WHERE claim_id IS NULL RETURNING *` | `SET claim NX EX ttl` succeeds |
| ALREADY_CLAIMED | Another carrier owns it | Lock + check claim field | Same | `UPDATE … WHERE claim_id IS NULL` returns 0 rows | `SET claim NX EX ttl` fails (key exists) |
| COMPLETE | Task already complete | Check `status === COMPLETE` | Same | Same | Same |
| FAILED/BLOCKED | Terminal failure | Check terminal status | Same | Same | Same |
| RECOVERABLE | Explicit recovery policy permits reclaim | Lease expiry check (stale-claim timeout) | Same | Lease expiry via `updated_at` + timeout column | TTL expiry (`EX`) — automatic |
| MISMATCH | Carrier/task identity mismatch | Compare claim field | Same | Compare claim field | Compare claim field |
| UNAUTHORIZED | Authority invalid | ACP validation gate | Same | Same | Same |

**Key observation:** The JSON/file and Render Persistent Disk mechanisms require manual stale-claim detection (compare `claim_timestamp` against a timeout window). The Valkey mechanism provides native TTL-based lease expiry. The Postgres mechanism requires a `lease_expires_at` column + expiry check in application logic.

## Runtime Topology Classification

| Aspect | Classification | Evidence |
|---|---|---|
| Runtime | VERIFIED | Render Node.js/Express, `node index.js`, `process.env.PORT \|\| 3000` (`index.js:95`, AGENTS.md §3) |
| Single vs. multi-instance | UNKNOWN | No `render.yaml`, no `.render/`, no Render dashboard config in repository. Render web services default to scale=1 but this cannot be asserted from repository alone. |
| Persistent disk | UNKNOWN | No Render service config in repository. Ephemeral filesystem is the Render default; persistent disk is an explicit configuration. |
| Database/Key-Value | UNKNOWN | No DB dependency in `package.json`; no env var usage in code for database/Redis/Valkey. Would only appear as runtime env vars not present in source. |
| Process model | VERIFIED | Single Node.js process per instance; async I/O via Express request handlers |

## Prior Research Reconciliation

`research-TASK-CHATGPT-EXTERNAL-ACTIVATION-EXECUTION-CLAIM-RECOVERY-RESEARCH-001.md` (2026-10-02) established:

> "The current TaskRegistry is JSON/file-backed with a process-local `memoryCache`. `atomicWrite()` uses backup-file write plus `fs.renameSync()`, which makes an individual replacement atomic, but existing mutations are read-modify-write operations over process-local state. No inter-process lock, database transaction, compare-and-set/version check, distributed mutex, or equivalent cross-process serialization mechanism was found."

This record is consistent and is confirmed by source inspection. This new record evaluates the candidate mechanisms against that established blocker and the claim semantics / crash-recovery windows.

The prior record's "Minimum Decision Before Implementation" (§Minimum Decision Before Implementation) requires:

> "Which single authoritative persistence mechanism can safely serialize TaskRegistry create/recover/claim mutations across the actual Render process/instance topology?"

This record resolves that question to: **UNRESOLVED — the Repository of Truth cannot determine this from source alone; it depends on unknown Render deployment configuration.**

## Conclusions

### Conclusion 1: No Safe Mechanism Currently Established

The repository contains no persistence mechanism that is both (a) present in code and (b) capable of cross-process atomic compare-and-set under an uncertain Render topology. The current JSON/file mechanism is safe only for a provably single-instance, single-process deployment — a condition that cannot be verified from the repository.

### Conclusion 2: The Decision Is Configuration-Dependent

The answer to "which single authoritative mechanism" depends on two UNKNOWN Render configuration facts:

1. **Is Render single-instance (scale=1)?** — If yes, file-based locking (`O_EXCL` or `flock`) on the JSON file is sufficient for cross-process safety within one instance. If no (multi-instance), file-based locking fails.
2. **Is a persistent disk or managed datastore (Postgres/Redis) provisioned?** — If yes, that becomes the candidate. If no, only the local filesystem is available.

### Conclusion 3: Two Viable Resolution Paths

**Path A — Single-instance, local filesystem (least change):**
- Add file-based advisory locking to `poc/task-registry.js` (using `fs.open` with `O_EXCL` on a lock file — no new dependency needed)
- Add stale-claim detection (lease timestamp + timeout window for the `claim persisted → carrier dies` recovery window)
- Add a `claim` field to the TaskRegistry entry schema
- Accept that this works only if Render is provably single-instance with local filesystem
- Does NOT require any new dependencies or Render configuration changes

**Path B — Shared datastore (Render Postgres or Render Key Value):**
- Requires a new npm dependency (`pg` or `redis`/`ioredis`) — NOT currently in `package.json`
- Requires Render service configuration (addon provisioning, env var injection)
- Provides native cross-instance atomicity and (for Valkey) automatic TTL-based lease expiry
- Requires an explicit authorization decision to add a persistence dependency, per AGENTS.md §5

### Conclusion 4: Mechanism Ranking

| Rank | Mechanism | Verdict |
|---|---|---|
| 1 | Render Key Value (Valkey) with `SET NX EX ttl` | STRONGEST for correctness, but requires dependency + Render config authorization |
| 2 | Render Postgres with `SELECT FOR UPDATE` / conditional `UPDATE` | STRONG for correctness, but requires dependency + Render config authorization |
| 3 | JSON file + `O_EXCL`/`flock` locking (local filesystem) | VIABLE for single-instance only; requires stale-claim detection; no new dependency |
| 4 | Current JSON file (no locking) | UNSAFE for any concurrency; current state |
| 5 | Render Persistent Disk + file locking | EQUIVALENT to mechanism 3 if single-instance; persistent disk is Render config, not repo decision |

### Final Decision Status: BLOCKED — Requires Authorized Resolution

**The persistence/concurrency decision is BLOCKED until one of the following occurs:**

1. **Path A authorization**: An authorized task confirms Render is single-instance and adds file-based locking + stale-claim detection to `poc/task-registry.js` (no new dependency).
2. **Path B authorization**: An explicitly authorized persistence-hardening task adds `pg` or `redis` as a dependency AND provisions Render Postgres or Render Key Value, then upgrades TaskRegistry to use it as its single storage backend (not a second store).
3. **Topology confirmation**: Definitive evidence (Render dashboard config, `render.yaml`, or env var inspection) that establishes the Render process/instance topology.

No execution-claim implementation should proceed before one of these is resolved. The external-activation execution-claim implementation remains BLOCKED.

## Unresolved Questions / Blockers

1. **Render scaling factor**: Is the Render web service configured for single instance (scale=1) or multiple instances? — UNKNOWN, no `render.yaml` or Render service config in repository.
2. **Render persistent disk**: Is a persistent disk attached? — UNKNOWN, no config evidence.
3. **Render datastore provisioning**: Is Render Postgres or Render Key Value addon provisioned and available via environment variables? — UNKNOWN, no database dependency or env var usage in source code.
4. **Stale-claim timeout value**: If file locking is adopted (Path A), what is the acceptable stale-claim timeout window for the `claim persisted → carrier dies` recovery scenario? — Requires operational policy decision.
5. **Lease vs. evidence for crash recovery (window C)**: Should stale-claim recovery be time-based (lease TTL) or evidence-based (GitHub Actions run API check)? — Architectural decision required.
6. **Dependency authorization**: If Path B is chosen, which datastore (Postgres or Valkey) and which npm client package? — Requires explicit dependency-addition authorization per AGENTS.md §5.

## Relevant Repository Files / Interfaces

| File | Role |
|---|---|
| `poc/task-registry.js` | Current JSON/file-backed TaskRegistry with process-local `memoryCache`; `atomicWrite()` at line 62; `persistCache()` at line 68; `rehydrateTask()` at line 716; `replayTask()` at line 195; exports at line 828 |
| `poc/activation-ingress.js` | Canonical external activation ingress; calls `taskRegistry.replayTask()` (line 163), `taskRegistry.createTaskWithDirectorAuthorization()` (line 205), `taskRegistry.createTask()` (line 216), `taskRegistry.persistCache()` (line 263) |
| `routes/poc.js` | HTTP layer: `routes/poc.js:985` `/activation/ingress` calls canonical ingress then `getDispatcher()` (line 1008); `transitionToExecuting()` calls `taskRegistry.updateTaskStatus()` per-step (lines 20–29) |
| `services/transport-provider.js` | Dispatcher for Kilo/Gemini/Gemini Builder |
| `poc/orchestrator.js` | Handles completion callbacks; `handleKiloCompletion()` idempotency check at lines 49–51 |
| `services/deepseek-runtime.js` | Reads TaskRegistry only (no mutations); calls `getTask()`, `getTasksByParent()`, `isCancelled()`, `isSuperseded()`, `validateLineageForCreate()`, `hasEvidenceOfType()` |
| `poc/schemas/acp-schema.js` | TaskRegistry entry schema; `VALID_STATE_TRANSITIONS`, `TASK_REGISTRY_REQUIRED_FIELDS` |
| `poc/gemini-trigger.js` | GitHub `workflow_dispatch` carrier adapter |
| `poc/gemini-builder-trigger.js` | GitHub `workflow_dispatch` carrier adapter |
| `package.json` | Dependencies: `express`, `axios`, `googleapis`, `@xenova/transformers` — NO database/ORM/lock packages |
| `openclaw-render.json` | Render gateway config only (`gateway.mode`, `gateway.bind`) — no persistence/database configuration |
| `.github/workflows/main.yml` | GitHub Actions carrier workflow; NOT a Render persistence mechanism |
| `AGENTS.md` | §3: "Hosted on Render. The application start command is `node index.js`."; §5: "Do not add dependencies unless explicitly required." |

## Implementation Implications / Recommended Next Action

**No implementation action is authorized by this RESEARCH_DOCUMENT task.** The research-only constraint prohibits code changes, dependency additions, or workflow changes.

The recommended next action is an **explicitly authorized follow-up task** — either:

1. **Persistence-hardening task (preferred)**: Add `O_EXCL`-based file locking + stale-claim detection to `poc/task-registry.js` (Path A), confirmed against Render single-instance topology, OR
2. **Datastore provisioning + storage-backend task (Path B)**: Provision Render Postgres or Render Key Value, add `pg`/`redis` dependency, and migrate TaskRegistry storage backend to the chosen datastore as its sole authoritative store.

After resolution, the execution-claim implementation (as specified in `research-TASK-CHATGPT-EXTERNAL-ACTIVATION-EXECUTION-CLAIM-RECOVERY-RESEARCH-001.md` §Exact server changes) can proceed as an atomic Kilo implementation task.

## Verification / Evidence Basis

All findings were verified through direct source code inspection:

1. **TaskRegistry persistence mechanism**: Read `poc/task-registry.js` in full (868 lines). Confirmed `memoryCache = new Map()` (line 28), `atomicWrite()` backup+rename pattern (lines 62–66), `persistCache()` read-modify-write loop (lines 68–72), and that every mutation function calls `cache.set()` then `persistCache()`.
2. **No cross-process primitives**: Grep across `*.js` for `pg`, `Pool`, `RedisClient`, `O_EXCL`, `LOCK_EX`, `lockFile`, `.lock`, `flock`, `mutex`, `compareAndSet`, `version`, `etag` — zero matches in application code (only `protocol_version` in test fixtures, unrelated).
3. **No database dependency**: Read `package.json` — only `express`, `axios`, `googleapis`, `@xenova/transformers`.
4. **No Render service config**: Glob for `render.yaml`, `.render/**` — no files found. `openclaw-render.json` contains only gateway config.
5. **Runtime topology**: `index.js:95` confirms `process.env.PORT \|\| 3000`; AGENTS.md §3 confirms Render hosting and `node index.js` start command.
6. **Prior research consistency**: Confirmed prior record's claim of "no inter-process lock, database transaction, compare-and-set/version check, distributed mutex" is accurate against source.
7. **Claim semantics mapping**: Evaluated each candidate mechanism (JSON/file locking, Render Persistent Disk, Render Postgres, Render Key Value, current state) against all seven claim outcomes and five crash/recovery windows.
