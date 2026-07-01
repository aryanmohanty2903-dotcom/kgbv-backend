# KGBV HelpDesk Backend Implementation Plan

This plan details the step-by-step approach to implementing the KGBV HelpDesk Backend based on the technical documentation provided. 

## User Review Required

> [!IMPORTANT]
> Please review the module-wise approach below and let me know if you approve this plan to proceed with execution.
> We will be using ES Modules (`type: "module"`) and `nodemon` for the Express server, as requested.

## Proposed Changes

### 1. Project Initialization & Setup
- Initialize a Node.js project.
- Configure `package.json` with `"type": "module"`.
- Install core dependencies: `express`, `cors`, `helmet`, `zod`, `dotenv`.
- Install development dependencies: `nodemon`, `prisma`.
- Configure `nodemon.json` or update `package.json` scripts to use `nodemon src/server.js`.
- Create the recommended folder structure (`src/config`, `src/modules`, `src/jobs`, `src/middlewares`, `src/utils`).
- Initialize Prisma (`npx prisma init`) and set up the schema based on section 4 of the documentation.

### 2. Module Implementation

Following the recommended implementation order, we will build out the application module by module.

#### Phase 1: Core Access & Master Data
*   **Module 1: Auth & Users (src/modules/auth & src/modules/users)**
    *   Setup JWT authentication, password hashing, and login/refresh logic.
    *   Implement user CRUD and RBAC (Role-Based Access Control) middleware.
*   **Module 2: School & Category Master (src/modules/schools & src/modules/categories)**
    *   Implement School CRUD, filtering, and bulk import.
    *   Implement L1/L2 Category tree APIs.

#### Phase 1.5: Granular User Permissions
*   **Module 1.5: User-Level Permissions Refactor**
    *   Update `schema.prisma` to add a `permissions` `Json` field to the `User` model to store structured module-specific permissions.
    *   Update user validation (`src/validations/users.validation.js`) to validate the incoming JSON object structure for permissions.
    *   Create a new middleware `requirePermissions` in `auth.middleware.js` to parse and check the JSON object for required module/action access.
    *   Update `auth.controller.js` to return the structured `permissions` JSON alongside user details upon login.
#### Phase 2: Ticket Core & Lifecycle
*   **Module 3: Ticket Module (src/modules/tickets)**
    *   Ticket creation, validation (Zod), and ticket number generation logic.
    *   Implement ticket lifecycle transitions (start, resolve, reopen, close).
    *   Implement Comments & attachment metadata tracking.
*   **Module 4: SLA Policy (src/modules/sla)**
    *   Implement SLA policy management.
    *   Add SLA calculation logic to automatically set due dates during ticket creation.

#### Phase 3: Routing & Escalation
*   **Module 5: AI Routing Boundary (src/modules/integrations/routing)**
    *   Build the adapter to queue routing requests to the external Python service and handle fallbacks.
*   **Module 6: Escalation & Matrix (src/modules/escalation)**
    *   Implement escalation matrix CRUD.
    *   Create the background worker (`slaEscalation.job.js`) for auto-escalating tickets upon SLA breaches.

#### Phase 4: Integrations & Notifications
*   **Module 7: Notifications & Providers (src/modules/notifications, msg91, resend)**
    *   Set up MSG91 for SMS and Resend for Emails.
    *   Implement notification queueing and retry worker (`notificationRetry.job.js`).
*   **Module 8: Cloudinary Attachments (src/modules/integrations/cloudinary)**
    *   Configure Cloudinary adapter for handling attachment uploads and metadata.

#### Phase 5: Feedback & Auto-Closure
*   **Module 9: Feedback (src/modules/feedback)**
    *   Implement feedback capture APIs.
    *   Create the auto-close background job (`autoCloseTickets.job.js`).

#### Phase 6: Insights & Audit
*   **Module 10: Dashboard APIs (src/modules/dashboard)**
    *   Build endpoints for summary cards, heatmap data, category breakdowns.
*   **Module 11: Reports (src/modules/reports)**
    *   Implement ticket summary, SLA compliance, and agent performance reports.
    *   Set up async report export jobs.
*   **Module 12: Audit Module (src/modules/audit)**
    *   Implement centralized audit logging for all critical state changes.

### 3. Server Configuration
- Integrate all module routes into `src/app.js`.
- Set up global error handling and request validation middlewares.
- Start the server in `src/server.js`.

## Verification Plan

### Automated Tests
- Run Prisma migrations to ensure schema correctness.
- Write unit tests for core utilities (e.g., ticket number generation, SLA calculations).

### Manual Verification
- Start the server using `nodemon` to verify proper startup and ES Module compatibility.
- Test critical API endpoints using an HTTP client (e.g., Postman or simple fetch scripts) for:
    - Authentication and token generation.
    - Creating a school and category.
    - Creating a ticket and validating its lifecycle transitions.
