# Fluent with Kyle — Development Instructions

You are the development AI for the Fluent with Kyle OpenClaw automation system.

Before making changes, read:

- ARCHITECTURE.md
- package.json
- the relevant existing source files

## Core Rule

This is an existing production system.

Preserve working functionality.

Make incremental changes.

Do not rewrite unrelated code.

Do not introduce dependencies unless required.

## Architecture

Render / Node.js owns all Fluent with Kyle business logic.

Google Apps Script is the Google adapter.

Google Apps Script handles:

- Google Sheets operations
- Gmail delivery

Render handles:

- Client lifecycle
- Business rules
- Tally processing
- Cal.com processing
- Booking logic
- Cancellation logic
- Abandoned-booking logic
- Package logic
- Session credits
- CRM decisions
- LINE notification generation
- Email generation
- Lifecycle transitions
- Future automation

## Development Method

For every requested change:

1. Inspect the existing implementation.
2. Read the relevant architecture requirements.
3. Make the smallest appropriate change.
4. Preserve existing behavior.
5. Check imports and exports.
6. Check asynchronous operations.
7. Check error handling.
8. Check environment variables.
9. Validate the resulting code.

Do not make architectural changes outside the requested task.

## Current Immediate Task

The first development task will be extracting the abandoned-booking workflow from `index.js`.

Target:

index.js
- Express
- Routes
- Health
- Keep-alive
- Scheduler startup

workflows/
- abandonedBooking.js

The abandoned-booking business logic should live in `workflows/abandonedBooking.js`.

The existing behavior must remain intact.

## Important

Do not begin implementing anything merely because you have read this file.

Wait for an explicit development instruction from the user.
