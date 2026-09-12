Fluent with Kyle — OpenClaw Automation Architecture & Development Roadmap

Purpose and authority

This document is the authoritative operating document for the Fluent with Kyle automation system.

It defines:

* the current production architecture;
* business-logic and integration boundaries;
* current repository structure;
* client lifecycle and workflow architecture;
* AI-agent development roles;
* the proposed LINE-centered AI operating model;
* architectural constraints;
* security requirements;
* development discipline;
* the incremental roadmap.

Read this document with GEMINI.md, package.json, and the relevant implementation before changing the system.

The current repository implementation is the source of truth for what is actually implemented. This document must not describe proposed architecture as implemented.

The application is production-oriented and must evolve through small, verified, incremental changes.

⸻

Status labels

Architectural components and roadmap items use these labels:

* CURRENT / IMPLEMENTED — Verified, functional component of the current system.
* PROPOSED / TARGET — Agreed architectural direction that is not necessarily implemented.
* UNDER VALIDATION — Proposed approach currently being tested or benchmarked.
* DEPRECATED — Existing component or approach scheduled for retirement or replacement after appropriate verification.

⸻

1. Executive architecture

1.1 Core architectural principle

The primary architectural boundary is:

If it is a business decision, it belongs in Render.

If it is a Google-specific operation, it belongs in Google Apps Script.

AI orchestration must not become a reason to move business rules out of Render or Google-specific operations out of Apps Script.

The current production system is therefore:

Tally / Cal.com
      ↓
Render / Node.js
      ↓
Business decisions + workflow logic
      ↓
Google Apps Script
      ↓
Google Sheets / Gmail
Render
      ↓
LINE notifications
      ↓
LINE

The long-term target adds an AI control plane without replacing this production boundary.

⸻

2. Current production architecture

2.1 Current system

CURRENT / IMPLEMENTED

The Fluent with Kyle system automates the client lifecycle from intake through booking, follow-up, package selection, payment/session tracking, and booking management.

The current production application is hosted on Render and implemented in Node.js/Express.

Google Apps Script provides the Google-specific adapter layer.

Google Sheets is the current CRM and operational record.

Gmail is the email delivery channel.

LINE is the operational communication channel.

Tally and Cal.com are external event sources.

⸻

2.2 Current responsibility boundaries

Layer	Responsibility
Render / Node.js	Business decisions, lifecycle logic, webhook processing, workflow orchestration, CRM decisions, booking processing, notification content, and production scheduling.
Google Apps Script	Google-specific execution, including Google Sheets reads/writes and Gmail delivery.
Google Sheets	Current CRM record and operational interface.
Gmail	Client email delivery.
Tally	Intake and form/event source.
Cal.com	Booking, cancellation, and meeting event source.
LINE	Operational communication and notifications.

LINE is a communication channel, not a business-rules engine.

⸻

3. Current repository architecture

The repository is at the workflow-modular intermediate stage.

index.js
  → infrastructure
  → Express application
  → routes
  → health endpoint
  → scheduler startup
  → keep-alive
workflows/
  → business workflows
services/
  → integration and provider-processing services
google-apps-script/
  → Google-specific adapter implementation

Current source layout:

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

⸻

4. Render / Node.js application

4.1 Application shell — index.js

CURRENT / IMPLEMENTED

index.js creates the Express application and is responsible for infrastructure-level application startup.

It currently:

* installs JSON middleware;
* registers Tally webhook routes;
* registers Cal.com webhook routes;
* exposes /;
* exposes /health;
* starts the abandoned-booking interval;
* starts keep-alive behavior;
* listens on the configured port;
* imports and starts the abandoned-booking workflow.

The abandoned-booking business logic itself belongs in:

workflows/abandonedBooking.js

index.js should not become a container for unrelated business logic.

⸻

5. Current service architecture

5.1 Tally — services/tally.js

CURRENT / IMPLEMENTED

The Tally service:

* processes Tally submissions;
* extracts and normalizes intake data;
* handles question submissions;
* determines initial lifecycle state;
* determines initial credits;
* sends LINE question alerts;
* requests CRM upserts.

Business interpretation remains in Render.

⸻

5.2 Cal.com — services/cal.js

CURRENT / IMPLEMENTED

The Cal.com service handles booking-related events and their business interpretation within Render.

The production architecture treats Cal.com as an event source.

Render determines the appropriate lifecycle transition and resulting business state.

⸻

5.3 LINE — services/lineService.js

CURRENT / IMPLEMENTED

The LINE service handles operational communication and notification delivery.

LINE is currently used for operational notifications and is not itself the business-rules engine.

The future architecture expands LINE into Kyle’s natural-language control interface while preserving Render as the business-logic boundary.

⸻

5.4 Google Apps Script client — services/appsScript.js

CURRENT / IMPLEMENTED

services/appsScript.js is the Render-side client for the Google Apps Script adapter.

Render sends action payloads to the Apps Script web application.

Apps Script executes Google-specific operations.

Render remains responsible for determining what should happen.

⸻

6. Google Apps Script adapter

6.1 Role

CURRENT / IMPLEMENTED

The Google Apps Script source is versioned in:

google-apps-script/

It is part of the current production architecture.

The intended boundary is:

Render
  ↓
Apps Script action
  ↓
Code.js
  ↓
CRM.js / Email.js
  ↓
Google Sheets / Gmail

Apps Script should remain lightweight and Google-specific.

⸻

6.2 Action routing — Code.js

CURRENT / IMPLEMENTED

Code.js implements doPost(e).

It parses the request body, reads data.action, dispatches the supported action, and returns JSON through the current response mechanism.

Current routed actions are:

* upsert_client → CRM upsert;
* get_client → CRM lookup by email or LINE ID;
* get_pending → pending-booking retrieval;
* get_template → email-template retrieval;
* send_email → Gmail send operation.

Unknown actions and caught errors produce an error response.

This list documents the current implementation.

Do not invent new action names or expand this contract without a narrowly scoped, reviewed change.

⸻

6.3 CRM responsibilities — CRM.js

CURRENT / IMPLEMENTED

CRM.js owns physical Google Sheets operations, including:

* opening the configured spreadsheet/tab;
* upserting clients by email or LINE ID;
* retrieving a client by email or LINE ID;
* retrieving clients in Pending Booking;
* retrieving email templates from the EmailTemplates sheet.

The current CRM mapping covers the expanded 22-column Clients CRM, including identity, intake context, package, credits, schedule state, booking/cancellation data, and question text.

Render determines lifecycle decisions and values.

Apps Script performs the physical Sheets operations.

⸻

6.4 Email responsibilities — Email.js

CURRENT / IMPLEMENTED

Email.js contains the Gmail-specific sendClientEmail(data) implementation.

It uses the request’s:

* recipient;
* subject;
* HTML body;

and sends through Gmail with the Fluent with Kyle sender name.

Code.js also contains a sendClientEmail(data) helper used by its route.

The duplicate helper name is current repository state and should be handled carefully in any future focused cleanup.

This architecture document does not redefine that behavior.

⸻

6.5 Utility and manifest files

CURRENT / IMPLEMENTED

Utilities.js provides the current JSON response helper.

appsscript.json defines the Apps Script runtime, timezone, required scopes, and web-app deployment configuration.

⸻

7. Apps Script trust boundary

7.1 Current state

CURRENT / IMPLEMENTED — HARDENING REQUIRED

The current Apps Script web application is configured as an anonymous web app executed as the deploying user.

The Node application posts action payloads to that endpoint.

This creates a significant application-level trust-boundary gap because the endpoint accepts actions for CRM writes and Gmail delivery.

The current action contract does not yet provide adequate application-level authentication.

This is a production-hardening concern.

It is not a reason to redesign the Apps Script architecture.

⸻

7.2 Highest-priority existing hardening work

The first production-hardening change should authenticate and validate the existing Node → Apps Script action boundary.

The intended incremental direction is:

* require a server-side shared secret;
* store it in Render environment variables and Apps Script Script Properties;
* authenticate before action routing;
* remove any hard-coded production endpoint fallback;
* ensure secrets are never logged;
* standardize success/error/unauthorized responses.

The Apps Script web-app deployment may need to remain anonymously reachable if Render is not using OAuth.

Application-level authentication is therefore the appropriate incremental boundary.

⸻

8. Legacy abandoned-booking workflow

8.1 Current repository state

CURRENT / IMPLEMENTED CODE — DEPRECATED ARCHITECTURALLY

google-apps-script/AbandonedBookings.js contains the prior Apps Script-based abandoned-booking workflow.

It is architecturally inconsistent with the current rule that:

Render owns lifecycle decisions.

The legacy script independently determines whether an abandoned booking exists, changes CRM data, and attempts to notify Render.

Repository code alone is not proof that a deployed Apps Script time-driven trigger currently invokes it.

Before retirement:

1. verify the deployed Apps Script project;
2. verify whether a time-driven trigger exists;
3. confirm the Render workflow is the intended active path;
4. disable/retire the legacy trigger if it is active;
5. only then remove or deprecate the legacy implementation.

Do not claim that the legacy trigger is active without deployment evidence.

⸻

9. Abandoned-booking workflow

9.1 Current Render workflow

CURRENT / IMPLEMENTED

The current abandoned-booking workflow is:

Pending Booking
      ↓
Elapsed time > 30 minutes
      ↓
Render detection
      ↓
CRM update
      ↓
LINE sales-recovery alert

The eligibility condition is strictly:

elapsedMs > 30 minutes

not greater-than-or-equal-to 30 minutes.

The business decision belongs entirely to Render.

⸻

9.2 Current reliability gap

CURRENT GAP

The current sequence is not durably idempotent.

The workflow sends the LINE alert before the CRM status update completes.

If the CRM update fails after the notification succeeds, the same client can remain eligible and be notified again on a subsequent scheduler cycle.

Durable duplicate-alert prevention remains required.

It should follow authentication and hardening of the Node → Apps Script action contract.

⸻

10. Client lifecycle architecture

10.1 Intended complete lifecycle

The intended complete lifecycle is:

Tally #1
   ↓
Client Profile Created
   ↓
Pending Booking
   ↓
Free Intro Booking
   ↓
Booking Context + Diagnostic Data
   ↓
Confirmed
   ↓
Intro Meeting
   ↓
Meeting Ended
   ↓
Personalized Tally #2
   ↓
Package Selection
   ↓
Payment
   ↓
Sessions
   ↓
Booking Management
   ↓
Cancellation / Recovery

Render owns the business interpretation of these transitions.

⸻

10.2 Abandoned booking lifecycle

Tally #1
   ↓
Client Profile Created
   ↓
Pending Booking
   ↓
30+ minutes
   ↓
Render Detection
   ↓
Follow-up Needed
   ↓
CRM Update
   ↓
LINE Sales-Recovery Alert

The exact current eligibility implementation is:

elapsedMs > 30 minutes

⸻

10.3 Cancellation lifecycle

Confirmed
   ↓
Cal.com Cancellation
   ↓
Render
   ↓
Identify Client
   ↓
Retrieve Client Context
   ↓
CRM Update
   ├── Cancellation Status
   └── Cancellation Reason
   ↓
LINE Cancellation Alert
   ↓
Recovery Opportunity

Render owns the business interpretation.

⸻

10.4 Future payment lifecycle

Future payment integration should follow the same architectural boundary:

Payment Event
   ↓
Render
   ↓
Identify Client
   ↓
Determine Package
   ↓
Determine Payment State
   ↓
Update CRM
   ↓
Calculate / Confirm Credits
   ↓
Trigger Next Lifecycle Event

The payment provider may remain an external event source while Render owns the business interpretation.

⸻

10.5 Future session lifecycle

The same architecture can support:

Session Scheduled
       ↓
Session Completed
       ↓
Credit Used
       ↓
CRM Updated
       ↓
Remaining Credits Calculated
       ↓
Next Booking / Follow-Up

This provides the foundation for a complete client-management engine.

⸻

11. Event and integration reliability gaps

The following are known architectural gaps and should be addressed incrementally rather than through broad redesign.

Tally / Cal.com event handling

The current system does not yet have complete webhook signature verification or event-ID deduplication for all relevant Tally and Cal.com deliveries.

Provider retries can therefore potentially repeat notifications, CRM upserts, or other actions.

Abandoned-booking idempotency

The current abandoned-booking workflow needs durable duplicate prevention.

Apps Script responses

Apps Script response handling should eventually be standardized with predictable success/error semantics.

Email ownership

Email template selection currently occurs through the Apps Script get_template action.

The longer-term architecture should move email template selection, personalization, and HTML generation toward Render while retaining Gmail delivery in Apps Script.

Duplicate sendClientEmail

Code.js and Email.js currently contain duplicate sendClientEmail implementations.

This is a known cleanup concern and should be handled as a focused change.

Automated testing

Automated tests, event fixtures, contract tests, and a formal test script remain identified gaps.

⸻

12. AI development system

12.1 Architectural role of AI

AI agents operate around the production system.

They do not replace the production system's business-logic boundaries.

The AI development system consists of the following proposed/target architecture:

PROPOSED / TARGET

Kyle
↓
ChatGPT
↓
Qwen Router
↓
ACP
↓
Specialist AI Lane
↓
Kilo
↓
GitHub / CI
↓
Verification / Persistence
↓
Execution Report
↓
ChatGPT
↓
Kyle

The specialist layer contains three distinct lanes:

* Gemini — Architect / Planner / Reviewer
* Security AI — Security Specialist
* Utility AI — General Utility Specialist

Kilo remains the primary Builder / Implementer / Tester.

Label this entire multi-agent architecture:

PROPOSED / TARGET

Do not describe unimplemented components as currently operational.

⸻

12.2 Kyle — Director / Final Authority

PROPOSED / TARGET

Kyle is the final human authority.

AI agents operate within explicitly defined roles and explicitly authorized boundaries.

No AI may independently redefine the overall architecture or expand its own authority.

⸻

12.3 ChatGPT — Control / Human-Facing Interface

PROPOSED / TARGET

ChatGPT is the primary human-facing development control/interface.

Responsibilities include:

* receiving Kyle's requests;
* understanding the overall system;
* coordinating specialist AI lanes;
* initiating authorized development workflows;
* interacting with connected development infrastructure when explicitly authorized;
* interpreting verified execution reports;
* presenting results and decisions to Kyle.

ChatGPT is NOT the architecture authority.

Gemini holds the Architect / Planner / Reviewer role.

ChatGPT must rely on verified execution results rather than claiming successful execution based on assumptions.

Future requirement: a dedicated hardcoded ChatGPT AI control/operating policy defining:

* role;
* authority;
* limitations;
* execution boundaries;
* escalation to Gemini;
* use of Kilo;
* security-review requirements;
* secret handling;
* verification requirements;
* reliance on execution reports;
* Kyle's final authority.

Do not create that policy file during this task unless it already exists.

⸻

12.4 Qwen — Router

PROPOSED / TARGET

Qwen is the lightweight Router / task dispatcher.

Qwen's purpose is to classify incoming development requests and determine the appropriate specialist lane.

Qwen may route requests toward:

* Gemini;
* Security AI;
* Utility AI.

For execution work, Qwen uses the existing ACP command structure.

Qwen is NOT:

* the primary implementer;
* the architecture authority;
* the security authority;
* a replacement for Gemini;
* a replacement for Kilo.

Qwen must not bypass ACP or issue unrestricted shell/Git instructions.

The Qwen model-size decision remains:

UNDER VALIDATION

Do not claim that a larger Qwen model has been implemented unless verified.

⸻

12.5 ACP — Formal Command Boundary

PROPOSED / TARGET

The existing ACP specification (Section 16.3) remains the canonical command protocol.

Do not invent a second competing protocol.

The formal boundary is:

Qwen
↓
ACP command
↓
Authorized specialist / execution lane

The ACP command must establish the authorized context, including as applicable:

* originator;
* intended target;
* repository;
* base branch;
* permitted task;
* constraints;
* verification requirements;
* reporting requirements.

Anything outside the authorized ACP command is out of scope.

⸻

12.6 Gemini — Architect / Planner / Reviewer

PROPOSED / TARGET

Gemini replaces the previously proposed NVIDIA Nemotron role.

Gemini is the higher-reasoning architectural and planning specialist.

Responsibilities include:

* architecture;
* system design;
* implementation planning;
* complex technical reasoning;
* difficult debugging analysis;
* research;
* reviewing proposed implementations;
* technical review.

Gemini provides architectural/technical direction.

Gemini does not replace Kilo as the primary repository Builder / Implementer / Tester.

⸻

12.7 Security AI — Security Specialist

PROPOSED / TARGET

Define an independent Security AI lane.

Its purpose is dedicated security analysis and security-focused work.

Responsibilities may include:

* vulnerability analysis;
* secrets and credential exposure review;
* authentication/authorization review;
* dependency/security review;
* security-focused implementation;
* security verification.

The Security AI should remain conceptually independent from the AI that designs the implementation.

Do not invent a specific security product, model, endpoint, integration, or implementation unless one already exists in the repository.

Activation Model

The Security Specialist is activated based on risk classification of the task or code change under review. Three risk tiers govern activation:

* Mandatory — Security Specialist review is required before the task may proceed to implementation. Applies to: authentication/authorization changes, credential handling, secrets management, cross-system trust boundaries, cryptographic operations, security-critical infrastructure changes, and any task explicitly flagged with security_review_required: true in the ACP command.
* Conditional — Security Specialist review is triggered when the task touches areas with elevated security surface area. Applies to: webhook endpoint modifications, API contract changes, data persistence layer changes, dependency updates, CI/CD pipeline modifications, and any task where security_audit_context indicates relevant security concerns.
* Advisory — Security Specialist may be consulted at the discretion of the routing layer (Qwen) or the Architect (Gemini) for general security hygiene, best-practice validation, or when the task author requests a security perspective.

Authority Model

The Security Specialist operates as an advisory and gatekeeping authority, not an implementation authority.

* Advisory Authority — The Security Specialist produces a Security Audit Report containing findings, risk ratings, and recommendations. This report informs the Architect (Gemini) and the Director (Kyle) but does not itself authorize or block commits.
* Gatekeeping Authority — For Mandatory-tier tasks, the Security Specialist must complete its review and produce a Security Audit Report before the ACP command for implementation may be issued to Kilo. The Orchestrator (or routing layer) enforces this gate by requiring the Security Audit Report as a precondition for the implementation ACP command.
* No Implementation Authority — The Security Specialist does not write production code, modify files, or execute implementation tasks. Its output is a structured Security Audit Report consumed by the Architect and the Orchestrator.

Risk-Based Activation Criteria (Mandatory / Conditional / Advisory)

| Tier | Trigger | Examples | Gate |
|------|---------|----------|------|
| Mandatory | security_review_required: true in ACP command; auth/credential/secrets changes; cross-system trust boundary modifications; cryptographic operations | Apps Script authentication hardening (ADR-004), ACP authorization changes, webhook secret handling, encryption/decryption logic | Implementation ACP command blocked until Security Audit Report produced |
| Conditional | security_audit_context indicates relevant concerns; webhook/API/persistence/CI/CD changes; dependency updates | New webhook endpoint, Cal.com/Tally event handling changes, CRM schema migration, GitHub Actions workflow modifications, npm dependency upgrades | Implementation ACP command may proceed with Security Specialist consultation; report produced in parallel |
| Advisory | General security hygiene requests; best-practice validation; routing layer or Architect discretion | Documentation security review, utility script review, low-risk refactoring | No gate; Security Specialist consulted optionally |

Open Architectural Decisions (Security Specialist)

The following three decisions remain OPEN and are not resolved by this architectural foundation. They are documented here to preserve the open state and prevent premature closure.

1. Qwen Router Trigger Logic Refinement
   - The exact logic by which the Qwen Router determines Security Specialist activation (Mandatory/Conditional/Advisory) is not yet finalized.
   - Current approach: risk classification based on ACP fields (security_review_required, security_audit_context) and task-type heuristics.
   - Open questions: Should Qwen use a rule engine, a model-based classifier, or a hybrid? How are false positives/negatives handled? Who owns the rule set?

2. Security Audit Report Persistence Mechanism
   - The format, storage location, and retrieval mechanism for Security Audit Reports within `docs/ai/` is not yet defined.
   - Candidates: dedicated `docs/ai/security-audits/` directory with structured JSON/Markdown reports; integration into `STATE.md` or `ARCH_DECISIONS.md`; external artifact store with references in `docs/ai/`.
   - Open questions: Report schema, versioning, retention, searchability, and correlation with ACP request_id.

3. Security Specialist Callback Mechanism to Orchestrator
   - The mechanism by which the Security Specialist returns its Security Audit Report to the Orchestrator (or routing layer) and signals gate completion is not yet defined.
   - Candidates: ACP execution report extension; dedicated webhook/callback endpoint; polling-based status check; file-based signal in `docs/ai/`.
   - Open questions: Synchronous vs asynchronous callback; timeout and retry semantics; how the Orchestrator correlates the report with the pending implementation ACP command.

These open decisions are explicitly PROPOSED / TARGET. Do not claim they are implemented. They will be resolved through future authorized architectural work.

⸻

12.8 Utility AI — General Utility Specialist

PROPOSED / TARGET

Add a General Utility Specialist lane.

Its purpose is to handle low-complexity, repetitive, or routine tasks without unnecessarily consuming the resources of a higher-reasoning model.

Examples include:

* documentation cleanup;
* formatting;
* simple transformations;
* extraction;
* boilerplate;
* repetitive maintenance;
* straightforward data manipulation;
* other low-complexity utility work.

The Utility AI should be described as a ROLE, not tied to a specific model yet.

Its existence allows Qwen to route simple work away from Gemini when advanced architectural reasoning is unnecessary.

Do not give Utility AI architectural authority.

Do not give Utility AI unrestricted repository authority.

⸻

12.9 Kilo — Builder / Implementer / Tester

CURRENT / IMPLEMENTED AS DEVELOPMENT ROLE + PROPOSED / TARGET EXTENSIONS

Kilo is the primary execution agent.

Kilo is responsible for:

* repository inspection;
* implementation;
* testing;
* verification;
* reporting execution results.

Kilo must obey:

* AGENTS.md;
* existing architecture;
* the authorized ACP command;
* task constraints.

Kilo must:

* inspect before modifying;
* make the smallest appropriate change;
* preserve unrelated functionality;
* protect credentials and secrets;
* stay within authorized scope.

Kilo must not independently redefine architecture.

Kilo must not modify AGENTS.md unless explicitly authorized by a future task.

Kilo must not modify protected architectural components without authorization.

Kilo must not modify GitHub Actions merely because an agent task involves execution.

Kilo may commit and push only when the ACP command explicitly authorizes it.

⸻

12.10 GitHub / CI — Source of Truth

PROPOSED / TARGET

GitHub remains the persistent source of truth for repository state.

AI sessions may be temporary, but repository state, commits, diffs, and CI results provide persistent verification.

Document GitHub / CI as the persistence and mechanical verification layer.

⸻

12.11 Execution Report

PROPOSED / TARGET

The normal execution return path is:

Kilo
↓
ACP execution report
↓
Qwen
↓
ChatGPT
↓
Kyle

The execution report, rather than an AI's assumption, is the authoritative execution result.

The report must distinguish at minimum:

* success;
* failure;
* blocked;
* changed files;
* verification results;
* commit;
* push;
* blockers.

⸻

13. Standard development loop

PROPOSED / TARGET

Normal development follows:

Qwen
↓
ACP
↓
Appropriate Specialist
↓
Kilo
↓
GitHub / CI
↓
Verification
↓
Execution Report

Kilo is the primary Builder / Implementer / Tester.

Specialist routing:

* Gemini — Architect / Planner / Reviewer (architecture, planning, review)
* Security AI — Security Specialist (vulnerability analysis, secrets review, auth review)
* Utility AI — General Utility Specialist (documentation, formatting, boilerplate, simple transformations)

Qwen routes to the appropriate specialist. For implementation tasks, the flow proceeds through ACP to Kilo.

⸻

14. Proposed target AI architecture

14.1 Objective

PROPOSED / TARGET

The long-term user experience is:

Kyle should be able to use LINE as the single natural-language control interface for the system.

Examples:

"Give me this week's bookings."
"Add this feature to the CRM."
"Here's what I'm thinking for a system to automate lesson planning..."

Kyle should not need to manually move between:

* LINE;
* ChatGPT — Control / Human-Facing Interface;
* Qwen — Router;
* Gemini — Architect / Planner / Reviewer;
* Security AI — Security Specialist;
* Utility AI — General Utility Specialist;
* Kilo — Builder / Implementer / Tester;
* GitHub / CI — Source of Truth;
* Render;
* Google Apps Script;
* other AI tools.

The underlying agents and services should operate behind the LINE interface.

⸻

14.2 Target architecture

Kyle
↓
ChatGPT
↓
Qwen Router
↓
ACP
↓
Specialist AI Lane
↓
Kilo
↓
GitHub / CI
↓
Verification / Persistence
↓
Execution Report
↓
ChatGPT
↓
Kyle

The specialist layer contains three distinct lanes:

* Gemini — Architect / Planner / Reviewer
* Security AI — Security Specialist
* Utility AI — General Utility Specialist

Kilo remains the primary Builder / Implementer / Tester.

GitHub Actions may serve as an ephemeral AI execution plane within this architecture.

It does not replace Render as the production application server.

Render / Node.js remains the production business-logic layer.
Google Apps Script remains the Google-specific adapter.
Existing workflows → Sheets / Gmail.

⸻

15. LINE

15.1 Role

PROPOSED / TARGET

LINE is a notification channel.

Existing operational notifications may continue.

Future notification types may be added.

LINE is not the primary AI development control channel and is not required for the AI development architecture to operate.

ChatGPT is the primary human-facing development control/interface (see Section 12.3).

⸻

15.2 Synchronous tasks

PROPOSED / TARGET

Simple requests may eventually follow:

ChatGPT
↓
Qwen Router
↓
ACP
↓
Approved read capability
↓
Existing production system
↓
Result
↓
ChatGPT
↓
LINE (notification)

Example:

"Give me this week's bookings."

⸻

15.3 Asynchronous tasks

PROPOSED / TARGET

Longer tasks should follow:

ChatGPT
↓
Qwen Router
↓
ACP
↓
Specialist AI Lane
↓
Kilo
↓
GitHub / CI
↓
Verification
↓
Execution Report
↓
ChatGPT
↓
LINE (notification)

The architecture must eventually account for:

* task state;
* conversation context;
* correlation IDs;
* retries;
* idempotency;
* timeouts;
* failures;
* long-running tasks.

These mechanisms are PROPOSED / TARGET, not claims of current implementation.

⸻16. Agent Command Protocol

16.1 Role

PROPOSED / TARGET

The Agent Command Protocol (ACP) will provide the structured boundary between AI orchestration and approved system capabilities.

Conceptually:

AI orchestration
      ↓
Structured Agent Command
      ↓
Authentication / Authorization
      ↓
Approved Capability
      ↓
Existing Application / Service
      ↓
Structured Result
      ↓
AI orchestration

The AI layer should not directly manipulate production systems when an approved capability can provide the required operation.

⸻

16.2 ACP responsibilities

The eventual ACP should define:

* command identity;
* command type;
* validated parameters;
* correlation ID;
* idempotency key where required;
* authentication context;
* authorization;
* structured result;
* structured error;
* retry semantics;
* execution status;
* logging requirements.

The detailed ACP schema is not yet defined.

It is the next architectural design task after this document is approved.

⸻

16.3 Proposed Agent Command Protocol (ACP)

PROPOSED / TARGET — DOCUMENTARY ONLY

This section is proposed and documentary only. ACP is not currently implemented. No production code, endpoints, workflows, dependencies, or services are introduced by this specification.

* ACP is proposed/documentary only.
* Render/OpenClaw remains the production orchestration layer.
* Kilo Cloud Agent remains an external execution lane.
* ACP does not execute code by itself.
* ACP does not replace GitHub Actions or Gemini.
* Credentials, tokens, and secrets must not be included in task content.
* No production code is changed by this documentation task.

⸻

Purpose

The Agent Command Protocol (ACP) defines a structured envelope for handing an approved task from AI orchestration to an execution lane such as the Kilo Cloud Agent.

The purpose is to make the handoff explicit, auditable, and bounded. ACP carries the intent, repository context, constraints, and verification expectations for a discrete unit of work. It is a description of what should happen, not an executor of it.

The execution lane decides how to perform the task within its own authority and returns a structured execution report.

⸻

Required command fields

A proposed ACP command envelope contains these required fields:

* protocol_version — version of the ACP envelope definition in use.
* request_id — a unique, client-generated identifier for this command.
* source — the originating orchestration component (e.g. the AI router or OpenClaw).
* target — the intended recipient execution lane (e.g. Kilo Cloud Agent).
* task_type — the category of work being requested (e.g. implementation, remediation, refactoring).
* repository — the repository the task applies to (e.g. fluentwithkyle/openclaw-webhook).
* base_branch — the branch the task is based on and intended to integrate with.
* task — the description of the work to be performed. Must not include credentials, tokens, or secrets.
* constraints — the operational limits or rules the execution lane must respect, including a permitted_paths allow-list that defines the repository paths the execution lane may operate within.
* authorization — the authorization context defining the explicit capability set the execution lane is permitted to use for this command. Capabilities are explicit permissions, never implied.
* verification — the expected verification to be performed and reported (e.g. targeted checks, tests).
* reporting — how the execution report should be delivered back to the orchestrator.

All field values are proposed placeholders until the ACP is reviewed, approved, and implemented.

⸻

Optional Security Fields

The following optional fields extend the ACP command envelope to support the Security Specialist activation model (Section 12.7). They are not required for all commands but enable risk-based security review routing when present.

* security_review_required (boolean, optional) — When true, explicitly signals that the task requires Mandatory-tier Security Specialist review before implementation may proceed. This field directly maps to the Mandatory activation tier. Default: false / absent. When true, the Orchestrator must enforce the gate: the implementation ACP command must not be issued until a Security Audit Report is produced and available.
* security_audit_context (object, optional) — Provides structured context to guide Conditional-tier Security Specialist activation. Contains zero or more of the following properties:
  - touch_points: array of strings identifying architectural surfaces affected (e.g., "webhook-endpoint", "auth-boundary", "data-persistence", "ci-cd-pipeline", "dependency-update", "api-contract").
  - risk_indicators: array of strings describing specific security concerns (e.g., "credential-handling", "cross-system-trust", "cryptographic-operation", "input-validation", "authorization-logic").
  - requested_focus: array of strings requesting specific Security Specialist focus areas (e.g., "secrets-exposure", "auth-review", "dependency-audit", "vulnerability-scan").
  - prior_audit_ref: string referencing a prior Security Audit Report request_id for incremental review.

These fields are optional. Their absence does not imply a security review is unnecessary; the routing layer (Qwen) may still classify a task as Conditional or Advisory based on task_type, target paths, or heuristics. The presence of security_review_required: true creates a hard gate; the presence of security_audit_context creates a Conditional trigger; the absence of both leaves activation to routing-layer discretion (Advisory).

⸻

Authorization capabilities

The authorization field defines an explicit, machine-readable capability set. Each capability grants permission for a specific class of operation. Capabilities are explicit permissions; they are never implied by one another.

Defined capability types:

* read_only — inspect repository contents and run read-only commands (e.g. ls, cat, grep, git diff).
* modify_files — create, edit, or delete files within the authorized repository and permitted_paths.
* run_tests — execute the project's defined test, lint, or typecheck commands.
* commit — create and amend local commits within the authorized base_branch.
* push — push commits to the authorized remote/repository and branch.

Authorization principle:

* A command authorized for one capability does not automatically authorize any other capability.
* For example, modify_files does not authorize commit or push; commit does not authorize push; run_tests does not authorize modify_files.
* Every capability the execution lane may exercise must be explicitly granted.
* A valid authorization token or capability set never grants unrestricted repository access beyond the explicitly listed capabilities.

Permitted repository scope

The constraints field must include a permitted_paths allow-list that explicitly defines which paths within the repository the execution lane may operate on. This is the permitted repository scope for the command.

Rules:

* The execution lane may operate only within paths present in the permitted_paths allow-list.
* A valid authorization token/capability does NOT grant unrestricted repository access.
* Anything outside the authorized paths or the authorized capabilities is out of scope and must be rejected or reported as blocked.
* Path scoping and capability scoping are independent controls; both must pass.

⸻

Execution boundaries

ACP is a structured contract, not an execution engine.

Specific boundaries:

* ACP does not execute code by itself. An explicitly addressed execution lane performs the work.
* ACP does not replace GitHub Actions or Gemini. Each remains an independent agent or execution lane within the target architecture.
* Render/OpenClaw remains the production orchestration layer. The production webhook and business-logic layer is not relocated into an AI lane.
* Kilo Cloud Agent remains an external execution lane; it is not folded into the production Render application.
* ACP does not perform authentication itself. Authentication and authorization are enforced by the addressed execution lane and/or the orchestrating layer before a command is honored.
* Credentials, tokens, and secrets must not be included in task content. They are supplied and rotated outside the ACP envelope, by the execution lane, scoped to the minimum required capabilities.
* No production code is changed by this documentation task.

⸻

Illustrative example

The following is a minimal, non-executable, placeholder-only ACP command envelope for a Kilo implementation request. Values are illustrative placeholders and must not be used as live configuration.

```json
{
  "protocol_version": "0.1",
  "request_id": "acp-placeholder-request-id-0000000",
  "source": "OpenClaw-orchestrator-placeholder",
  "target": "Kilo Cloud Agent-placeholder",
  "task_type": "implementation-placeholder",
  "repository": "fluentwithkyle/openclaw-webhook-placeholder",
  "base_branch": "main-placeholder",
  "task": "Implement placeholder task description only.",
  "constraints": {
    "permitted_paths": [
      "src/",
      "tests/"
    ],
    "rules": [
      "smallest-change-placeholder",
      "no-new-dependencies-placeholder"
    ]
  },
  "authorization": {
    "capabilities": [
      "read_only",
      "modify_files",
      "run_tests"
    ]
  },
  "verification": "git diff --check and targeted review-placeholder",
  "reporting": "structured execution report placeholder"
}
```

This example is non-executable. It defines shape, not behavior. No service should parse or act on it.

⸻

Execution report

After the addressed execution lane completes a command, it returns an execution report. A proposed report contains these required fields:

* request_id — the request_id of the command being reported on.
* status — the outcome (e.g. completed, failed, blocked).
* changed_files — the list of files modified, if any.
* verification — the verification actually performed and its result.
* commit — the commit reference produced, if any (null when none is produced).
* push — whether a commit was pushed (false by default; pushing requires explicit authorization).
* blockers — any outstanding issues, failures, or reasons the task could not complete.

Commit and push do not happen automatically. Pushing requires explicit authorization outside the envelope and must never be inferred from the task alone.

⸻

16.4 Qwen Router → Kilo Execution Boundary

PROPOSED / TARGET

This section defines the execution boundary between the Qwen Router and Kilo. It is documentary only; no production code, endpoints, workflows, dependencies, or services are introduced by this addition.

The boundary flow:

Qwen Router
↓
ACP command
↓
Kilo
↓
GitHub / CI
↓
Verification / Persistence
↓
ACP execution report
↓
Qwen Router
↓
ChatGPT
↓
Kyle

Qwen Router

The Qwen Router is the request-routing layer only.

* Routes development requests to the appropriate specialist lane (Gemini, Security AI, Utility AI).
* For execution work, constructs an ACP command for Kilo.
* Does not implement repository changes.
* Does not redefine architecture.
* Does not bypass ACP.
* Does not issue unrestricted shell/Git instructions.
* Does not provide secrets or credentials.
* Does not claim successful execution without a Kilo execution report.

Kilo

Kilo is the Builder / Implementer / Tester.

* Builder / Implementer / Tester.
* Receives an authorized ACP command.
* Inspects, implements, tests, verifies, and reports.
* Follows AGENTS.md, ARCHITECTURE.md, and ACP constraints.

ACP Boundary

The handoff from Qwen to Kilo is mediated exclusively through the ACP command defined in section 16.3.

* Qwen → ACP command → Kilo.
* Section 16.3 remains the canonical ACP protocol.
* Do not create a second protocol.
* Authorization must establish originator, target, repository, base branch, task, capabilities, permitted_paths, verification, and reporting requirements.

Repository Safety

Kilo must:

* Inspect before modifying.
* Stay within authorized scope (capabilities and permitted_paths).
* Make the smallest appropriate change.
* Preserve unrelated functionality.
* Never expose secrets.
* Never modify AGENTS.md unless explicitly authorized.
* Never modify GitHub Actions merely because Kilo is involved.
* Never commit or push unless explicitly authorized by ACP.

Execution Report

Kilo returns the execution result through the ACP execution report back to the Qwen Router.

Kilo → ACP execution report → Qwen Router → ChatGPT → Kyle.

The report must distinguish:

* success;
* failure;
* blocked;
* changed files;
* verification results;
* commit;
* push;
* blockers.

Qwen treats the Kilo execution report as the execution result.

OpenClaw Independence

The Qwen → Kilo boundary does not depend on OpenClaw.

OpenClaw may later provide transport, message routing, event orchestration, LINE integration, or automated invocation, but must not alter the ACP command contract.

Production Boundary

The AI development lane must not move production business logic out of Render or Google-specific operations out of Google Apps Script.

⸻16.5 Kilo Cloud Agent HTTP Trigger & Security Boundary

The Kilo Cloud Agent supports external HTTP webhook triggers as a transport mechanism for task execution.

16.5.1 Kilo Trigger Authentication

The Kilo HTTP trigger authenticates/authorizes the external caller to invoke the configured Cloud Agent trigger. The trigger URL and any optional shared-secret authentication material are credentials.

Therefore:
* never commit them;
* never place them in source code;
* never place them in ARCHITECTURE.md;
* never expose them in GitHub issues/comments;
* never include them in ordinary execution reports;
* store them only in the appropriate secret/configuration mechanism.

16.5.2 ACP Task Authorization

Successful invocation of the Kilo trigger does NOT authorize arbitrary repository activity. The ACP command remains the task-level authorization boundary.

The ACP request must explicitly define:
* permitted repository paths;
* permitted capabilities;
* task scope;
* verification requirements;
* reporting requirements.

Capabilities remain independent. For example, read_only does not authorize file modification, and modify_files does not authorize commit. No capability may be inferred from another capability. A valid Kilo trigger credential must never be treated as permission to bypass ACP authorization.

16.5.3 Fail-Closed Requirements

The execution lane must fail closed when:
* the ACP command is malformed;
* required ACP fields are missing;
* the request contains unknown/unauthorized capabilities;
* requested paths fall outside permitted_paths;
* authorization is inconsistent with the requested task;
* the task attempts an operation not covered by the granted capabilities;
* required authentication material is missing or invalid;
* the execution boundary cannot independently verify the authorization.

16.5.4 POC Security Boundary

The intended first ACP → Kilo POC scope is:
* read-only only;
* permitted_paths limited to poc/;
* no arbitrary shell-command execution supplied by the caller;
* no file modification, commit, or push;
* no production-system access;
* no Qwen dependency;
* no OpenClaw dependency.

The POC exists to validate the execution boundary and structured reporting before introducing write capabilities.

16.5.5 One-Shot Execution / Auditability

Each Kilo execution must be self-contained. The authorization required for an execution must be present in that individual ACP command; do not rely on permissions being remembered from a previous agent session. Each execution should be traceable through request_id.

The execution result should provide a structured report containing, at minimum, the request identity, status, task, execution/result information, and any relevant verification outcome. Do not expose secrets in the report.

16.5.6 Architectural Status

The Kilo Cloud Agent HTTP webhook trigger is a confirmed Kilo capability. The specific ACP → Kilo integration in this repository remains PROPOSED / TARGET until implemented and validated.

⸻

17. AI specialist roles

17.1 Gemini — Architect / Planner / Reviewer

PROPOSED / TARGET

Gemini is the higher-reasoning architectural and planning specialist.

Responsibilities include:

* architecture;
* system design;
* implementation planning;
* complex technical reasoning;
* difficult debugging analysis;
* research;
* reviewing proposed implementations;
* technical review.

Gemini provides architectural/technical direction.

Gemini does not replace Kilo as the primary repository Builder / Implementer / Tester.

Typical delegation:

"Analyze this architecture."
"Research the best approach."
"Review this implementation."
"Identify integration risks."
"Produce an implementation plan."

⸻

17.2 Security AI — Security Specialist

PROPOSED / TARGET

Define an independent Security AI lane.

Its purpose is dedicated security analysis and security-focused work.

Responsibilities may include:

* vulnerability analysis;
* secrets and credential exposure review;
* authentication/authorization review;
* dependency/security review;
* security-focused implementation;
* security verification.

The Security AI should remain conceptually independent from the AI that designs the implementation.

Do not invent a specific security product, model, endpoint, integration, or implementation unless one already exists in the repository.

Activation Model

The Security Specialist is activated based on risk classification of the task or code change under review. Three risk tiers govern activation (detailed in Section 12.7):

* Mandatory — Security Specialist review required before implementation may proceed. Triggered by security_review_required: true in ACP command, or auth/credential/secrets/trust-boundary/cryptographic changes.
* Conditional — Security Specialist review triggered when task touches elevated security surface area. Triggered by security_audit_context indicating relevant concerns, or webhook/API/persistence/CI/CD/dependency changes.
* Advisory — Security Specialist consulted at discretion of routing layer (Qwen) or Architect (Gemini) for general security hygiene.

Authority Model

The Security Specialist operates as an advisory and gatekeeping authority, not an implementation authority.

* Advisory Authority — Produces a Security Audit Report with findings, risk ratings, and recommendations. Informs Architect (Gemini) and Director (Kyle) but does not authorize or block commits directly.
* Gatekeeping Authority — For Mandatory-tier tasks, the Security Specialist must complete review and produce a Security Audit Report before the implementation ACP command may be issued to Kilo. The Orchestrator enforces this gate.
* No Implementation Authority — Does not write production code, modify files, or execute implementation tasks. Output is a structured Security Audit Report.

Open Architectural Decisions

Three open decisions remain (detailed in Section 12.7):
1. Qwen Router Trigger Logic Refinement
2. Security Audit Report Persistence Mechanism
3. Security Specialist Callback Mechanism to Orchestrator

Typical delegation:

"Review this code for vulnerabilities."
"Analyze secrets exposure risk."
"Audit authentication implementation."
"Check dependency security."

⸻

17.3 Utility AI — General Utility Specialist

PROPOSED / TARGET

Add a General Utility Specialist lane.

Its purpose is to handle low-complexity, repetitive, or routine tasks without unnecessarily consuming the resources of a higher-reasoning model.

Examples include:

* documentation cleanup;
* formatting;
* simple transformations;
* extraction;
* boilerplate;
* repetitive maintenance;
* straightforward data manipulation;
* other low-complexity utility work.

The Utility AI should be described as a ROLE, not tied to a specific model yet.

Its existence allows Qwen to route simple work away from Gemini when advanced architectural reasoning is unnecessary.

Do not give Utility AI architectural authority.

Do not give Utility AI unrestricted repository authority.

Typical delegation:

"Clean up this documentation."
"Format these files."
"Extract data from this file."
"Generate boilerplate code."

⸻

17.4 Kilo — Builder / Implementer / Tester

CURRENT / IMPLEMENTED AS DEVELOPMENT ROLE + PROPOSED / TARGET EXTENSIONS

Kilo is the primary execution agent.

Kilo is responsible for:

* repository inspection;
* implementation;
* testing;
* verification;
* reporting execution results.

Kilo must obey:

* AGENTS.md;
* existing architecture;
* the authorized ACP command;
* task constraints.

Kilo must:

* inspect before modifying;
* make the smallest appropriate change;
* preserve unrelated functionality;
* protect credentials and secrets;
* stay within authorized scope.

Kilo must not independently redefine architecture.

Kilo must not modify AGENTS.md unless explicitly authorized by a future task.

Kilo must not modify protected architectural components without authorization.

Kilo must not modify GitHub Actions merely because an agent task involves execution.

Kilo may commit and push only when the ACP command explicitly authorizes it.

Typical delegation:

"Implement this feature."
"Fix this bug."
"Run the tests and resolve the failure."
"Update the CRM workflow."

⸻

17.5 Qwen — Router

UNDER VALIDATION

Qwen is a candidate low-cost router/task dispatcher.

It must not initially be treated as a fully autonomous reasoning or coding agent.

Qwen's purpose is to classify incoming development requests and determine the appropriate specialist lane.

Qwen may route requests toward:

* Gemini;
* Security AI;
* Utility AI.

For execution work, Qwen uses the existing ACP command structure.

Qwen is NOT:

* the primary implementer;
* the architecture authority;
* the security authority;
* a replacement for Gemini;
* a replacement for Kilo.

Qwen must not bypass ACP or issue unrestricted shell/Git instructions.

The Qwen model-size decision remains:

UNDER VALIDATION

Do not claim that a larger Qwen model has been implemented unless verified.

18. Failover Architecture

PROPOSED / TARGET

Document failover as an explicit architectural concept.

The purpose of failover is to provide a controlled alternative when an authorized specialist or execution component is unavailable.

Failover must preserve the same ACP command contract and authorization boundaries.

NORMAL EXECUTION

Normal development follows:

Qwen
↓
ACP
↓
Appropriate Specialist
↓
Kilo
↓
GitHub / CI
↓
Verification
↓
Execution Report

Kilo is the primary Builder / Implementer / Tester.

SPECIALIST FAILOVER

If a specialist AI is unavailable or fails, another AI must not silently inherit that specialist's authority.

Any replacement specialist must have an explicitly defined role and must receive an appropriately authorized ACP command.

A specialist failure must produce a clear failure or blocked result when an authorized replacement is unavailable.

BUILDER FAILOVER

Kilo is the primary Builder / Implementer / Tester.

If Kilo is unavailable, fails, or becomes blocked, the system must distinguish:

* Kilo unavailable;
* Kilo execution failure;
* Kilo blocked;
* task requiring human intervention.

A failed execution must never be represented as successful.

Any future alternate Builder must be explicitly defined and authorized rather than implicitly assumed.

ARCHITECT / PLANNER FAILOVER

Gemini is currently the Architect / Planner / Reviewer.

FAILOVER SAFETY

Failover must preserve:

* original task;
* authorized scope;
* repository;
* target branch;
* ACP authorization;
* verification requirements;
* reporting requirements.

Failover must never:

* silently expand permissions;
* bypass ACP;
* grant architecture authority to a Builder;
* grant implementation authority to a Router;
* expose credentials;
* modify protected architecture without authorization;
* claim success without a verified execution report.

NO SILENT FALLBACK

The system must identify when failover occurred.

The execution report must identify:

* which AI actually executed the task;
* whether failover occurred;
* why failover occurred;
* what changed;
* verification results;
* commit/push state;
* blockers.

HUMAN ESCALATION

If the authorized execution path and defined failover options are unavailable, the result is:

BLOCKED

The system reports the blocker to ChatGPT / Kyle rather than inventing an alternate execution path.

CURRENT STATUS

Clearly distinguish:

* currently implemented failover;
* proposed failover;
* unavailable components.

Do not describe proposed failover paths as operational.

Do not modify failover implementation during this task.

⸻

⸻19. OpenClaw's architectural role

19.1 Status

PROPOSED / TARGET

OpenClaw is initially retained as the orchestration/mediation capability.

Its value is not defined merely as "being the server."

Its potentially valuable responsibilities include:

* agent handoffs;
* tool/capability selection;
* task orchestration;
* context management;
* multi-step execution;
* coordinating specialist agents;
* consolidating results.

⸻

19.2 Replaceability

OpenClaw should be treated as a replaceable/pluggable orchestration layer.

The production application must not depend on OpenClaw-specific business logic.

The intended separation is:

Production capabilities
        ↕
       ACP
        ↕
Orchestration layer

OpenClaw can therefore:

* remain central;
* become narrower;
* be replaced;
* or become optional,

without requiring a redesign of the production business system.

⸻

19.3 Independence from Qwen → ACP → Specialist Boundary

PROPOSED / TARGET

Explicitly state that the Qwen → ACP → specialist execution boundary does NOT depend on OpenClaw.

OpenClaw may eventually provide:

* transport;
* message routing;
* event orchestration;
* LINE integration;
* automated invocation.

These are transport/orchestration concerns.

OpenClaw must not alter the ACP command contract or become a prerequisite for the Qwen → specialist boundary.

⸻19. GitHub Actions as AI execution plane

19.1 Role

PROPOSED / TARGET

GitHub Actions may provide ephemeral execution for AI tasks.

It can be used for:

* launching AI tasks;
* running specialist agents;
* repository analysis;
* code changes;
* tests;
* temporary orchestration jobs;
* returning task results.

GitHub Actions should not become:

* the production application server;
* the authoritative CRM;
* the owner of business rules;
* the replacement for Render production workflows.

⸻

19.2 Ephemeral execution principle

GitHub Actions jobs are temporary execution environments.

Persistent task state must therefore exist outside an individual job where required.

Long-running orchestration must account for:

* job limits;
* concurrency;
* retries;
* cancellation;
* result persistence;
* task correlation;
* secrets;
* failure recovery.

These are PROPOSED / TARGET concerns.

20. Production boundaries that do not change

The following boundaries remain authoritative.

Tally

Tally remains an intake/event source.

Cal.com

Cal.com remains a booking/event source.

Render

Render remains the production application and business-logic layer.

Google Apps Script

Apps Script remains the Google-specific adapter.

Google Sheets

Google Sheets remains the current CRM.

Gmail

Gmail remains the email delivery channel.

LINE

LINE remains the communication channel and notification channel.

LINE is not the primary AI development control channel and is not required for the AI development architecture to operate.

ChatGPT is the primary human-facing development control interface (see Section 12.3).

GitHub

GitHub remains the source of truth for code and architecture.

Production workflows

Critical production workflows remain on Render unless a later architectural decision deliberately moves them.

Business rules must not be duplicated inside:

* Qwen;
* GitHub Actions;
* specialist prompts;
* other AI layers.

⸻

21. Security architecture

PROPOSED / TARGET

The AI layer introduces a new trust boundary and must be treated accordingly.

21.1 Credential principle

AI agents must not receive unrestricted production credentials.

Agents should receive only the credentials and capabilities necessary for the task.

⸻

21.2 Capability principle

AI agents should interact with approved capabilities rather than receiving unrestricted direct access to:

* Google Sheets;
* Gmail;
* production state;
* Render internals;
* other production credentials.

⸻

21.3 Cross-system authentication

Cross-system calls should use explicit authentication and authorization.

The exact mechanism is to be determined during ACP design.

HMAC, JWT, or another appropriately scoped mechanism may be evaluated.

⸻

21.4 Write protection

Write-capable commands require:

* structured validation;
* authorization;
* idempotency where appropriate;
* audit logging;
* explicit error handling.

Read-only capabilities should be implemented first.

⸻

22. Task state and reliability

PROPOSED / TARGET

The future AI control plane should maintain explicit task state.

At minimum, the architecture must support:

* request ID;
* correlation ID;
* task status;
* originating LINE interaction;
* selected capability/agent;
* execution result;
* error state;
* retry state;
* timestamps.

Potential states include:

RECEIVED
   ↓
ROUTING
   ↓
QUEUED
   ↓
RUNNING
   ↓
COMPLETED

with failure paths such as:

RUNNING
   ↓
FAILED
   ↓
RETRYING
   ↓
COMPLETED / FAILED

The exact state model is part of future ACP/task-system design.

⸻

23. Scheduled production workflows

CURRENT / IMPLEMENTED + PROPOSED PRESERVATION

Critical scheduled workflows remain on Render during the AI migration.

In particular:

Render
  ↓
abandonedBooking.js

must remain operational independently of the AI orchestration layer.

The fact that GitHub Actions becomes an AI execution plane does not justify moving production scheduling into GitHub Actions.

⸻

24. Migration roadmap

The migration is incremental and non-destructive.

The current production system must remain operational throughout the migration.

⸻

Phase 1 — Read-only LINE proof of concept

PROPOSED / TARGET

Goal:

Allow Kyle to ask simple questions through LINE and receive information from the existing system.

Example:

"Give me this week's bookings."

Architecture:

LINE
 ↓
Render
 ↓
AI/router
 ↓
Read-only capability
 ↓
Existing data
 ↓
Render
 ↓
LINE

Requirements:

* no write operations;
* use existing production boundaries;
* accurate responses;
* task correlation;
* basic error handling.

⸻

Phase 2 — ACP and controlled commands

PROPOSED / TARGET

Define the detailed Agent Command Protocol.

Establish:

* command schemas;
* result schemas;
* authentication;
* authorization;
* validation;
* correlation IDs;
* idempotency;
* logging;
* retry behavior;
* failure handling.

Introduce narrowly scoped capabilities.

⸻

Phase 3 — Controlled write operations

PROPOSED / TARGET

Permit selected write operations only after the command boundary has been validated.

Examples may eventually include:

Update CRM status.
Add CRM information.
Trigger an approved workflow.
Send an approved email.

Every write capability must have an explicit contract and validation boundary.

⸻

Phase 4 — Full multi-agent orchestration

PROPOSED / TARGET

Enable complex tasks involving:

* OpenClaw;
* ChatGPT — Control / Human-Facing Interface;
* Qwen — Router;
* Gemini — Architect / Planner / Reviewer;
* Security AI — Security Specialist;
* Utility AI — General Utility Specialist;
* Kilo — Builder / Implementer / Tester;
* GitHub Actions;
* approved production capabilities.

Example:

Kyle
↓
ChatGPT
↓
Qwen Router
↓
Gemini (architecture analysis)
↓
Kilo (implementation)
↓
Tests
↓
Gemini (review)
↓
Kilo (corrections)
↓
Execution Report
↓
ChatGPT
↓
Kyle
↓
LINE (notification)

The exact orchestration implementation should be determined from the validated ACP and proof-of-concept results.

⸻

25. Existing roadmap after AI architecture approval

The AI architecture does not cancel the existing production-hardening roadmap.

After the architecture is approved, implementation priorities remain approximately:

1. Authenticate and harden the Node → Apps Script action contract.
2. Verify and retire any deployed legacy Apps Script abandoned-booking trigger.
3. Add durable abandoned-booking idempotency.
4. Standardize Apps Script responses and Render error handling.
5. Move email template selection/personalization toward Render while retaining Gmail delivery in Apps Script.
6. Standardize lifecycle states and CRM transition handling.
7. Expand automated testing, fixtures, and contract tests.
8. Continue gradual domain-oriented refactoring.
9. Consider centralized event processing only when justified.
10. Expand the OpenClaw management/orchestration layer deliberately.
11. Build and validate the LINE/AI control plane incrementally.

AI orchestration must not cause these production-hardening requirements to be forgotten.

⸻

26. Intentionally deferred architecture

The following are future directions, not current implementation mandates:

Current workflow-modular system
        ↓
Gradual domain-oriented business modules
        ↓
Centralized event processing
        ↓
OpenClaw management/orchestration layer
        ↓
ACP-based AI capability layer
        ↓
LINE-centered natural-language control
        ↓
More complete client lifecycle automation

Do not introduce:

* an event bus;
* a new persistence system;
* a wholesale CRM replacement;
* broad framework changes;
* unnecessary infrastructure;
* unrestricted agent access;

merely because the target architecture has been defined.

Each transition requires a concrete requirement and review of the existing workflow boundaries.

⸻

27. Next architectural work

After this architecture is approved, the next architectural task is:

Design the Agent Command Protocol against the actual repository.

The ACP design must identify:

* available capabilities;
* existing Render interfaces;
* existing Apps Script actions;
* authentication boundaries;
* command schemas;
* result schemas;
* error schemas;
* idempotency;
* correlation IDs;
* logging;
* LINE integration points;
* Kilo integration points;
* ChatGPT integration points;
* Qwen Router integration points;
* Gemini integration points;
* Security AI integration points;
* Utility AI integration points;
* OpenClaw integration points;
* GitHub Actions execution boundaries.

The ACP design must be grounded in the actual implementation.

Do not invent interfaces that do not exist without explicitly labeling them as new requirements.

Do not implement ACP until its design has been reviewed and approved.

⸻

28. Standard agent operating rules

Before changing code, an agent must:

1. Read ARCHITECTURE.md and GEMINI.md.
2. Inspect the relevant current implementation and interfaces.
3. Determine whether the requested behavior is CURRENT, PROPOSED, UNDER VALIDATION, or DEPRECATED.
4. Identify the smallest change that meets the request.
5. Preserve existing behavior unless the request explicitly changes it.
6. Keep business logic in Render.
7. Keep Google-specific implementation in Apps Script.
8. Avoid unrelated rewrites.
9. Avoid unnecessary dependencies.
10. Preserve established external integration contracts unless a deliberate change is approved.
11. Run focused verification.
12. Update this architecture document when a material architectural boundary or roadmap milestone actually changes.

Agents must not treat roadmap items as permission for broad redesign.

⸻

29. Change discipline and verification

For implementation work:

* Treat the current repository implementation as the source of truth.
* Preserve the Render-owned business-decision boundary.
* Preserve Apps Script as the Google-specific adapter.
* Prefer focused tests and targeted checks.
* Add tests where a change has a clear seam.
* Check imports and exports.
* Check asynchronous behavior.
* Check error handling.
* Check environment variables.
* Check external action payloads.
* Check webhook behavior.
* Check idempotency where applicable.
* Verify external integrations after material changes.
* Update this document only when the architecture or roadmap genuinely changes.

When a requested change conflicts with the documented architecture, identify the conflict before implementation.

⸻

30. Architectural end state

The intended end state is a reliable, incremental automation system in which:

                     KYLE
                       ↓
                     ChatGPT
                       ↓
                     Qwen Router
                       ↓
                     ACP
                       ↓
         ┌─────────────┼─────────────┐
         ↓             ↓             ↓
       Kilo          Gemini        Utility AI
       GitHub        Research      Low-cost
       / Code        / Review      operations
         └─────────────┼─────────────┘
                       ↓
              Verification / Persistence
                       ↓
              Approved capabilities
                       ↓
          ┌───────────┴───────────┐
          ↓                       ↓
       Render              Apps Script
   Business logic         Google operations
          ↓                       ↓
       Workflows            Sheets / Gmail
          └─────────────┬───────────┘
                       ↓
                     LINE
                       ↓
                     ChatGPT
                       ↓
                      KYLE

The key invariant remains:

AI can orchestrate the system, but AI does not become the system's business-logic owner.

Render remains the production business-logic layer.

Google Apps Script remains the Google-specific adapter.

GitHub remains the source of truth.

LINE is a notification channel, not the primary AI development control channel.

ChatGPT is the primary human-facing development control interface.

ACP becomes the controlled interface between AI orchestration and production capabilities.

OpenClaw remains initially available as the orchestration/mediation layer but is deliberately kept replaceable.

Qwen remains under validation until its routing reliability is demonstrated.

Security AI operates as an independent specialist lane.

The system evolves incrementally without requiring a wholesale rewrite of the working Fluent with Kyle application.

⸻

## Security & Compliance

The section should establish the architectural security model and provide a living remediation checklist.

### 1. Security Boundary / Trust Model
Trust boundaries are strictly enforced between external providers (Tally, Cal.com), the Render/Node.js application, the Google Apps Script adapter, Google Sheets/Gmail, the LINE communication channel, AI orchestration components, and GitHub/development tooling. All external inputs, including webhooks, are treated as untrusted until they are authenticated and validated.

### 2. Authentication & Authorization
Architectural requirements for authentication and authorization include:
- Apps Script ↔ Render authentication using shared server-side secrets.
- Tally webhook authentication verification.
- Cal.com webhook authentication verification.
- Internal service-to-service authentication.
- Strict adherence to least-privilege access for all components.

### 3. Secrets & Configuration
Requirements for secrets and configuration include:
- All secrets must originate from environment variables or authorized secret stores.
- Secrets must never be committed to source control.
- Production configuration must not rely on hard-coded credentials, URLs, IDs, or other environment-specific values.
- Sensitive credentials must be masked and must never appear in logs.

### 4. Logging & Privacy
Minimum logging policy requirements include:
- Never log complete webhook payloads.
- Never log secrets, authentication material, or sensitive credentials.
- Minimize unnecessary PII in logs.
- Utilize minimal structured operational logs for debugging, monitoring, and auditing purposes.

### 5. Input Validation
All external webhook input must be:
1. Authenticated where applicable.
2. Schema-validated to ensure structural integrity.
3. Constrained to expected fields and data types.
4. Rejected when required data is missing or malformed.

### 6. Privilege & External Access
Least privilege must be the foundational architectural principle for:
- Google Apps Script OAuth scopes.
- Apps Script deployment and access settings.
- Gmail sending privileges.
- Google Sheets access.
- Render environment configuration.
- Exposure of external webhooks.

### 7. Repository & Artifact Security
Requirements for securing the repository and its artifacts include:
- Securing generated artifacts, logs, and temporary AI-agent output.
- Ensuring repository history does not contain sensitive information.
- Mandatory use of secret scanning.
- Preventing operational or sensitive information from being committed to source control.

### 8. Security Remediation Checklist

1. Google Apps Script Authentication — [x] DONE
2. Tally Webhook Authentication — [ ] TODO
3. Cal.com Webhook Authentication — [ ] TODO
4. Logging Minimization and Privacy — [~] PARTIALLY DONE
5. Configuration and Secret Hygiene — [~] PARTIALLY DONE
6. Sensitive Information in Repository Artifacts — [ ] TODO
7. Full Git History Secret Scan — [ ] TODO
8. Webhook Input Validation — [?] REVIEW REQUIRED
9. Apps Script Privilege Review — [?] REVIEW REQUIRED
10. Deployment and Access Configuration Review — [?] REVIEW REQUIRED

### 9. Security Completion Rule

An item should only move to `[x] DONE` after implementation is complete, relevant tests/verification have passed, and the resulting architecture matches the documented security requirement.
