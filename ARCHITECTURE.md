# Fluent with Kyle
# OpenClaw Automation Architecture & Development System

## AI Development Workflow

This repository uses a multi-agent development system.

The architecture and business requirements are maintained in this document.

### Architect — Gemini

Gemini is responsible for:

- Large-context repository analysis
- Architecture analysis
- Planning
- Reasoning about system-wide changes
- Dependency mapping
- Google-specific integration analysis
- GitHub-specific analysis
- Architectural review
- Integration review

Gemini should analyze the repository and produce clear implementation plans before major architectural work.

Gemini should not be treated as the primary implementation agent.

### Builder — Codex

Codex is the primary implementation agent.

Codex is responsible for:

- Implementing approved plans
- Writing code
- Modifying multiple files
- Debugging
- Refactoring
- Running tests
- Verifying implementations
- Completing final corrections
- Maintaining production code

Codex should read ARCHITECTURE.md before making architectural changes.

### Utility Agents — Groq / Free Open Models

Free and low-cost models are used for:

- Quick technical questions
- Boilerplate generation
- Simple transformations
- Text transformations
- High-volume low-complexity iterations

These models should not independently redefine the system architecture.

### Local Agent — Goose

Goose is used for local development tasks such as:

- Repetitive work
- Background processing
- Large batches of low-risk tasks
- Local experimentation
- Unlimited local iteration

Goose operates within the architectural boundaries defined by this repository.

---

## Standard Development Loop

Major development work follows this sequence:

Gemini
↓
Repository analysis
↓
Architecture understanding
↓
Implementation plan
↓
Codex
↓
Implementation
↓
Multi-file changes
↓
Tests
↓
Debugging
↓
Verification
↓
Gemini
↓
Architectural review
↓
Codex
↓
Final corrections

The development roles are therefore:

**Gemini = Architect / Reviewer**

**Codex = Builder / Debugger / Tester**

**Groq / Open Models = Utility**

**Goose = Local Execution**

---

## Agent Operating Rules

All agents must treat the existing production system as the source of truth.

Before making changes:

1. Read ARCHITECTURE.md.
2. Read GEMINI.md when working with the repository.
3. Inspect the relevant existing implementation.
4. Understand existing behavior.
5. Identify the smallest appropriate change.
6. Preserve working functionality.
7. Verify the implementation.

Architectural changes should be deliberate and documented.

Business logic belongs in Render.

Google-specific operations belong in Google Apps Script.

The CRM remains Google Sheets.

External services remain event sources or communication channels.

---

## Current Development Strategy

The project is being developed incrementally.

The current working system remains operational while architecture is progressively refined.

Development sequence:

Current Working System
↓
Service-Modular System
↓
Workflow-Modular System
↓
Domain-Oriented Business System
↓
Centralized Event Processing
↓
OpenClaw Management Layer
↓
Complete Client Lifecycle Automation

The immediate development objective should always be taken from the current roadmap in this document rather than invented independently by an AI agent.

---

## Change Discipline

Agents should:

- Preserve existing behavior.
- Avoid unnecessary rewrites.
- Avoid unnecessary dependencies.
- Avoid unrelated refactoring.
- Keep business logic centralized in Render.
- Keep Google-specific implementation inside Apps Script.
- Maintain clear module boundaries.
- Prefer incremental architectural improvements.
- Verify changes before completion.

When a requested change conflicts with the documented architecture, the conflict should be identified before implementation.

Fluent with Kyle
OpenClaw Automation Architecture & Development Roadmap

1. Executive Architecture
Fluent with Kyle uses Render/OpenClaw as the central automation, business-logic, and client-lifecycle engine.
Google Apps Script functions as a lightweight Google adapter layer for operations specifically tied to Google services:
Google Sheets
Personal Gmail
The core architectural principle is:
If it is a business decision, it belongs in Render.
If it is a Google-specific operation, it belongs in Google Apps Script.
The long-term objective is for OpenClaw to manage the Fluent with Kyle automation system directly through the Render-hosted Node.js application.
Render therefore becomes the central application layer containing the complete business system, while Google Apps Script remains intentionally lightweight.

2. Current Production Architecture
The current Render application is:
openclaw-webhook/
├── package.json
├── index.js
└── services/
    ├── lineService.js
    ├── appsScript.js
    ├── tally.js
    └── cal.js
The current architecture is:
                        ┌─────────────────────┐
                         │      index.js       │
                         │ Express Server      │
                         │ Routing             │
                         │ Scheduler           │
                         │ Health              │
                         └──────────┬──────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
                 ▼                  ▼                  ▼
             tally.js            cal.js       Abandoned Booking
                 │                  │              Scheduler
                 │                  │                  │
                 └────────────┬─────┴──────────────────┘
                              │
                              ▼
                       appsScript.js
                              │
                              ▼
                     Google Apps Script
                              │
                       ┌──────┴──────┐
                       ▼             ▼
                 Google Sheets   Personal Gmail

             lineService.js
                    │
                    ▼
                 LINE API
The current system is already modular at the service level.
The next architectural step is to make it more explicitly business-domain and workflow oriented.

3. Current Render Application
Production server:
https://openclaw-webhook-iz6s.onrender.com
Render currently provides:
Express server
JSON middleware
Tally webhook routing
Cal.com webhook routing
Health monitoring
Abandoned-booking scheduler
Tally processing
Cal.com processing
CRM communication
LINE communication
Booking lifecycle processing
Cancellation processing
Free Intro processing
Personalized Tally #2 URL generation
Gmail communication through Apps Script
Keep-alive functionality
Current entry point:
index.js
Current services:
services/
├── lineService.js
├── appsScript.js
├── tally.js
└── cal.js

4. Current Module Responsibilities
index.js — Application Shell & Scheduler
The current index.js performs several infrastructure and orchestration responsibilities.
It currently:
Creates the Express server
Registers JSON middleware
Registers webhook routes
Starts the server
Provides /
Provides /health
Starts the abandoned-booking scheduler
Runs the keep-alive ping
Imports the business services
It also currently contains the abandoned-booking workflow itself.
Conceptually:
index.js
│
├── Express infrastructure
├── Route registration
├── Health endpoint
├── Scheduler
├── Keep-alive
└── Business workflow orchestration
The architectural direction is to eventually leave index.js primarily responsible for infrastructure and application startup while moving business workflows into dedicated modules.

5. tally.js — Tally Intake Processor
tally.js processes Tally submissions.
It currently:
Receives Tally webhook data.
Extracts Tally fields.
Normalizes field values.
Identifies:
Name
Email
LINE ID
Preferred reach method
Location
Profession
English Reality
3-Month Goal
Conversation Topics
Question Text
Package
Detects package selections.
Calculates session credits.
Handles question submissions.
Sends question notifications through LINE.
Sends CRM update instructions to Apps Script.
Sets the initial booking state.
Current lifecycle state after a normal Tally #1 submission:
Schedule Status = Pending Booking
Current package-credit logic:
Weekly Intensive Retainer → 4 credits
Monthly Retainer + LINE Support → 4 credits
Flex Pass → 4 credits

Deep Dive → 1 credit
Single Session → 1 credit
Free Intro Chat → 1 credit
The exact package rules can be expanded as the product structure develops.

6. cal.js — Cal.com Booking Processor
cal.js processes Cal.com webhook events.
It currently handles:
Booking creation
Booking cancellation
Meeting ended events
Client identification
Client lookup
Booking information
Location
Booking date/time
Session type
1-on-1
1-on-2
Guest information
Booking notes
CRM updates
LINE notifications
Free Intro detection
Personalized Tally #2 URL generation
Email triggering through Apps Script
The current session-type determination is:
Guest information present
        ↓
1-on-2

No guest information
        ↓
1-on-1
Guest information currently includes:
Guest Name
Guest Email
Guest LINE ID

7. appsScript.js — Google Adapter Gateway
appsScript.js currently provides the Render-to-Apps-Script bridge.
Current functions:
triggerAppsScript()
cleanTaipeiTimestamp()
cleanEventTitle()
Its architectural role is:
Render
  ↓
appsScript.js
  ↓
Google Apps Script
  ↓
Google services
triggerAppsScript() sends an action payload to the Apps Script endpoint.
The eventual architecture will make the payloads more standardized while keeping business decisions entirely within Render.

8. lineService.js — LINE Gateway
lineService.js provides the LINE communication layer.
Current responsibility:
sendLineNotification()
It receives a completed message from the Render application and sends it through the LINE Messaging API.
Architecturally:
Render determines:
    What happened
    What information matters
    What message should be generated

        ↓

lineService.js

        ↓

LINE API
LINE itself remains a communication channel rather than a business-logic layer.

9. Current CRM Structure
The current Clients CRM contains the following columns:
Column
Field
A
Timestamp
B
Name
C
Email
D
LINE ID
E
Location/Address
F
Profession
G
English Reality
H
3-Month Goal
I
Conversation Topics
J
Package
K
1-on-1 / 1-on-2
L
Guest Name
M
Guest Email
N
Guest LINE ID
O
Payment Status
P
Session Credits
Q
Schedule Status
R
Booking Date/Time
S
Cancellation Status
T
Cancellation Reason
U
Booking Notes
V
Question Text

This current structure supersedes the earlier 16-column CRM design.
The expanded CRM now captures:
Client identity
Client contact information
Client location
Client professional context
English diagnostic information
Goals
Conversation interests
Package
Session structure
Guest information
Payment state
Session credits
Booking state
Booking date/time
Cancellation state
Cancellation reason
Booking notes
Questions
Google Sheets remains the persistent CRM record and interface.
Render remains the application-level lifecycle engine.

10. CRM Architectural Principle
The separation remains:
Render owns
Client identity logic
Data normalization
Lifecycle logic
CRM field definitions
State transitions
Update decisions
Booking decisions
Cancellation decisions
Package logic
Session-credit logic
Google Apps Script owns
Reading Sheets
Writing Sheets
Updating Sheets
Finding rows
Returning results
The architectural rule is:
Render decides WHAT should happen.

Apps Script performs the Google operation required to make it happen.
For example:
Render:
Client has completed Tally #1 but has not booked.
Move Schedule Status to Follow-Up Needed.

        ↓

Apps Script:
Update Schedule Status cell in Google Sheets.
Apps Script does not independently determine the lifecycle state.

11. Current Tally #1 → CRM Flow
The current flow is:
Tally #1
   ↓
Render
   ↓
tally.js
   ↓
Normalize submission
   ↓
Determine client information
   ↓
Determine package
   ↓
Calculate session credits
   ↓
Determine lifecycle state
   ↓
Apps Script
   ↓
Google Sheets
Normal initial state:
Schedule Status
        ↓
Pending Booking
This establishes the client inside the CRM before the Free Intro booking occurs.

12. Current Cal.com → CRM Flow
The current booking flow is:
Cal.com
   ↓
Render
   ↓
cal.js
   ↓
Identify client by email
   ↓
Retrieve client context
   ↓
Process booking
   ↓
Determine session type
   ↓
Extract location
   ↓
Extract booking date/time
   ↓
Extract guest information
   ↓
Extract notes
   ↓
Apps Script
   ↓
Google Sheets
Current booking state:
Schedule Status = Confirmed
Current CRM booking information can include:
Location/Address
Booking Date/Time
Package
1-on-1 / 1-on-2
Guest Name
Guest Email
Guest LINE ID
Booking Notes

13. Booking-Created LINE Notification
When Cal.com creates a booking, Render generates a LINE notification.
The notification currently combines:
Booking information
Event
Date/time
Session type
Guest information
Location
LINE ID
Email
Notes
Original Tally #1 context
Profession
English Reality
3-Month Goal
Conversation Topics
The architecture is:
Cal.com
   ↓
Render
   ↓
Identify client
   ↓
Retrieve CRM context
   ↓
Combine booking + diagnostic information
   ↓
Generate LINE notification
   ↓
LINE
This gives the session context in one notification.

14. Abandoned Booking — Current Status
The abandoned-booking logic has already been moved into Render.
This is an important update from the original roadmap.
The current index.js contains an internal scheduler running every five minutes:
Every 5 minutes
      ↓
get_pending
      ↓
Retrieve pending clients
      ↓
Calculate elapsed time
      ↓
30-minute threshold
      ↓
Identify clients requiring follow-up
      ↓
Generate LINE alert
      ↓
Update CRM
      ↓
Schedule Status = Follow-Up Needed
Current threshold:
30 minutes
Current implementation means the business decision is already being made by Render rather than by Apps Script.
This fulfills the central architectural objective of moving the abandoned-booking decision into the application layer.

15. Abandoned Booking — Target Architecture
The current implementation should now evolve from being embedded in index.js into its own workflow module.
Target:
Render Scheduler
       ↓
abandonedBooking workflow
       ↓
Retrieve pending clients
       ↓
Check elapsed time
       ↓
Verify lifecycle eligibility
       ↓
Prevent duplicate processing
       ↓
Determine Follow-Up Needed
       ↓
Update CRM through Apps Script
       ↓
Generate sales-recovery alert
       ↓
LINE
The next improvement is therefore workflow extraction, not migration from Apps Script.
Target file:
workflows/
└── abandonedBooking.js

16. Abandoned Booking Sales-Recovery Alert
The intended alert contains:
ABANDONED BOOKING ALERT

Name:
Email:
LINE ID:

Package:

Submitted At:
Elapsed: [X hours] without booking

Location/Address:
Profession:

English Reality:

3-Month Goal:

Conversation Topics:

Booking Status: Pending Booking

Follow-Up Opportunity:
Client completed the intake but has not completed the booking.
Render owns:
Threshold
Eligibility
Timing
Client lookup
Lifecycle state
Duplicate-alert prevention
Alert content
Sales-recovery decision
Apps Script owns:
CRM read/write operations
LINE owns:
Message delivery

17. Cancellation Architecture
Cal.com cancellation events are processed by Render.
Current flow:
Cal.com Cancellation
       ↓
Render
       ↓
cal.js
       ↓
Identify client
       ↓
Retrieve client context
       ↓
Determine cancellation information
       ↓
Update CRM
       ↓
Generate LINE alert
       ↓
LINE
Current CRM updates include:
Schedule Status → Cancelled
Cancellation Status → Cancelled
Cancellation Reason
The cancellation reason is taken from Cal.com.

18. Cancellation Sales-Recovery Alert
The intended notification contains:
CANCELLATION ALERT

Event Type:

Name:
Email:
LINE ID:

Original Booking Date/Time:
Location:
Package:

Profession:

English Reality:

3-Month Goal:

Conversation Topics:

Cancellation Reason:

Additional Notes:
Render combines:
Cal.com event data
+
CRM client context
+
Cancellation information
into the final notification.
The purpose is to provide the complete client context around the cancellation event.

19. Free Intro → Tally #2
The Free Intro workflow remains tied specifically to the meeting-ending event.
Current architecture:
Free Intro Booking
       ↓
Cal.com
       ↓
Render
       ↓
Detect Free Intro
       ↓
CRM update
       ↓
LINE notification
After the meeting:
MEETING_ENDED
       ↓
Render
       ↓
Identify Free Intro
       ↓
Generate personalized Tally #2 URL
       ↓
Prepare follow-up email
       ↓
Apps Script
       ↓
Gmail
       ↓
Client
Tally #2:
https://tally.so/r/lb26p6
Personalized parameters:
name
email
line_id
The personalized URL is generated by Render.

20. Email Architecture
The desired final email architecture is:
Render
   ↓
Determine email event
   ↓
Determine recipient
   ↓
Select template
   ↓
Generate subject
   ↓
Personalize content
   ↓
Generate HTML
   ↓
Generate Tally #2 URL when applicable
   ↓
Send completed payload
   ↓
Apps Script
   ↓
Email.gs
   ↓
Personal Gmail
Render owns:
Email event
Recipient
Timing
Template selection
Subject
HTML
Personalization
Tally #2 URL
Business context
Apps Script owns:
Gmail delivery

21. Current Email Implementation vs Target
The current Cal.com workflow already:
Detects Free Intro
Detects MEETING_ENDED
Generates personalized Tally #2 URL
Retrieves an email template through Apps Script
Performs personalization
Sends the completed HTML email through Apps Script
The remaining architectural refinement is to move:
Template selection
+
Template personalization
+
Email generation
into Render.
The eventual structure is:
Render
   ↓
Email-generation service
   ↓
Completed email payload
   ↓
Apps Script
   ↓
Gmail
Apps Script should ultimately receive an already-completed email instruction.

22. Google Apps Script Architecture
The Google Apps Script project should remain lightweight.
Target structure:
Apps Script
├── Code.gs
├── CRM.gs
├── Email.gs
└── Utilities.gs
Its purpose is to provide a Google-native adapter layer.
It should contain Google-specific operations without containing Fluent with Kyle’s business logic.

23. Code.gs — Google Webhook Router
Code.gs contains:
doPost()
Its job is to:
Receive a request from Render.
Determine the requested Google operation.
Route the request.
Execute the Google-specific function.
Return a standardized response.
Potential operation categories include:
append_row
update_status
update_client
get_client
send_email
The exact action names can be standardized during refactoring.
Code.gs should not make business decisions.
Example:
Render:
"This client needs Schedule Status = Follow-Up Needed."

Apps Script:
"Understood. I will update that Google Sheet field."

24. CRM.gs — Google Sheets Adapter
CRM.gs handles physical Google Sheets operations.
Current/future responsibilities include:
appendClientRow()
updateClientStatus()
getClientByEmail()
updateClient()
updateClientFields()
The exact function names can be standardized during refactoring.
Google Sheet ID:
1--ScrsFamPAbBDaa6MThpKdl5RkzUTY5anq2K9OEAvo
Architectural rule:
Render:
    Which client?
    Which fields?
    Which values?
    Why?
    Which lifecycle state?

Apps Script:
    Find the row.
    Write the values.
    Return the result.

25. Email.gs — Gmail Adapter
Email.gs should ultimately become a focused Gmail delivery adapter.
Its responsibility:
Receive completed email payload
        ↓
Send through Gmail
        ↓
Return success/failure
Render determines:
Why the email is being sent
Which client receives it
When it is sent
Which template applies
Subject
HTML
Personalization
Tally #2 URL
Business context
Apps Script performs Gmail delivery.

26. Utilities.gs
Utilities.gs contains shared Google-side utilities.
Current intended responsibility:
jsonResponse()
This provides standardized JSON responses from Apps Script.
Utilities remain focused on Google-side infrastructure rather than business rules.

27. Three-Layer Architecture
The final architecture has three distinct layers.
Layer 1 — External Services
Tally
Cal.com
LINE
Gmail
Google Sheets
Layer 2 — Google Adapter
Google Apps Script

├── Google Sheets operations
└── Gmail operations
Layer 3 — Application / Business Logic
Render / OpenClaw

├── Client lifecycle
├── Business rules
├── Event processing
├── CRM decisions
├── Booking logic
├── Cancellation logic
├── Abandoned-booking logic
├── Package logic
├── Session-credit logic
├── Email generation
├── LINE notification generation
└── Future automation
Core architecture:
External Services
       ↓
Render / OpenClaw
       ↓
Business Logic
       ↓
Google Apps Script
       ↓
Google Services

28. Render as the Business Brain
Render/OpenClaw is intended to own the complete business system.
It should determine:
Is this a new client?
Which CRM fields should be populated?
What is the client’s lifecycle stage?
Has the client booked?
Has the client cancelled?
Has the client completed a Free Intro?
Has 30 minutes elapsed?
Does the client require follow-up?
What package was selected?
How many session credits apply?
What notification should be generated?
What email should be generated?
Which Tally URL should be generated?
What should happen after a meeting ends?
What CRM state should result from an event?
These are application decisions.
They belong in Render.

29. Google Apps Script as the Google Adapter
Apps Script should operate as a deliberately thin adapter.
Its responsibilities are:
Render instruction
       ↓
Google-specific execution
       ↓
Result
       ↓
Render
Primary Google operations:
Google Sheets
    ├── Read
    ├── Find
    ├── Append
    └── Update

Gmail
    └── Send
Apps Script should not contain the Fluent with Kyle lifecycle engine.

30. Event-Driven Architecture
Render should treat external events as application events.
Primary events:
TALLY_SUBMISSION
BOOKING_CREATED
BOOKING_CANCELLED
MEETING_ENDED
ABANDONED_BOOKING_CHECK
Future events:
PAYMENT_RECEIVED
SESSION_COMPLETED
BOOKING_RESCHEDULED
SESSION_CREDIT_USED
PACKAGE_SELECTED
PACKAGE_RENEWED
Each event should eventually have a dedicated processing path.
Example:
BOOKING_CREATED
       ↓
Identify client
       ↓
Retrieve client context
       ↓
Process booking
       ↓
Determine lifecycle changes
       ↓
Update CRM
       ↓
Generate notification
       ↓
LINE
This creates the foundation for OpenClaw to eventually manage and extend the system.

31. Target Render Project Structure
The current structure should remain stable while the application is being validated.
Current:
openclaw-webhook/
├── package.json
├── index.js
└── services/
    ├── lineService.js
    ├── appsScript.js
    ├── tally.js
    └── cal.js
The next intermediate structure is:
openclaw-webhook/
├── package.json
├── index.js
│
├── services/
│   ├── lineService.js
│   ├── appsScript.js
│   ├── tally.js
│   └── cal.js
│
└── workflows/
    └── abandonedBooking.js
This is the immediate architectural target.

32. Future Domain-Oriented Structure
As the application grows, the Render application can evolve toward:
openclaw-webhook/
│
├── index.js
│
├── webhooks/
│   ├── tally.js
│   └── calcom.js
│
├── clients/
│   ├── clientService.js
│   └── clientRepository.js
│
├── bookings/
│   └── bookingService.js
│
├── cancellations/
│   └── cancellationService.js
│
├── abandoned/
│   └── abandonedBookingService.js
│
├── notifications/
│   ├── line.js
│   └── email.js
│
├── crm/
│   └── googleSheets.js
│
├── events/
│   └── eventProcessor.js
│
├── workflows/
│   └── ...
│
└── config/
    └── templates.js
The exact structure can evolve during implementation.
The objective is clear separation of business domains.

33. Immediate Refactoring Priority
The next architectural move is:
Current:
index.js
    ↓
contains abandoned-booking business logic
Move to:
index.js
    ↓
starts scheduler

workflows/abandonedBooking.js
    ↓
contains abandoned-booking workflow
This produces:
index.js
= Infrastructure + application startup

abandonedBooking.js
= Abandoned-booking business workflow
The existing four service modules remain intact.
There is no need to rebuild the system.

34. Environment Configuration
Before production hardening, external URLs and credentials should be environment-driven.
Current Apps Script configuration uses:
APPS_SCRIPT_URL
with a fallback URL currently present in the source.
The production architecture should move toward environment-variable-only configuration.
Target environment:
APPS_SCRIPT_URL
LINE_CHANNEL_ACCESS_TOKEN
LINE_USER_ID
PORT
SERVICE_URL
The Render service URL should also be configurable for keep-alive behavior.
Target:
process.env.SERVICE_URL
rather than embedding the Render URL directly inside application logic.
This makes the application portable across environments.

35. Current package.json
Current application dependencies:
express
axios
googleapis
Current package configuration:
openclaw-webhook
    ↓
node index.js
The existing structure is sufficient for the current architecture.
Additional dependencies should be introduced only when a specific architectural requirement exists.

36. Current System Capability Status
Capability
Current Status
Node server
Built
Express routing
Built
Tally integration
Built
Cal.com integration
Built
LINE integration
Built
Apps Script bridge
Built
CRM integration
Built
Tally #1 processing
Built
Package detection
Built
Session-credit calculation
Built
Booking processing
Built
Booking location → CRM
Built
Booking date/time → CRM
Built
1-on-1 / 1-on-2 detection
Built
Guest information → CRM
Built
Booking notes → CRM
Built
Booking → LINE context
Built
Abandoned-booking scheduler
Built
30-minute detection
Built
Follow-Up Needed transition
Built
Abandoned-booking LINE alert
Built
Cancellation processing
Built
Cancellation status/reason → CRM
Built
Cancellation → LINE alert
Built
Free Intro detection
Built
Meeting-ended processing
Built
Personalized Tally #2 URL
Built
Gmail delivery through Apps Script
Built
Email template retrieval
Built
Email personalization
Built
Modular service layer
Built
Dedicated workflow layer
Next
Domain-oriented Render architecture
Future
Centralized event processing
Future
Centralized lifecycle management
Future
OpenClaw management layer
Future
Advanced client lifecycle automation
Future


37. Updated Development Sequence
The original roadmap has now been updated to reflect the functionality already present in the current code.
Phase 1 — Current CRM & Workflow Foundation
Completed/current:
Tally #1 → CRM
Tally #1 diagnostic information → booking LINE notification
Cal.com location → CRM
Cal.com booking date/time → CRM
1-on-1 / 1-on-2 → CRM
Guest information → CRM
Booking notes → CRM
Abandoned-booking detection in Render
Abandoned-booking → Follow-Up Needed
Expanded abandoned-booking LINE context
Cancellation status/reason → CRM
Cancellation → LINE alert
Free Intro → personalized Tally #2 URL
Meeting-ended → follow-up email
Render → Apps Script communication

38. Phase 2 — Finish Centralizing Business Logic
Next:
Extract abandoned-booking workflow from index.js
Create workflows/abandonedBooking.js
Keep abandoned-booking decisions entirely inside Render
Add duplicate-alert prevention
Standardize client lifecycle states
Standardize CRM update payloads
Move email template-selection logic → Render
Move email personalization logic → Render
Move email HTML generation → Render
Simplify Email.gs into Gmail delivery
Expand CRM.gs into a clean Sheets adapter
Standardize Render → Apps Script actions
Standardize Apps Script response format
Standardize Render error handling
Move hard-coded service URLs → environment variables

39. Phase 3 — Refactor Render by Business Domain
After the current workflow layer is stable:
Client Service
Booking Service
Cancellation Service
Abandoned Booking Service
CRM Service
Notification Service
Email Generation Service
Event Processor
Target responsibilities:
Client Service
Client identity
Client lookup
Client normalization
Client lifecycle
Booking Service
Booking processing
Session type
Guest processing
Booking state
Booking information
Cancellation Service
Cancellation processing
Cancellation state
Recovery workflow
Abandoned Booking Service
Pending-booking detection
Timing
Eligibility
Follow-up state
Sales-recovery workflow
CRM Service
CRM decisions
Field mapping
State transitions
Apps Script CRM communication
Notification Service
LINE message generation
Notification routing
Email Generation Service
Template selection
Subject generation
HTML generation
Personalization
Tally URL generation

40. Phase 4 — Centralized Event Processing
Create a central event-processing layer.
Conceptually:
External Event
      ↓
Event Processor
      ↓
Identify event type
      ↓
Route to domain service
      ↓
Execute business logic
      ↓
Update CRM
      ↓
Communicate
Example:
BOOKING_CREATED
       ↓
eventProcessor
       ↓
bookingService
       ↓
clientService
       ↓
crmService
       ↓
notificationService
This gives every external event a consistent internal architecture.

41. Phase 5 — OpenClaw Management Layer
Once the Render business system is cleanly organized, OpenClaw can operate above the business services.
The objective is for OpenClaw to understand business-level capabilities rather than implementation details.
For example:
getClient()
updateClient()
findPendingBookings()
getBooking()
sendNotification()
sendEmail()
markFollowUpNeeded()
getClientLifecycle()
Rather than exposing Google-specific implementation details directly:
upsert_client
get_pending
get_client
send_email
The underlying integration details remain encapsulated within the Render application.

42. OpenClaw Business-Level Architecture
Target:
                   OPENCLAW
                       │
                       ▼
              Business-Level Tools
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
       Clients      Bookings     Lifecycle
          │            │            │
          └────────────┼────────────┘
                       │
                       ▼
                Render Services
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
       CRM           LINE           Email
        │                              │
        ▼                              ▼
 Apps Script                      Apps Script
        │                              │
        ▼                              ▼
 Google Sheets                    Personal Gmail
This is the point where OpenClaw becomes the management and intelligence layer over the existing business system.

43. Phase 6 — Documentation & Observability
Before OpenClaw manages the complete system, document:
All Render services
All workflows
All webhook events
All CRM fields
All lifecycle states
All state transitions
All external integrations
All Apps Script actions
All environment variables
All standardized payloads
All error states
All notification types
Then establish:
Standardized logs
Health monitoring
Service status
Workflow status
Integration diagnostics
Event tracking
The existing /health endpoint provides the initial foundation.

44. Complete Client Lifecycle
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

45. Abandoned Booking Lifecycle
Tally #1
   ↓
Client Profile Created
   ↓
Pending Booking
   ↓
30+ Minutes
   ↓
Render Detection
   ↓
Follow-Up Needed
   ↓
CRM Update
   ↓
LINE Sales-Recovery Alert
The decision belongs entirely to Render.

46. Cancellation Lifecycle
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

47. Future Payment Lifecycle
Future payment integration can follow the same architecture:
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
The payment provider can remain an external event source while Render owns the business interpretation.

48. Future Session Lifecycle
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
This provides a foundation for a complete client-management engine.

49. Final Architecture Principle
The final Fluent with Kyle architecture is:
Render / OpenClaw = Brain
Render owns:
Client lifecycle
Business rules
CRM decisions
Data normalization
Booking logic
Cancellation logic
Abandoned-booking logic
Package logic
Session-credit logic
Event processing
Email generation
LINE notification generation
Lifecycle transitions
Automation
Future business workflows
Google Apps Script = Google Adapter
Apps Script owns:
Google Sheets operations
Gmail delivery
Google Sheets = CRM
Google Sheets stores:
Client records
Diagnostic information
Package information
Payment information
Session credits
Booking information
Guest information
Cancellation information
Booking notes
Questions
Lifecycle state
Tally + Cal.com = Event Sources
They provide external events and client/booking information.
LINE + Gmail = Communication Channels
They deliver notifications and client communications.

50. Final System
                   TALLY
                      │
                      ▼
                 CAL.COM
                      │
                      ▼
             ┌─────────────────┐
             │ RENDER /        │
             │ OPENCLAW        │
             │                 │
             │ Business Brain  │
             └────────┬────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
        LINE        CRM         Email
          │           │           │
          │           ▼           │
          │    Google Apps       │
          │       Script         │
          │       │     │        │
          │       ▼     ▼        │
          │    Sheets  Gmail ◄───┘
          │
          ▼
     Notifications
The central principle remains:
Tally / Cal.com
       ↓
Render / OpenClaw
       ↓
Business Logic
       ↓
├── LINE
├── Google Apps Script → Google Sheets
└── Google Apps Script → Gmail
       ↓
Client Lifecycle
The system is therefore evolving through a controlled progression:
Current Working System
        ↓
Service-Modular System
        ↓
Workflow-Modular System
        ↓
Domain-Oriented Business System
        ↓
Centralized Event Processing
        ↓
OpenClaw Management Layer
        ↓
Complete Client Lifecycle Automation
The immediate next architectural action is:
CURRENT

index.js
├── Express
├── Routes
├── Health
├── Keep-Alive
└── Abandoned Booking Logic


NEXT

index.js
├── Express
├── Routes
├── Health
├── Keep-Alive
└── Start Scheduler

workflows/
└── abandonedBooking.js
    └── Abandoned Booking Business Logic
This preserves the tested system while progressively moving it toward the established Render-centered OpenClaw architecture.
The existing tally.js, cal.js, appsScript.js, and lineService.js remain the foundation during this transition. They can then be reorganized into business-domain services once the workflow layer is stable.
Final architectural rule:
Render/OpenClaw makes the business decisions.
Google Apps Script executes Google-specific operations.
Google Sheets stores the CRM record.
External services provide events and communication channels.
OpenClaw eventually manages the complete system through business-level capabilities.

