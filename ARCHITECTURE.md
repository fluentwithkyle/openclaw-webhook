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

They do not replace the production system’s business-logic boundaries.

The AI development system consists of:

Qwen3 0.6B — Router

CURRENT / IMPLEMENTED AS DEVELOPMENT ROLE

Qwen3 0.6B acts as the Router, directing requests to the appropriate AI specialist. It is not responsible for architecture, reasoning, or implementation.

⸻

NVIDIA Nemotron 3 Ultra — Architect / Reasoning / Research / Reviewer

CURRENT / IMPLEMENTED AS DEVELOPMENT ROLE

NVIDIA Nemotron 3 Ultra is responsible for:

* architecture;
* large-context repository analysis;
* planning;
* reasoning about system-wide changes;
* dependency mapping;
* Google-specific integration analysis;
* GitHub-specific analysis;
* architectural review;
* integration review.

NVIDIA Nemotron 3 Ultra should analyze the repository and produce implementation plans.

⸻

Kilo Code — Builder / Implementer / Tester

CURRENT / IMPLEMENTED AS DEVELOPMENT ROLE

Kilo Code is responsible for:

* primary implementation;
* debugging;
* multi-file changes;
* tests;
* refactoring;
* verification;
* final corrections;
* maintaining production code.

Kilo Code implements an approved plan and should make the smallest appropriate change.

⸻

Utility / Free / Local Models — Utility Specialists

CURRENT / PROPOSED

Use lower-cost models for:

* quick technical questions;
* boilerplate;
* simple transformations;
* text transformations;
* high-volume low-complexity iterations;
* utility tasks.

These models must not independently redefine the system architecture.

⸻

Local Goose — Local Execution Support

CURRENT / PROPOSED

Goose may be used for:

* repetitive work;
* background processing;
* large batches of low-risk tasks;
* local experimentation;
* unlimited local iteration.

Goose operates within the architectural boundaries defined by this document.

⸻

13. Standard development loop

CURRENT / IMPLEMENTED OPERATING MODEL

Major development work follows:

Qwen Router
  ↓
NVIDIA Nemotron architecture/reasoning
  ↓
Kilo implementation
  ↓
tests/debugging
  ↓
NVIDIA Nemotron review
  ↓
Kilo corrections

NVIDIA Nemotron is the architect/reviewer. Kilo Code is the primary builder.


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
* NVIDIA Nemotron 3 Ultra = Architect / Reasoning / Research / Reviewer;
* Kilo Code = Builder / Implementer / Tester;
* GitHub;
* Render;
* Google Apps Script;
* other AI tools.

The underlying agents and services should operate behind the LINE interface.

⸻

14.2 Target architecture

                          KYLE
                            ↓
                          LINE
                            ↓
                     Render / Node.js
                            ↓
                  AI Orchestration Layer
                            ↓
                     Agent Command
                     Protocol (ACP)
                            ↓
           ┌────────────────┼─────────────────┐
           ↓                ↓                 ↓
        Kilo Code        NVIDIA Nemotron   Utility Models
           ↓                ↓                 ↓
        GitHub          Research /          Utility
        / Code           Review              Tasks
           └────────────────┼─────────────────┘
                            ↓
                  Authorized Capabilities

                           ↓
              ┌────────────┴────────────┐
              ↓                         ↓
       Render application        Google Apps Script
       / business logic          / Google operations
              ↓                         ↓
       Existing workflows       Sheets / Gmail
              └────────────┬────────────┘
                           ↓
                         LINE
                           ↓
                          KYLE

GitHub Actions may serve as an ephemeral AI execution plane within this architecture.

It does not replace Render as the production application server.

⸻

15. LINE as the control interface

15.1 Role

PROPOSED / TARGET

LINE becomes Kyle’s natural-language control interface.

The intended experience is:

Kyle → LINE
     → request received
     → system understands request
     → appropriate capability/agent selected
     → task executed
     → result returned
     → LINE

LINE itself does not make business decisions.

Render remains responsible for production business rules.

⸻

15.2 Synchronous tasks

Simple requests may eventually follow:

LINE
 ↓
Render
 ↓
AI Router
 ↓
Approved read capability
 ↓
Existing production system
 ↓
Result
 ↓
LINE

Example:

"Give me this week's bookings."

⸻

15.3 Asynchronous tasks

Longer tasks should follow:

LINE
 ↓
Render
 ↓
Create task
 ↓
AI execution plane
 ↓
Orchestration
 ↓
Specialist / capability
 ↓
Task result
 ↓
Render
 ↓
LINE

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

⸻

16. Agent Command Protocol

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
* ACP does not replace GitHub Actions, Gemini, or Codex.
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
* constraints — the operational limits or rules the execution lane must respect.
* authorization — the authorization context indicating what capabilities may be used.
* verification — the expected verification to be performed and reported (e.g. targeted checks, tests).
* reporting — how the execution report should be delivered back to the orchestrator.

All field values are proposed placeholders until the ACP is reviewed, approved, and implemented.

⸻

Execution boundaries

ACP is a structured contract, not an execution engine.

Specific boundaries:

* ACP does not execute code by itself. An explicitly addressed execution lane performs the work.
* ACP does not replace GitHub Actions, Gemini, or Codex. Each remains an independent agent or execution lane within the target architecture.
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
  "constraints": [
    "smallest-change-placeholder",
    "no-new-dependencies-placeholder"
  ],
  "authorization": "placeholder-scoped-capability-token",
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

This section documents the execution boundary between the Qwen Router and the Kilo Code execution lane.

The contract is:

Qwen3 0.6B Router
↓
ACP command
↓
Kilo Code
↓
GitHub repository
↓
implementation / verification
↓
ACP execution report
↓
Qwen Router

Qwen Router

Qwen3 0.6B is the Router.

Qwen routes development requests and constructs an ACP command for Kilo.

Qwen must NOT:

* implement repository changes;
* redefine architecture;
* bypass ACP;
* issue unrestricted shell/Git instructions;
* provide secrets or credentials;
* claim successful execution without a Kilo execution report.

Kilo

Kilo is the Builder / Implementer / Tester.

Kilo receives an authorized ACP command and performs:

* repository inspection;
* implementation;
* testing;
* verification;
* execution reporting.

Kilo follows AGENTS.md, ARCHITECTURE.md, and the constraints contained in the ACP command.

ACP COMMAND BOUNDARY

The boundary is:

Qwen
↓
ACP command
↓
Kilo

The existing ACP specification in section 16.3 is the canonical command protocol.

Do NOT create a second protocol.

The ACP command must establish:

* originator;
* target;
* repository;
* base branch;
* authorized task;
* constraints;
* verification requirements;
* reporting requirements.

REPOSITORY SAFETY

Kilo must:

* inspect before modifying;
* remain within authorized scope;
* make the smallest appropriate change;
* preserve unrelated functionality;
* never expose secrets;
* never modify AGENTS.md unless explicitly authorized;
* never modify GitHub Actions merely because Kilo is being used;
* never commit or push unless explicitly authorized by the ACP command.

EXECUTION REPORT

The return path is:

Kilo
↓
ACP execution report
↓
Qwen

The execution report must distinguish at minimum:

* success;
* failure;
* blocked;
* changed files;
* verification results;
* commit;
* push;
* blockers.

Qwen must treat the Kilo execution report, rather than its own assumptions, as the execution result.

OPENCLAW INDEPENDENCE

The Qwen → Kilo boundary does NOT depend on OpenClaw.

OpenClaw may later provide:

* transport;
* message routing;
* event orchestration;
* LINE integration;
* automated invocation.

These are transport/orchestration concerns and must not alter the ACP command contract.

ARCHITECTURAL BOUNDARY

This development execution lane must not move production business logic out of Render or Google-specific operations out of Google Apps Script.

⸻

17. AI specialist roles

17.1 Kilo Code

PROPOSED / TARGET

Kilo Code remains the primary implementation/build/debug/test specialist.

Typical delegation:

"Implement this feature."
"Fix this bug."
"Run the tests and resolve the failure."
"Update the CRM workflow."

⸻

17.2 NVIDIA Nemotron 3 Ultra

PROPOSED / TARGET

NVIDIA Nemotron 3 Ultra remains the architecture, research, planning, and review specialist.

Typical delegation:

"Analyze this architecture."
"Research the best approach."
"Review this implementation."
"Identify integration risks."
"Produce an implementation plan."

⸻

17.3 Qwen3 0.6B

UNDER VALIDATION

Qwen3 0.6B is a candidate low-cost router/orchestrator.

It must not initially be treated as a fully autonomous reasoning or coding agent.

The preferred constrained problem is:

Natural language
      ↓
Structured intent
      ↓
Approved command

Example:

"Give me this week's bookings."
      ↓
GET_BOOKINGS

or:

"Add this feature to the CRM."
↓
CODE_CHANGE_REQUEST
↓
Kilo Code

Qwen3 0.6B must be benchmarked before becoming a production-critical router.

If it cannot reliably perform the required routing task, a stronger or different router may be used.

The architecture should not become permanently dependent on a specific small model.

⸻

18. OpenClaw’s architectural role

18.1 Status

PROPOSED / TARGET

OpenClaw is initially retained as the orchestration/mediation capability.

Its value is not defined merely as “being the server.”

Its potentially valuable responsibilities include:

* agent handoffs;
* tool/capability selection;
* task orchestration;
* context management;
* multi-step execution;
* coordinating specialist agents;
* consolidating results.

⸻

18.2 Replaceability

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

19. GitHub Actions as AI execution plane

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

⸻

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

LINE remains the communication channel and becomes the intended natural-language control interface for Kyle.

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
* Kilo Code;
* NVIDIA Nemotron 3 Ultra;
* Qwen or another router;
* GitHub Actions;
* approved production capabilities.

Example:

Kyle
 ↓
LINE
 ↓
Router / OpenClaw
 ↓
NVIDIA Nemotron architecture analysis
 ↓
Kilo Code implementation
 ↓
Tests
 ↓
NVIDIA Nemotron review
 ↓
Kilo Code corrections
 ↓
Result
 ↓
LINE

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
* Kilo Code integration points;
* NVIDIA Nemotron 3 Ultra integration points;
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
                    LINE
                      ↓
             Natural-language request
                      ↓
             Render / control boundary
                      ↓
          AI orchestration / OpenClaw
                      ↓
                    ACP
                      ↓
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
      Kilo Code     NVIDIA Nemotron 3 Ultra  Utilities
        ↓             ↓             ↓
     GitHub        Research      Low-cost
      / Code        / Review      operations
        └─────────────┼─────────────┘
                      ↓
             Approved capabilities
                      ↓
          ┌───────────┴───────────┐
          ↓                       ↓
       Render              Apps Script
   Business logic         Google operations
          ↓                       ↓
       Workflows            Sheets / Gmail
          └───────────┬───────────┘
                      ↓
                    LINE
                      ↓
                     KYLE

The key invariant remains:

AI can orchestrate the system, but AI does not become the system’s business-logic owner.

Render remains the production business-logic layer.

Google Apps Script remains the Google-specific adapter.

GitHub remains the source of truth.

LINE becomes the intended human control interface.

ACP becomes the controlled interface between AI orchestration and production capabilities.

OpenClaw remains initially available as the orchestration/mediation layer but is deliberately kept replaceable.

Qwen3 0.6B remains under validation until its routing reliability is demonstrated.

The system evolves incrementally without requiring a wholesale rewrite of the working Fluent with Kyle application.
