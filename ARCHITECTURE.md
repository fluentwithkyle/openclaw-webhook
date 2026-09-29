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

AI agents operate around the production system. They do not replace Render's business-logic boundary or Google Apps Script's Google-specific adapter boundary.

CURRENT / IMPLEMENTED FOUNDATION

The verified current AI coordination architecture is:

Kyle — Director / Final Authority
↓
ChatBox
↓
DeepSeek Coordinator
↓
desired outcome / workflow reasoning
↓
bounded model-facing control_plane
↓
server-side policy / authorization
↓
existing ACP via /poc/coordinator
↓
TaskRegistry + existing dispatcher/orchestrator
↓
explicitly targeted specialist execution/review/research lanes
↓
execution result + evidence + independent verification
↓
TaskRegistry
↓
DeepSeek observation / bounded next-action reasoning
↓
continue / verify / recover / escalate
↓
Kyle

The specialist layer is:

* Gemini Builder — primary implementation, execution, and testing specialist.
* Gemini Reviewer — Architect / Planner / Reviewer, read-only advisory lane.
* Security AI — risk-tiered Security Specialist lane.
* Utility AI — General Utility Specialist lane.
* Kilo — explicitly targeted execution/failover lane.

The implemented coordination foundation and Phase 3 capabilities are CURRENT / IMPLEMENTED / VERIFIED as documented in Section 16.6. Phase 4 is PROPOSED / TARGET.

12.2 Kyle — Director / Final Authority

CURRENT / IMPLEMENTED GOVERNANCE

Kyle is the final human authorization authority.

AI agents operate within explicitly defined roles, capabilities, paths, lifecycle state, verification requirements, and authorization boundaries. No AI may independently redefine the architecture or expand its own authority.

12.3 ChatBox and DeepSeek Coordinator

CURRENT / IMPLEMENTED

ChatBox is the conversational ingress and user-facing interface for the DeepSeek Coordinator runtime.

The DeepSeek Coordinator runtime provides the bounded model-facing control_plane boundary. DeepSeek supplies untrusted intent and workflow reasoning; the server derives authority-bearing ACP fields from policy and authorization.

DeepSeek does not receive direct repository authority, GitHub credentials, unrestricted filesystem access, arbitrary capabilities, arbitrary paths, or a generic HTTP executor.

The current runtime path is:

ChatBox
→ /poc/deepseek-runtime
→ OpenRouter / DeepSeek
→ bounded control_plane
→ authenticated /poc/coordinator
→ ACP validation
→ TaskRegistry
→ existing dispatcher/orchestrator
→ targeted specialist lane

The runtime's model-facing control_plane is bounded by server-side policy and existing ACP authority.

12.4 Specialist roles

Gemini Builder — Primary implementation, execution, and testing specialist.

Gemini Reviewer — Architect / Planner / Reviewer and read-only advisory lane.

Security AI — Security Specialist activated according to risk-tiered policy.

Utility AI — General Utility Specialist for appropriately scoped low-complexity work.

Kilo — explicitly targeted execution/failover lane. Kilo is not the default Builder / Implementer / Tester when Gemini Builder is available.

These role definitions are architectural roles. A role definition does not itself authorize an implementation, capability, commit, or push.

12.5 ACP — Formal Command Boundary

CURRENT / IMPLEMENTED

ACP remains the authoritative command boundary between coordinator policy and specialist execution.

The active boundary is:

DeepSeek Coordinator
↓
server-derived policy / authorization
↓
existing ACP
↓
/poc/coordinator
↓
TaskRegistry
↓
existing dispatcher/orchestrator
↓
authorized specialist lane

The server, not model output, derives authority-bearing ACP fields including repository, base branch, target, task mode, capabilities, permitted paths, originator, and verification requirements.

ACP does not create a second control plane. TaskRegistry remains the authoritative task-state mechanism and the existing dispatcher/orchestrator remains the execution authority.

12.6 Authority and verification invariants

The following invariants are authoritative:

* DeepSeek/model output is untrusted intent.
* Authority-bearing ACP fields are server-derived.
* The model cannot self-authorize consequential operations.
* Director authorization remains authoritative where required.
* TaskRegistry remains the durable task-state and correlation mechanism.
* Independent verification remains distinct from execution completion.
* A terminal execution report does not by itself establish a verified desired outcome.
* Continuation requires validated lifecycle state, lineage, evidence, verification, and bounded-turn conditions.
* There is one substantive convergence authority: /poc/strategic-alignment.js.
* There is one phase-transition mechanism: /poc/phase-transition-gate.js.
* There is one control plane.
* No competing TaskRegistry, dispatcher, orchestrator, or strategic state model may be introduced.

12.7 Phase 3 — Autonomous Coordination Loop

COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED

Phase 3 established the bounded coordination lifecycle:

intent → workflow → dispatch → observe → evidence → next action → verification → completion/escalation

Verified Phase 3 capabilities include:

* durable coordination context;
* authoritative root/current task lineage;
* bounded autonomous coordination turns;
* autonomous-turn accounting distinct from MAX_TOOL_ITERATIONS;
* server-derived workflow-step sequencing;
* review → implementation → verification → reconciliation sequencing;
* server-derived terminal completion and failure/block escalation;
* fail-closed handling of terminal, failed, blocked, stale, insufficient-verification, and exhausted states;
* Director authorization boundaries;
* untrusted model output;
* single-control-plane architecture;
* preservation of ACP and TaskRegistry authority.

Phase 3 is not an unbounded autonomous agent loop. Progression remains bounded by lifecycle state, lineage, evidence, independent verification, authorization, and turn controls.

12.8 Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation

PROPOSED / TARGET

Objective:

Extend the verified Phase 3 bounded DeepSeek coordination foundation into scaled conversational orchestration across multi-step, multi-specialist task graphs while preserving ACP authority, TaskRegistry authority, server-derived policy, independent verification, bounded execution, Director authorization, and Kyle's final authority.

Intended capabilities:

* multi-task lineage navigation and cross-task aggregation;
* read-only parent/child workflow-state and diagnostic aggregation;
* policy-driven multi-specialist workflow chaining;
* structured recovery and escalation for failed, blocked, stale, or exhausted work;
* bounded DeepSeek observation and next-action reasoning across task graphs;
* mandatory independent verification before consequential progression.

Strict boundaries:

* DeepSeek remains an untrusted intent source.
* Capability upgrades and consequential execution require server-side policy and explicit Director authorization.
* BUILDER and FAILOVER_EXECUTE authority is never model-granted.
* Write, commit, and push authority remains explicitly authorized.
* ACP, TaskRegistry, server policy, convergence authority, and the phase-transition mechanism remain authoritative.
* No second control plane or competing state store may be introduced.
* Phase 4 documentation does not itself authorize implementation.

Open Phase 4 design questions include the exact multi-task aggregation payload shapes and automated failure-recovery routing trees. These remain PROPOSED / TARGET until separately designed, implemented, and independently verified.

12.9 GitHub / CI — Durable repository truth

CURRENT / IMPLEMENTED

GitHub is the durable source of truth for repository state, commits, diffs, and persisted architecture.

CI and repository verification provide durable evidence of implementation state. Agent sessions do not constitute persistent project state.

⸻

13. Standard development loop

CURRENT / IMPLEMENTED + PROPOSED / TARGET EXTENSION

The current bounded coordination loop is:

Kyle
↓
ChatBox
↓
DeepSeek Coordinator
↓
bounded control_plane
↓
server policy / authorization
↓
ACP
↓
TaskRegistry / existing dispatcher
↓
targeted specialist lane
↓
execution result + evidence
↓
independent verification
↓
TaskRegistry
↓
DeepSeek observation / bounded next action
↓
continue / verify / recover / escalate
↓
Kyle

Phase 4 may extend this loop across multiple related tasks and specialists, subject to the Phase 4 boundaries in Section 12.8.

⸻

14. Proposed target AI architecture

14.1 Objective

PROPOSED / TARGET

The target conversational experience is for Kyle to communicate through ChatBox while the DeepSeek Coordinator coordinates authorized multi-step work behind the existing ACP/control-plane boundary.

The underlying specialist lanes and production services remain behind explicit policy, authorization, and verification boundaries.

14.2 Target architecture

Kyle
↓
ChatBox
↓
DeepSeek Coordinator
↓
bounded control_plane
↓
server-side policy / authorization
↓
existing ACP
↓
TaskRegistry + dispatcher/orchestrator
↓
Gemini Builder / Gemini Reviewer / Security AI / Utility AI / Kilo
↓
evidence + independent verification
↓
TaskRegistry
↓
DeepSeek observation / next authorized action
↓
Kyle

Phase 4 expands cross-task lineage navigation and multi-specialist orchestration without changing the authority model.

14.3 Production boundary

Render / Node.js remains the production business-logic layer.

Google Apps Script remains the Google-specific adapter.

AI orchestration may coordinate approved capabilities but does not own production business rules.

OpenClaw remains a replaceable orchestration/mediation component and is not a second control plane.

⸻

15. LINE

15.1 Role

CURRENT / IMPLEMENTED

LINE remains an operational communication and notification channel.

The current DeepSeek conversational ingress is ChatBox. LINE is not required to operate the current AI coordination architecture.

15.2 Future LINE integration

PROPOSED / TARGET

Future work may connect LINE to the conversational architecture through an approved transport/integration boundary.

Any such integration must preserve:

* DeepSeek as untrusted intent;
* server-derived authorization;
* ACP as the command boundary;
* TaskRegistry as task-state authority;
* Render as production business-logic owner.

No LINE integration may become a competing control plane.

⸻

16. Agent Command Protocol

16.1 Role

CURRENT / IMPLEMENTED

ACP is the authoritative structured command boundary between server-side coordinator policy and authorized execution lanes.

16.2 Authority model

The active ACP path establishes explicit authorization context, including as applicable:

* originator;
* intended target;
* repository;
* base branch;
* task mode;
* capabilities;
* permitted paths;
* constraints;
* verification requirements;
* reporting requirements.

Capabilities are explicit and independent. A capability does not imply another capability.

16.3 Server-derived policy boundary

CURRENT / IMPLEMENTED

The DeepSeek runtime accepts model intent and applies server-side policy before constructing the ACP command.

The model cannot supply or upgrade authority-bearing fields such as capabilities, permitted paths, repository, branch, task mode, commit, push, or target.

16.4 Execution boundary

CURRENT / IMPLEMENTED

/poc/coordinator authenticates and validates the ACP request, registers the task through the existing TaskRegistry, and dispatches through the existing dispatcher/orchestrator.

Specialist execution remains subordinate to ACP authorization and TaskRegistry lifecycle state.

16.5 Kilo execution/failover boundary

PROPOSED / TARGET

Kilo remains an explicitly targeted execution/failover lane.

Any Kilo invocation must receive an explicitly authorized ACP command with its own permitted paths, capabilities, verification requirements, and reporting requirements.

A Kilo transport or trigger credential does not itself authorize repository operations.

16.6 DeepSeek Coordinator Evolution — Phase 0 through Phase 4

The Coordinator roadmap is:

| Phase | Status | Architectural meaning |
|---|---|---|
| Phase 0 — Coordinator Contract | COMPLETE / INDEPENDENTLY VERIFIED | Server-derived coordinator contract, bounded observation, evidence semantics, lifecycle/lineage semantics, and strategic-alignment enforcement. |
| Phase 1 — Observation | COMPLETE / INDEPENDENTLY VERIFIED | Bounded task observation, lifecycle, lineage, diagnostics, evidence, and verification projection through the existing TaskRegistry. |
| Phase 2 — Bounded Coordination | COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED | Bounded lineage, workflow-step policy, Director authorization, specialist routing, result-driven continuation, and automatic result consumption. |
| Phase 3 — Autonomous Coordination Loop | COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED | Durable context, bounded autonomous turns, server-derived workflow sequencing, completion/escalation, and fail-closed continuation. |
| Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation | PROPOSED / TARGET | Multi-task lineage navigation, cross-task aggregation, multi-specialist chaining, structured recovery/escalation, and bounded cross-task next-action reasoning. |

The authoritative live strategic state remains STATE.md, with docs/ai/strategic-state.json as its machine-readable projection.

Strategic alignment does not create an execution authority, control plane, TaskRegistry, dispatcher, or competing roadmap.

Phase transition remains a Kyle-authorized operation enforced by the existing phase-transition gate.

16.7 Phase 3 acceptance target

Phase 3 acceptance is the verified lifecycle:

intent → workflow → dispatch → observe → evidence → next action → verification → completion/escalation

The implementation remains bounded by lifecycle state, lineage, evidence, independent verification, authorization, and autonomous-turn limits.

16.8 Phase 4 design boundary

Phase 4 must extend coordination across task graphs without changing the authority model.

Its design must establish the exact read-only aggregation shapes, cross-task lineage navigation semantics, policy-driven specialist chaining, recovery/escalation rules, and verification requirements before implementation is authorized.

⸻

17. AI specialist roles

17.1 Gemini Reviewer — Architect / Planner / Reviewer

CURRENT / IMPLEMENTED ROLE

Gemini Reviewer provides architecture, planning, research, technical reasoning, and independent review. Its normal role is read-only advisory.

17.2 Gemini Builder — Primary implementation / execution / testing

CURRENT / IMPLEMENTED ROLE

Gemini Builder is the primary repository implementation, execution, and testing specialist.

17.3 Security AI — Security Specialist

PROPOSED / TARGET ROLE

Security AI provides risk-tiered security analysis and review according to server-side policy. It does not receive authority merely by being selected as a specialist.

17.4 Utility AI — General Utility Specialist

PROPOSED / TARGET ROLE

Utility AI handles appropriately scoped low-complexity work under explicit authorization. It has no architectural authority.

17.5 Kilo — Explicit execution / failover lane

CURRENT / IMPLEMENTED ROLE

Kilo remains available when explicitly targeted. It is not the default Builder/Implementer/Tester while Gemini Builder is the primary Builder lane.

17.6 Specialist routing invariant

Specialist selection is policy-controlled. Model reasoning may express intent, but the server derives and enforces authority, target, capabilities, permitted paths, and verification requirements.

⸻

18. Failover architecture

PROPOSED / TARGET

Failover provides a controlled alternative when an authorized specialist or execution component is unavailable.

Failover must preserve:

* original task;
* authorized scope;
* repository;
* target branch;
* ACP authorization;
* verification requirements;
* reporting requirements.

A replacement specialist never silently inherits additional authority. The replacement receives its own explicitly authorized ACP command.

For implementation, Gemini Builder is the primary Builder lane. Kilo is the available explicitly targeted execution/failover lane.

Failover must never bypass ACP, server-side policy, TaskRegistry lifecycle state, independent verification, or Director authorization.

If no authorized execution path is available, the result is BLOCKED and escalates to Kyle.

⸻

19. OpenClaw's architectural role

19.1 Status

PROPOSED / TARGET

OpenClaw is a replaceable orchestration/mediation component.

It may eventually provide transport, message routing, event orchestration, LINE integration, or automated invocation.

19.2 Authority boundary

OpenClaw does not become a control plane.

The authority chain remains:

DeepSeek Coordinator
↓
server-side policy / authorization
↓
existing ACP
↓
TaskRegistry + dispatcher/orchestrator

OpenClaw may mediate transport or orchestration around this boundary but may not redefine ACP authority, create a competing TaskRegistry, create a competing convergence authority, or own production business rules.

19.3 Replaceability

The production application must not depend on OpenClaw-specific business logic.

OpenClaw may remain central, become narrower, be replaced, or become optional without moving production business rules out of Render or Google-specific operations out of Apps Script.

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

LINE remains the operational communication and notification channel.

ChatBox / DeepSeek

ChatBox and the DeepSeek Coordinator provide the current conversational coordination interface. They do not own production business rules.

GitHub

GitHub remains the durable source of truth for code and architecture.

Production workflows

Critical production workflows remain on Render unless a later architectural decision deliberately moves them.

Business rules must not be duplicated inside:

* DeepSeek;
* OpenClaw;
* GitHub Actions;
* specialist prompts;
* other AI layers.

AI orchestration may request approved capabilities through ACP, but Render remains responsible for production business decisions and Google Apps Script remains responsible for Google-specific execution.

⸻

21. Security architecture

CURRENT / IMPLEMENTED FOUNDATION + PROPOSED / TARGET EXTENSIONS

The AI layer introduces a trust boundary and is governed by explicit server-side authorization.

21.1 Credential principle

AI agents must not receive unrestricted production credentials. Credentials are scoped outside model output and exposed only through explicitly authorized execution mechanisms.

21.2 Capability principle

AI agents interact with approved capabilities through ACP rather than unrestricted direct access to production systems.

21.3 Cross-system authentication

Cross-system calls require explicit authentication and authorization. The implemented DeepSeek runtime authenticates its coordinator boundary using server-held credentials; future integrations require their own reviewed authentication boundary.

21.4 Write protection

Write-capable operations require structured validation, server-side authorization, appropriate idempotency, auditability, and explicit verification. Model output cannot grant write, commit, or push authority.

⸻

22. Task state and reliability

CURRENT / IMPLEMENTED FOUNDATION + PROPOSED / TARGET EXTENSIONS

Task state is maintained by the existing TaskRegistry and ACP lifecycle.

The current coordination architecture supports:

* request and correlation identity;
* task lifecycle state;
* parent/child lineage;
* current and next agent/action information;
* execution/result information;
* verification requirements and independent-verification evidence;
* failure and blocked diagnostics;
* bounded continuation state;
* autonomous-turn accounting.

Phase 4 may extend read-only aggregation across related task graphs.

TaskRegistry remains the authoritative task-state and correlation mechanism. A second task-state store is not permitted.

⸻

23. Scheduled production workflows

CURRENT / IMPLEMENTED + PROPOSED PRESERVATION

Critical scheduled production workflows remain on Render during AI evolution.

In particular:

Render
  ↓
abandonedBooking.js

remains operational independently of the AI coordination layer.

AI orchestration does not justify moving production scheduling into ChatBox, DeepSeek, OpenClaw, or GitHub Actions.

⸻

24. Migration roadmap

The migration remains incremental and non-destructive. The current production system must remain operational throughout AI coordination work.

Phase 0 — Coordinator Contract

COMPLETE / INDEPENDENTLY VERIFIED

The DeepSeek Coordinator contract, server-derived authority mapping, bounded observation, evidence semantics, lifecycle/lineage semantics, and strategic-alignment enforcement are established.

Phase 1 — Observation

COMPLETE / INDEPENDENTLY VERIFIED

Bounded TaskRegistry observation, lifecycle state, lineage, diagnostics, evidence, and verification projection are established.

Phase 2 — Bounded Coordination

COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED

Bounded coordination, workflow-step policy, Director authorization infrastructure, specialist routing, result-driven continuation, and automatic result consumption are established and independently verified.

Phase 3 — Autonomous Coordination Loop

COMPLETE / INDEPENDENTLY VERIFIED / CONVERGED

Bounded autonomous coordination, durable context, server-derived workflow sequencing, completion/escalation, and fail-closed continuation are established and independently verified.

Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation

PROPOSED / TARGET

Phase 4 extends the verified Phase 3 foundation across multi-step, multi-specialist task graphs.

Planned areas:

* multi-task lineage navigation and cross-task aggregation;
* read-only parent/child workflow-state and diagnostic aggregation;
* policy-driven multi-specialist workflow chaining;
* structured recovery and escalation;
* bounded DeepSeek observation and next-action reasoning across task graphs;
* mandatory independent verification before consequential progression.

Phase 4 does not change the authority model. ACP, TaskRegistry, server-side policy, independent verification, bounded execution, Director authorization, convergence authority, and the phase-transition mechanism remain authoritative.

Phase 4 implementation requires separate authorized design and implementation work. This architecture document does not authorize implementation.

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

The next architectural work belongs to Phase 4 — Scaled Conversational Orchestration & Cross-Task Lineage Navigation.

The Phase 4 design must establish, against the actual repository:

* multi-task lineage navigation semantics;
* read-only parent/child aggregation shapes;
* cross-task diagnostic aggregation;
* policy-driven specialist chaining;
* recovery and escalation routing;
* verification prerequisites for consequential progression;
* bounded continuation semantics across task graphs;
* authorization behavior for capability upgrades;
* persistence and evidence requirements.

The existing ACP, TaskRegistry, dispatcher/orchestrator, convergence authority, and phase-transition mechanism remain the foundation.

Do not introduce a second control plane, competing task-state store, generic HTTP executor, or model-controlled authority path.

Do not treat Phase 4 documentation as implementation authorization.

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