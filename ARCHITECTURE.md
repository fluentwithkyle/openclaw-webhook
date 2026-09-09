# Fluent with Kyle — OpenClaw Automation Architecture & Development Roadmap

## Purpose and authority

This document is the authoritative development roadmap and operating guide for AI agents working in this repository. Read it with `GEMINI.md`, `package.json`, and the relevant implementation before changing the system.

The system automates the Fluent with Kyle client lifecycle. It receives Tally intake and Cal.com events, makes lifecycle and communication decisions in Render/OpenClaw, persists CRM data in Google Sheets through Google Apps Script, sends operational notifications through LINE, and sends client email through Gmail.

### Core boundary

> **Render/OpenClaw makes business decisions.**
>
> **Google Apps Script performs Google-specific operations.**

In practical terms:

| Layer | Responsibility |
| --- | --- |
| Render/OpenClaw (Node.js) | Intake and booking processing, lifecycle decisions and transitions, eligibility, package/credit logic, notification content, and workflow orchestration. |
| Google Apps Script | Google Sheets CRM reads/writes and Gmail delivery through the Apps Script web-app adapter. |
| Google Sheets | The current CRM record and operational interface. |
| Gmail | Email delivery channel. |
| Tally and Cal.com | Event sources. |
| LINE | Operational communication channel, not a business-rules engine. |

Do not turn this roadmap into permission for a broad redesign. The application is production-oriented and must evolve through small, verified, incremental changes.

---

## AI development system

### Gemini — architect and reviewer

Gemini is responsible for:

- architecture;
- large-context repository analysis;
- planning and reasoning;
- dependency mapping;
- Google- and GitHub-specific analysis;
- architectural review; and
- integration review.

Gemini analyzes the repository, understands the architecture, and produces an implementation plan. Gemini reviews the finished implementation for architectural and integration correctness; it is not the primary implementation agent.

### Codex — primary builder

Codex is responsible for:

- primary implementation;
- debugging;
- multi-file changes;
- tests;
- refactoring;
- verification; and
- final corrections.

Codex implements the reviewed plan, makes the smallest appropriate changes, runs relevant checks, and resolves the final issues found in review.

### Groq / free open models — utility capacity

Use Groq and free open models for quick questions, boilerplate, simple transformations, and high-volume iterations. They must not independently redefine the system architecture.

### Local Goose — local execution support

Use Local Goose for local development, repetitive tasks, background processing, experimentation, and large batches of low-risk work. It operates within the boundaries in this document.

### Standard development loop

```text
Gemini
  → analyze repository
  → understand architecture
  → produce implementation plan

Codex
  → implement plan
  → modify files
  → run tests
  → debug
  → verify

Gemini
  → architectural / integration review

Codex
  → final corrections
```

**Gemini is the architect/reviewer. Codex is the primary builder.**

### Agent operating rules

Before changing code, an agent must:

1. Read this document and `GEMINI.md`.
2. Inspect the relevant current implementation and interfaces.
3. Identify the smallest change that meets the request.
4. Preserve existing behavior unless the request explicitly changes it.
5. Keep business logic in Render and Google-specific implementation in Apps Script.
6. Avoid unrelated rewrites and unnecessary dependencies.
7. Run focused verification and update architecture documentation when a material boundary or roadmap item changes.

---

## Current repository architecture

The repository is at the **workflow-modular intermediate stage**:

```text
index.js
  → infrastructure, routes, health, scheduler startup, keep-alive

workflows/abandonedBooking.js
  → abandoned-booking business workflow

services/
  → integration and provider-processing services

google-apps-script/
  → Google-specific adapter implementation
```

Current source layout:

```text
openclaw-webhook/
├── index.js
├── workflows/
│   └── abandonedBooking.js
├── services/
│   ├── appsScript.js
│   ├── cal.js
│   ├── lineService.js
│   └── tally.js
├── google-apps-script/
│   ├── Code.js
│   ├── CRM.js
│   ├── AbandonedBookings.js
│   ├── Email.js
│   ├── Utilities.js
│   └── appsscript.json
├── GEMINI.md
├── package.json
└── ARCHITECTURE.md
```

### Application shell — `index.js`

`index.js` creates the Express application, installs JSON middleware, registers the Tally and Cal.com webhook routes, exposes `/` and `/health`, starts the abandoned-booking interval, starts keep-alive requests, and listens on the configured port. It imports and starts the workflow, but **does not contain the abandoned-booking business workflow**.

### Services

- `services/tally.js` processes Tally submissions, extracts and normalizes intake data, handles question submissions, determines the initial state and credits, sends LINE question alerts, and requests CRM upserts.
- `services/cal.js` processes Cal.com booking, cancellation, and meeting-ended events; retrieves client context; makes booking/cancellation decisions; creates LINE message content; and coordinates the current Free Intro follow-up email flow.
- `services/appsScript.js` is the Node-to-Apps-Script gateway. It posts action payloads to `APPS_SCRIPT_URL` and also provides timestamp/title formatting helpers.
- `services/lineService.js` sends the already-composed notification text to the LINE Messaging API.

Services may contain provider-specific processing. Business workflows belong in `workflows/` as they are extracted; do not move business rules into Apps Script.

---

## Current lifecycle and event flows

### Tally intake → CRM

```text
Tally webhook
  → Render / services/tally.js
  → normalize intake and determine package, credits, and lifecycle state
  → services/appsScript.js
  → Google Apps Script
  → Google Sheets CRM
```

A normal Tally #1 submission is written with `Schedule Status = Pending Booking`. Question submissions create a follow-up-needed CRM update and send a LINE alert. Current credit handling assigns four credits to the intensive/monthly/flex products and one credit to Deep Dive, Single Session, and Free Intro products.

### Booking, cancellation, and Free Intro follow-up

```text
Cal.com webhook
  → Render / services/cal.js
  → look up CRM context through Apps Script
  → decide the lifecycle update and create operational notification content
  → Google Sheets CRM and LINE
```

For booking-created handling, Render determines session type from guest information, updates the CRM to `Confirmed`, and sends the booking notification. For cancellation handling, Render updates `Schedule Status` and `Cancellation Status` to `Cancelled`, records the cancellation reason, and sends the cancellation notification.

For a `MEETING_ENDED` event whose title indicates Free Intro, Render generates the personalized Tally #2 URL and currently requests the `intro_followup` template from Apps Script, performs placeholder substitution in Render, then requests Gmail delivery through Apps Script. Moving template selection, personalization, and generation toward Render remains a later, incremental improvement.

### Abandoned booking — current Render-owned workflow

The abandoned-booking workflow extraction is **COMPLETED**. `index.js` starts a five-minute scheduler; the business workflow is in `workflows/abandonedBooking.js`.

```text
scheduler
  → abandonedBooking workflow
  → get_pending
  → elapsed-time calculation
  → eligibility
  → CRM update
  → LINE notification
```

The workflow requests pending clients with `get_pending`, calculates elapsed time from the submitted timestamp, considers pending records eligible after the threshold, sends the LINE alert, then requests a CRM status update to `Follow-Up Needed`.

**Preserved strict behavior:** the current eligibility condition is `elapsedMs > 30 minutes` (strictly greater than 30 minutes), not greater-than-or-equal-to.

Duplicate-alert prevention/durable processing is still needed: the current sequence relies on the CRM status update after notification and does not yet provide a durable idempotency mechanism. It is important, but it follows authentication of the Node-to-Apps-Script action contract.

---

## Google Apps Script adapter

The Google Apps Script source is versioned in `google-apps-script/`. It is part of the current repository—not a future target.

```text
Render/OpenClaw
  → action payload to Apps Script web app
  → Code.js action routing
  → CRM.js / Email delivery functions
  → Google Sheets CRM / Gmail
```

### Deployment and trust boundary

`appsscript.json` declares a web app executed as the deploying user and accessible to anyone anonymous. The Node gateway posts action payloads to the configured Apps Script endpoint. This arrangement exposes a web-app endpoint that accepts actions for CRM writes and email delivery, while the current application-level action contract has no trust boundary.

The endpoint URL has historically been available through configuration/source. This must be treated as a production-hardening concern, not as an invitation to redesign the adapter.

### Action routing — `Code.js`

`Code.js` implements `doPost(e)`: it parses the request body, reads `data.action`, dispatches the supported action, and returns JSON through `ContentService`. The currently routed actions are:

- `upsert_client` → CRM upsert;
- `get_client` → CRM lookup by email or LINE ID;
- `get_pending` → pending-booking retrieval;
- `get_template` → email-template retrieval; and
- `send_email` → Gmail send operation.

Unknown actions and caught errors produce an error response. This list documents the current implementation; do not invent action names or expand the contract without a narrowly scoped, reviewed change.

### CRM responsibilities — `CRM.js`

`CRM.js` owns the physical Google Sheets operations: opening the configured spreadsheet/tab, upserting clients by email or LINE ID, retrieving a client by email or LINE ID, retrieving clients in `Pending Booking`, and retrieving email templates from the `EmailTemplates` sheet. Its current row mapping covers the expanded 22-column Clients CRM, including identity, intake context, package, credits, schedule state, booking/cancellation data, and question text.

Render decides which lifecycle transition and values should be applied. Apps Script carries out the Sheets read/write.

### Email responsibilities — `Email.js`

`Email.js` contains the Gmail-specific `sendClientEmail(data)` implementation. It uses the request’s recipient, subject, and HTML body and sends through `GmailApp` with the Fluent with Kyle sender name. `Code.js` also contains a `sendClientEmail(data)` helper used by its route; the duplicate helper name is current repository state and should be handled carefully in any future focused cleanup. This document does not redefine that behavior or contract.

### Utility and manifest files

- `Utilities.js` provides the current JSON response helper.
- `appsscript.json` defines the Apps Script runtime, timezone, required Sheets/Gmail/external-request scopes, and web-app deployment configuration.

### Legacy Apps Script abandoned-booking workflow

`google-apps-script/AbandonedBookings.js` exists in the repository and contains the prior Apps Script-based abandoned-booking check and a callback to Render. It is architecturally inconsistent with the current Render-owned workflow.

Repository code existing is **not proof** that a deployed Apps Script time-driven trigger invokes it. Before retirement, verify the deployed Apps Script project and whether such a trigger exists. If it is deployed, disable/retire it only after that verification and after confirming the Render workflow is the intended active path. Do not claim the legacy trigger is active without deployment evidence.

---

## Current CRM and lifecycle model

Google Sheets is the current CRM. The `Clients` row shape is:

| Column | Field |
| --- | --- |
| A | Timestamp |
| B | Name |
| C | Email |
| D | LINE ID |
| E | Location/Address |
| F | Profession |
| G | English Reality |
| H | 3-Month Goal |
| I | Conversation Topics |
| J | Package |
| K | 1-on-1 / 1-on-2 |
| L | Guest Name |
| M | Guest Email |
| N | Guest LINE ID |
| O | Payment Status |
| P | Session Credits |
| Q | Schedule Status |
| R | Booking Date/Time |
| S | Cancellation Status |
| T | Cancellation Reason |
| U | Booking Notes |
| V | Question Text |

Current observed lifecycle states include `Pending Booking`, `Confirmed`, `Follow-Up Needed`, and `Cancelled`. Future work should standardize lifecycle states and CRM transition handling without changing currently working transitions accidentally.

---

## Roadmap and sequencing

### Completed

- **COMPLETED — abandoned-booking workflow extraction.** The scheduler remains in `index.js`; the business workflow is in `workflows/abandonedBooking.js`.
- **COMPLETED — Google Apps Script source included in the repository.** The adapter source and manifest are available under `google-apps-script/` for review with the Node implementation.

### Single current highest-priority task

## Authenticate and harden the Node → Google Apps Script action contract

This is the immediate production-hardening priority. The Apps Script web-app endpoint currently accepts actions that include CRM writes and email delivery, the endpoint is anonymously accessible at the deployment level, and the current contract lacks an application-level trust boundary. Because the endpoint URL has historically been available through configuration/source, authentication must be implemented **before** further reliability work.

Keep this change narrow: authenticate and validate the current Node-to-Apps-Script request/response boundary without using it as an opportunity to replace the architecture, rename unrelated actions, or refactor unrelated workflows.

### After authentication, in approximate order

1. **Retire or disable the legacy Apps Script abandoned-booking workflow** after verifying whether a deployed time-driven trigger exists.
2. **Add durable, idempotent abandoned-booking processing** to prevent duplicate alerts and make retries safe.
3. **Standardize Apps Script responses and Render error handling** at the existing adapter boundary.
4. **Move email template selection, personalization, and generation toward Render** while retaining Apps Script for Gmail delivery.
5. **Standardize lifecycle states and CRM transition handling.**
6. **Expand focused automated testing.** Testing remains an identified gap.
7. **Continue gradual domain-oriented refactoring.**
8. **Centralize event processing later.**
9. **Expand the OpenClaw management layer later.**

### Intentionally deferred architecture

The following are future directions, not current implementation mandates:

```text
workflow-modular intermediate system
  → gradual domain-oriented business modules
  → centralized event processing
  → OpenClaw management layer
  → more complete client lifecycle automation
```

Do not introduce an event bus, a new persistence system, a wholesale CRM replacement, broad framework changes, or an OpenClaw management plane while addressing the immediate authentication task. Make each later transition only when a concrete requirement justifies it and after reviewing the existing workflow boundaries.

---

## Change discipline and verification

For any implementation work:

- Treat the current repository implementation as the source of truth.
- Preserve the Render-owned business-decision boundary.
- Preserve Apps Script as the Google-specific adapter.
- Prefer focused tests and targeted checks; add tests where a change has a clear seam.
- Check imports/exports, asynchronous behavior, error handling, environment variables, and external action payloads.
- Update this roadmap when an architectural milestone is actually complete; do not mark planned work as complete.

The end state is a reliable, incremental automation system in which Render/OpenClaw owns the client lifecycle and Google Apps Script remains a minimal, authenticated adapter for Google Sheets and Gmail.
