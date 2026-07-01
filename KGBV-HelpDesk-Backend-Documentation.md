# KGBV HelpDesk Backend Technical Documentation

Version: 2.0  
Stack: Express.js using JavaScript, Prisma ORM, Neon PostgreSQL, Zod  
Scope: Backend API, database schema, RBAC, ticket lifecycle, SLA, escalation, notifications, reporting, and integration boundaries  
Out of scope: Python AI auto-routing microservice implementation

## 1. Backend Objective

The backend must support a centralized AI-enabled HelpDesk ticketing system for all KGBV schools without custom code per school. Schools, categories, SLA rules, escalation contacts, agents, and reporting dimensions must be data-driven.

The system should comfortably support:

- 2,000+ schools
- 200+ concurrent users
- 10,000+ tickets per month
- Multi-channel ticket intake: phone, email, manual, web
- SLA tracking, escalation, feedback, reports, and dashboards
- Future auto-routing through a separate Python microservice

## 2. Architecture Overview

### 2.1 Services

| Component | Technology | Responsibility |
|---|---|---|
| API Server | Express.js | REST APIs, auth, RBAC, ticket workflow |
| Database | Neon PostgreSQL | Transactional data, audit logs, reports |
| ORM | Prisma | Schema, migrations, generated JS client |
| Validation | Zod | Request body, params, query, and env validation |
| Background Workers | Node.js worker process | SLA scans, auto-close, email polling, notification retries |
| Queue | BullMQ + Redis, or managed queue | Async notifications, routing requests, report exports |
| SMS Provider | MSG91 | Ticket creation, escalation, resolution, feedback SMS |
| Email Provider | Resend | Ticket confirmation, escalation alerts, resolution emails |
| File Storage | Cloudinary | Ticket attachments, images, exported report files |
| Python Routing Service | External microservice | Auto assignment recommendation only |

### 2.2 Recommended Backend Folder Structure

```txt
backend/
  prisma/
    schema.prisma
    migrations/
    seed.js
  src/
    app.js
    server.js
    config/
      env.js
      prisma.js
      redis.js
      cloudinary.js
      resend.js
      msg91.js
    modules/
      auth/
        auth.routes.js
        auth.controller.js
        auth.service.js
        auth.validation.js
      users/
      schools/
      tickets/
      categories/
      sla/
      escalation/
      notifications/
      feedback/
      reports/
      audit/
      integrations/
        routing/
        msg91/
        resend/
        cloudinary/
    jobs/
      slaEscalation.job.js
      autoCloseTickets.job.js
      emailInbound.job.js
      notificationRetry.job.js
    workers/
    middlewares/
    utils/
```

## 3. Core Design Principles

1. One centralized system for all schools.
2. Never create separate code paths per school.
3. Use `school_id`, district, block, category, role, priority, and configuration tables for filtering and routing.
4. Keep ticket workflow strict through backend state transitions.
5. Store every ticket action in audit logs.
6. Run SLA and escalation logic through workers, not frontend timers.
7. Keep Python auto-routing independent. Backend sends ticket context and receives assignment recommendation.
8. Use Zod schemas for every create/update/filter endpoint.
9. Keep provider code isolated behind adapters: `msg91.service.js`, `resend.service.js`, and `cloudinary.service.js`.

## 4. Prisma Schema

Use this as the production baseline. Field names are intentionally explicit for long-term maintainability.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
}

enum RoleCode {
  HELP_DESK_AGENT
  SUPERVISOR
  DEPARTMENT_AUTHORITY
  SYSTEM_ADMIN
}

enum TicketChannel {
  PHONE
  EMAIL
  MANUAL
  WEB
}

enum TicketPriority {
  P1_CRITICAL
  P2_HIGH
  P3_MEDIUM
  P4_LOW
}

enum TicketStatus {
  OPEN
  IN_PROGRESS
  ESCALATED
  RESOLVED
  REOPENED
  CLOSED
  CANCELLED
}

enum AssignmentSource {
  SYSTEM
  AI_ROUTING
  SUPERVISOR
  MANUAL
}

enum EscalationTrigger {
  FIRST_RESPONSE_SLA_BREACH
  RESOLUTION_SLA_BREACH
  MANUAL
  REOPENED
}

enum NotificationChannel {
  EMAIL
  SMS
  IN_APP
  WEBHOOK
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
  RETRYING
}

enum AuditAction {
  CREATE
  UPDATE
  ASSIGN
  STATUS_CHANGE
  COMMENT
  ESCALATE
  RESOLVE
  REOPEN
  CLOSE
  FEEDBACK
  ATTACHMENT_UPLOAD
  LOGIN
}

model User {
  id              String     @id @default(uuid())
  fullName        String
  email           String     @unique
  phone           String?
  passwordHash    String
  status          UserStatus @default(ACTIVE)
  mfaEnabled      Boolean    @default(false)
  lastLoginAt     DateTime?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  roles           UserRole[]
  agentProfile    AgentProfile?
  assignedTickets Ticket[]   @relation("AssignedAgent")
  createdTickets  Ticket[]   @relation("CreatedBy")
  comments        TicketComment[]
  auditLogs       AuditLog[]
}

model Role {
  id          String   @id @default(uuid())
  code        RoleCode @unique
  name        String
  description String?
  createdAt   DateTime @default(now())

  users       UserRole[]
}

model UserRole {
  id        String   @id @default(uuid())
  userId    String
  roleId    String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id])
  role      Role     @relation(fields: [roleId], references: [id])

  @@unique([userId, roleId])
  @@index([roleId])
}

model AgentProfile {
  id                    String   @id @default(uuid())
  userId                String   @unique
  maxOpenTickets        Int      @default(50)
  isAvailableForRouting Boolean  @default(true)
  skills                Json?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  user                  User     @relation(fields: [userId], references: [id])
}

model School {
  id          String   @id @default(uuid())
  schoolCode  String   @unique
  name        String
  district    String
  block       String?
  village     String?
  address     String?
  latitude    Decimal? @db.Decimal(10, 7)
  longitude   Decimal? @db.Decimal(10, 7)
  contactName String?
  contactPhone String?
  contactEmail String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tickets     Ticket[]

  @@index([district])
  @@index([block])
  @@index([isActive])
}

model Category {
  id          String     @id @default(uuid())
  parentId    String?
  name        String
  code        String     @unique
  description String?
  isActive    Boolean    @default(true)
  sortOrder   Int        @default(0)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  parent      Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children    Category[] @relation("CategoryTree")
  ticketsL1   Ticket[]   @relation("TicketCategoryL1")
  ticketsL2   Ticket[]   @relation("TicketCategoryL2")

  @@index([parentId])
  @@index([isActive])
}

model Ticket {
  id                    String           @id @default(uuid())
  ticketNumber          String           @unique
  schoolId              String
  channel               TicketChannel
  callerName            String?
  callerPhone           String?
  callerEmail           String?
  categoryL1Id          String
  categoryL2Id          String?
  title                 String
  description           String
  priority              TicketPriority   @default(P3_MEDIUM)
  status                TicketStatus     @default(OPEN)
  assignedAgentId       String?
  assignmentSource      AssignmentSource?
  createdById           String?
  firstRespondedAt      DateTime?
  firstResponseDueAt    DateTime
  resolutionDueAt       DateTime
  resolvedAt            DateTime?
  closedAt              DateTime?
  resolutionNotes       String?
  reopenCount           Int              @default(0)
  escalationLevel       Int              @default(0)
  lastEscalatedAt       DateTime?
  metadata              Json?
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt

  school                School           @relation(fields: [schoolId], references: [id])
  categoryL1            Category         @relation("TicketCategoryL1", fields: [categoryL1Id], references: [id])
  categoryL2            Category?        @relation("TicketCategoryL2", fields: [categoryL2Id], references: [id])
  assignedAgent         User?            @relation("AssignedAgent", fields: [assignedAgentId], references: [id])
  createdBy             User?            @relation("CreatedBy", fields: [createdById], references: [id])
  comments              TicketComment[]
  attachments           TicketAttachment[]
  statusHistory         TicketStatusHistory[]
  escalations           EscalationLog[]
  feedback              TicketFeedback?
  notifications         Notification[]
  auditLogs             AuditLog[]
  routingRequests       RoutingRequest[]

  @@index([schoolId])
  @@index([status])
  @@index([priority])
  @@index([assignedAgentId])
  @@index([createdAt])
  @@index([firstResponseDueAt])
  @@index([resolutionDueAt])
  @@index([status, resolutionDueAt])
  @@index([categoryL1Id, categoryL2Id])
}

model TicketStatusHistory {
  id           String       @id @default(uuid())
  ticketId     String
  fromStatus   TicketStatus?
  toStatus     TicketStatus
  changedById  String?
  reason       String?
  createdAt    DateTime     @default(now())

  ticket       Ticket       @relation(fields: [ticketId], references: [id])

  @@index([ticketId])
  @@index([createdAt])
}

model TicketComment {
  id          String   @id @default(uuid())
  ticketId    String
  authorId    String
  body        String
  isInternal  Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  ticket      Ticket   @relation(fields: [ticketId], references: [id])
  author      User     @relation(fields: [authorId], references: [id])

  @@index([ticketId])
  @@index([authorId])
}

model TicketAttachment {
  id          String   @id @default(uuid())
  ticketId    String
  fileName    String
  mimeType    String
  fileSize    Int
  storageKey  String
  uploadedById String?
  createdAt   DateTime @default(now())

  ticket      Ticket   @relation(fields: [ticketId], references: [id])

  @@index([ticketId])
}

model SlaPolicy {
  id                   String         @id @default(uuid())
  priority             TicketPriority @unique
  firstResponseMinutes Int
  resolutionMinutes    Int
  isActive             Boolean        @default(true)
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt
}

model EscalationMatrix {
  id                     String         @id @default(uuid())
  level                  Int
  priority               TicketPriority?
  triggerAfterMinutes    Int
  authorityRole          RoleCode
  authorityName          String?
  authorityEmail         String?
  authorityPhone         String?
  notificationChannels   NotificationChannel[]
  isActive               Boolean        @default(true)
  createdAt              DateTime       @default(now())
  updatedAt              DateTime       @updatedAt

  @@index([level])
  @@index([priority])
  @@index([isActive])
}

model EscalationLog {
  id                 String             @id @default(uuid())
  ticketId            String
  fromLevel           Int
  toLevel             Int
  trigger             EscalationTrigger
  reason              String?
  notifiedVia         NotificationChannel[]
  escalatedById       String?
  authorityEmail      String?
  authorityPhone      String?
  createdAt           DateTime           @default(now())

  ticket              Ticket             @relation(fields: [ticketId], references: [id])

  @@index([ticketId])
  @@index([toLevel])
  @@index([createdAt])
}

model TicketFeedback {
  id          String   @id @default(uuid())
  ticketId    String   @unique
  rating      Int
  comment     String?
  source      TicketChannel?
  submittedAt DateTime @default(now())

  ticket      Ticket   @relation(fields: [ticketId], references: [id])
}

model Notification {
  id              String              @id @default(uuid())
  ticketId         String?
  channel          NotificationChannel
  status           NotificationStatus @default(PENDING)
  recipient        String
  subject          String?
  body             String
  providerMessageId String?
  failureReason    String?
  retryCount       Int                @default(0)
  scheduledAt      DateTime           @default(now())
  sentAt           DateTime?
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt

  ticket           Ticket?            @relation(fields: [ticketId], references: [id])

  @@index([ticketId])
  @@index([status, scheduledAt])
  @@index([channel])
}

model RoutingRequest {
  id                 String   @id @default(uuid())
  ticketId            String
  requestPayload      Json
  responsePayload     Json?
  recommendedAgentId  String?
  confidenceScore     Decimal? @db.Decimal(5, 4)
  status              String   @default("PENDING")
  failureReason       String?
  createdAt           DateTime @default(now())
  respondedAt         DateTime?

  ticket              Ticket   @relation(fields: [ticketId], references: [id])

  @@index([ticketId])
  @@index([status])
}

model InboundEmail {
  id          String   @id @default(uuid())
  messageId   String   @unique
  fromEmail   String
  subject     String
  bodyText    String?
  bodyHtml    String?
  ticketId    String?
  processedAt DateTime?
  createdAt   DateTime @default(now())

  @@index([processedAt])
}

model ApiKey {
  id          String   @id @default(uuid())
  name        String
  keyHash     String   @unique
  scopes      String[]
  isActive    Boolean  @default(true)
  expiresAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model AuditLog {
  id          String      @id @default(uuid())
  actorUserId String?
  action      AuditAction
  entityType  String
  entityId    String
  ticketId    String?
  ipAddress   String?
  userAgent   String?
  before      Json?
  after       Json?
  createdAt   DateTime    @default(now())

  actorUser   User?       @relation(fields: [actorUserId], references: [id])
  ticket      Ticket?     @relation(fields: [ticketId], references: [id])

  @@index([actorUserId])
  @@index([entityType, entityId])
  @@index([ticketId])
  @@index([createdAt])
}
```

## 5. Seed Data Requirements

### 5.1 Roles

| Role | Responsibility |
|---|---|
| HELP_DESK_AGENT | Create, update, respond, resolve assigned tickets |
| SUPERVISOR | Assign, reassign, manually escalate, view team reports |
| DEPARTMENT_AUTHORITY | View escalated tickets, dashboards, SLA reports |
| SYSTEM_ADMIN | Manage users, schools, categories, SLA, escalation matrix |

### 5.2 Categories

Use a parent-child category tree.

| L1 | L2 |
|---|---|
| Hardware | Computing Devices |
| Hardware | Peripheral & Accessories |
| Hardware | Infrastructure Equipment |
| Software | Operating System |
| Software | Application / Software |
| Software | Data / Access Issue |
| Connectivity | Internet Connectivity |
| Connectivity | LAN / Network |
| Connectivity | VPN / Remote Access |
| Other | General / Miscellaneous |

### 5.3 Default SLA Policies

| Priority | First Response | Resolution |
|---|---:|---:|
| P1_CRITICAL | 30 minutes | 4 hours |
| P2_HIGH | 120 minutes | 8 hours |
| P3_MEDIUM | 240 minutes | 24 hours |
| P4_LOW | 480 minutes | 48 hours |

## 6. Ticket Number Format

Format:

```txt
KGBV-YYYYMMDD-000001
```

Implementation recommendation:

- Generate inside a DB transaction.
- Use a daily sequence table or PostgreSQL sequence.
- Do not calculate by counting existing tickets because concurrent creation can create duplicates.

## 7. Ticket Lifecycle

Allowed transitions:

| Current | Allowed Next |
|---|---|
| OPEN | IN_PROGRESS, ESCALATED, CANCELLED |
| IN_PROGRESS | ESCALATED, RESOLVED, CANCELLED |
| ESCALATED | IN_PROGRESS, RESOLVED, CANCELLED |
| RESOLVED | REOPENED, CLOSED |
| REOPENED | IN_PROGRESS, ESCALATED, RESOLVED |
| CLOSED | None |
| CANCELLED | None |

Rules:

- `resolutionNotes` is mandatory before moving to `RESOLVED`.
- `firstRespondedAt` is set when status first becomes `IN_PROGRESS`.
- `resolvedAt` is set when status becomes `RESOLVED`.
- `closedAt` is set when status becomes `CLOSED`.
- All transitions must write to `TicketStatusHistory` and `AuditLog`.

## 8. API Documentation

Base path:

```txt
/api/v1
```

### 8.1 Authentication

#### POST `/auth/login`

Request:

```json
{
  "email": "agent@example.com",
  "password": "password"
}
```

Response:

```json
{
  "accessToken": "jwt",
  "refreshToken": "jwt",
  "user": {
    "id": "uuid",
    "fullName": "Helpdesk Agent",
    "roles": ["HELP_DESK_AGENT"]
  }
}
```

#### POST `/auth/refresh`

Refreshes JWT.

#### POST `/auth/logout`

Invalidates refresh token.

### 8.2 Schools

#### GET `/schools`

Query:

- `district`
- `block`
- `search`
- `isActive`
- `page`
- `limit`

Use this endpoint for all dropdowns and filters. Do not hardcode school lists in frontend.

#### POST `/schools`

Allowed roles: `SYSTEM_ADMIN`

Creates one school.

#### POST `/schools/import`

Allowed roles: `SYSTEM_ADMIN`

Bulk-imports schools from CSV/Excel after validation.

### 8.3 Categories

#### GET `/categories/tree`

Returns active L1/L2 issue taxonomy.

#### POST `/categories`

Allowed roles: `SYSTEM_ADMIN`

Creates category.

### 8.4 Tickets

#### POST `/tickets`

Allowed roles:

- `HELP_DESK_AGENT`
- `SUPERVISOR`
- service API key for email/telephony/web intake

Request:

```json
{
  "schoolId": "uuid",
  "channel": "PHONE",
  "callerName": "Caller Name",
  "callerPhone": "9876543210",
  "callerEmail": null,
  "categoryL1Id": "uuid",
  "categoryL2Id": "uuid",
  "title": "Internet not working",
  "description": "School broadband is down since morning",
  "priority": "P1_CRITICAL"
}
```

Response:

```json
{
  "id": "uuid",
  "ticketNumber": "KGBV-20260625-000001",
  "status": "OPEN",
  "firstResponseDueAt": "2026-06-25T10:30:00.000Z",
  "resolutionDueAt": "2026-06-25T14:00:00.000Z",
  "assignedAgentId": "uuid"
}
```

Backend actions:

1. Validate school and category.
2. Generate ticket number.
3. Load SLA policy by priority.
4. Calculate response and resolution due timestamps.
5. Create ticket.
6. Send assignment request to routing boundary if enabled.
7. Write audit log.
8. Queue ticket creation notification.

#### GET `/tickets`

Query:

- `status`
- `priority`
- `schoolId`
- `district`
- `categoryL1Id`
- `categoryL2Id`
- `assignedAgentId`
- `channel`
- `createdFrom`
- `createdTo`
- `page`
- `limit`
- `sortBy`
- `sortOrder`

Use indexed columns for filters.

#### GET `/tickets/:id`

Returns full ticket detail with:

- school
- categories
- assigned agent
- comments
- attachments
- status history
- escalation logs
- feedback

#### PATCH `/tickets/:id`

Updates editable ticket fields. Status changes should use dedicated transition endpoints.

#### POST `/tickets/:id/start`

Moves `OPEN` or `REOPENED` ticket to `IN_PROGRESS`.

#### POST `/tickets/:id/assign`

Allowed roles: `SUPERVISOR`, `SYSTEM_ADMIN`

Request:

```json
{
  "assignedAgentId": "uuid",
  "reason": "Manual assignment by supervisor"
}
```

#### POST `/tickets/:id/escalate`

Allowed roles: `SUPERVISOR`, `SYSTEM_ADMIN`

Request:

```json
{
  "toLevel": 2,
  "reason": "Repeated connectivity outage unresolved"
}
```

#### POST `/tickets/:id/resolve`

Allowed roles: assigned agent, `SUPERVISOR`

Request:

```json
{
  "resolutionNotes": "Router configuration restored and connectivity verified."
}
```

Backend actions:

1. Validate mandatory notes.
2. Change status to `RESOLVED`.
3. Set `resolvedAt`.
4. Queue SMS/email resolution notification.
5. Queue feedback request.
6. Schedule 48-hour auto-close.

#### POST `/tickets/:id/reopen`

Request:

```json
{
  "reason": "Caller rejected resolution"
}
```

#### POST `/tickets/:id/close`

Allowed roles: `SUPERVISOR`, `SYSTEM_ADMIN`, auto-close worker

### 8.5 Comments

#### POST `/tickets/:id/comments`

Request:

```json
{
  "body": "Checked with school coordinator. Issue still active.",
  "isInternal": true
}
```

### 8.6 Attachments

#### POST `/tickets/:id/attachments/signature`

Returns a Cloudinary upload signature or backend upload policy.

Recommended approach:

- For small files, upload through backend using Cloudinary SDK.
- For larger image/PDF uploads, generate a signed Cloudinary upload request.
- Store only Cloudinary metadata in `TicketAttachment`: `fileName`, `mimeType`, `fileSize`, `storageKey`, and secure URL inside metadata if needed.

#### POST `/tickets/:id/attachments`

Stores uploaded file metadata.

### 8.7 SLA

#### GET `/sla-policies`

#### PUT `/sla-policies/:id`

Allowed roles: `SYSTEM_ADMIN`

Updates SLA values. New values apply to new tickets only unless admin explicitly recalculates open tickets.

### 8.8 Escalation Matrix

#### GET `/escalation-matrix`

#### POST `/escalation-matrix`

#### PUT `/escalation-matrix/:id`

Allowed roles: `SYSTEM_ADMIN`

### 8.9 Feedback

#### POST `/tickets/:id/feedback`

Request:

```json
{
  "rating": 5,
  "comment": "Issue resolved quickly",
  "source": "WEB"
}
```

Validation:

- Rating must be between 1 and 5.
- Only one feedback record per ticket.

### 8.10 Reports

#### GET `/reports/ticket-summary`

Query:

- `from`
- `to`
- `district`
- `schoolId`
- `categoryL1Id`

Returns:

- total tickets
- open tickets
- resolved tickets
- closed tickets
- escalated tickets
- SLA compliance percentage
- average resolution time

#### GET `/reports/sla-compliance`

#### GET `/reports/category-breakdown`

#### GET `/reports/school-wise`

#### GET `/reports/agent-performance`

#### GET `/reports/csat`

#### POST `/reports/export`

Queues CSV/PDF export.

## 9. Python Auto-Routing Integration Boundary

No Python implementation is included here. Backend should only expose a clean contract.

Recommended flow:

1. Ticket is created.
2. Backend queues a routing request.
3. Worker sends ticket context to routing service.
4. Routing service returns recommended agent.
5. Backend validates that the agent exists and is available.
6. Backend assigns ticket and logs `assignmentSource = AI_ROUTING`.
7. If routing fails, fallback to supervisor queue or round-robin assignment.

Internal backend interface:

Routing request payload:

```json
{
  "ticketId": "uuid",
  "schoolId": "uuid",
  "district": "Khurda",
  "categoryL1": "Connectivity",
  "categoryL2": "Internet Connectivity",
  "priority": "P1_CRITICAL",
  "channel": "PHONE",
  "description": "Internet is down since morning",
  "availableAgents": [
    {
      "id": "uuid",
      "openTicketCount": 12,
      "skills": ["Connectivity", "Hardware"]
    }
  ]
}
```

Expected response:

```json
{
  "recommendedAgentId": "uuid",
  "confidenceScore": 0.91,
  "reason": "Agent has connectivity skill and low current workload"
}
```

## 10. Background Jobs

### 10.1 SLA Escalation Job

Frequency: every 5 minutes in production.

Logic:

1. Find tickets where status is `OPEN`, `IN_PROGRESS`, `REOPENED`, or `ESCALATED`.
2. If `firstRespondedAt` is null and `firstResponseDueAt` has passed, escalate level 1.
3. If `resolvedAt` is null and `resolutionDueAt` has passed, escalate level 2 or higher based on matrix.
4. Create `EscalationLog`.
5. Update ticket status to `ESCALATED`.
6. Queue notifications.
7. Write audit log.

Important:

- Use row-level locking or idempotency checks to avoid duplicate escalations.
- Do not escalate closed/resolved/cancelled tickets.

### 10.2 Auto-Close Job

Frequency: every 30 minutes.

Logic:

1. Find `RESOLVED` tickets where `resolvedAt <= now - 48 hours`.
2. If not reopened, set status to `CLOSED`.
3. Set `closedAt`.
4. Write audit log.

### 10.3 Notification Retry Job

Frequency: every 5 minutes.

Retries failed MSG91 SMS, Resend email, and in-app notifications with exponential backoff.

### 10.4 Inbound Email Job

Frequency: every 1-2 minutes, or use webhook if email provider supports it.

Logic:

1. Read unread support mailbox messages.
2. Deduplicate by email `messageId`.
3. Create `InboundEmail`.
4. Create ticket with channel `EMAIL`.
5. Attach parsed metadata.

## 11. RBAC Matrix

| Feature | Agent | Supervisor | Authority | Admin |
|---|---:|---:|---:|---:|
| Create ticket | Yes | Yes | No | Yes |
| View assigned tickets | Yes | Yes | No | Yes |
| View all tickets | No | Yes | Yes | Yes |
| Assign ticket | No | Yes | No | Yes |
| Resolve ticket | Yes | Yes | No | Yes |
| Manual escalation | No | Yes | No | Yes |
| Configure SLA | No | No | No | Yes |
| Configure escalation matrix | No | No | No | Yes |
| Manage schools | No | No | No | Yes |
| View reports | Limited | Yes | Yes | Yes |
| Manage users | No | No | No | Yes |

## 12. Validation Rules

Ticket creation:

- `schoolId` is required and must be active.
- `channel` is required.
- `categoryL1Id` is required.
- `categoryL2Id` is recommended and should be required unless category is `Other`.
- `callerPhone` is required for phone tickets.
- `callerEmail` is required for email/web tickets.
- `description` minimum 10 characters.
- `priority` defaults to `P3_MEDIUM` if not supplied.

Resolution:

- `resolutionNotes` required.
- Ticket must not be `CLOSED` or `CANCELLED`.

Feedback:

- Ticket must be `RESOLVED` or `CLOSED`.
- Rating must be 1-5.

## 13. Security Requirements

- JWT access tokens with short expiry.
- Refresh token rotation.
- Passwords hashed with Argon2 or bcrypt.
- MFA for `SYSTEM_ADMIN` and `DEPARTMENT_AUTHORITY`.
- Rate limiting for auth and public intake endpoints.
- API key auth for telephony/email service integrations.
- Request validation with Zod.
- Centralized error handler.
- Helmet security headers.
- CORS allowlist.
- Audit logging for all sensitive actions.
- PII fields protected in logs.

### 13.1 Zod Validation Pattern

Each module should have a `*.validation.js` file. Controllers should not manually validate fields.

Example:

```js
const { z } = require("zod");

const createTicketSchema = z.object({
  body: z.object({
    schoolId: z.string().uuid(),
    channel: z.enum(["PHONE", "EMAIL", "MANUAL", "WEB"]),
    callerName: z.string().trim().min(2).optional(),
    callerPhone: z.string().regex(/^[6-9]\d{9}$/).optional(),
    callerEmail: z.string().email().optional(),
    categoryL1Id: z.string().uuid(),
    categoryL2Id: z.string().uuid().optional(),
    title: z.string().trim().min(5).max(160),
    description: z.string().trim().min(10),
    priority: z.enum(["P1_CRITICAL", "P2_HIGH", "P3_MEDIUM", "P4_LOW"]).default("P3_MEDIUM")
  })
});

module.exports = {
  createTicketSchema
};
```

Use one shared middleware:

```js
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params
  });

  if (!result.success) {
    return res.status(400).json({
      message: "Validation failed",
      errors: result.error.flatten()
    });
  }

  req.validated = result.data;
  return next();
};

module.exports = validate;
```

## 14. Scalability Notes for 2,000 Schools

Do:

- Store all schools in `School` master table.
- Filter by school, district, block through indexed columns.
- Use pagination for every list endpoint.
- Use async jobs for email, SMS, routing, reports, and escalation.
- Use read-optimized report queries or materialized views when ticket volume grows.
- Use database indexes listed in Prisma schema.
- Keep dashboard queries aggregated and cached for 30-60 seconds where acceptable.

Do not:

- Create separate tables per school.
- Create separate deployments per school.
- Hardcode school-specific logic.
- Load all 2,000 schools into heavy frontend screens without search/pagination.

## 15. Neon PostgreSQL Recommendations

- Use connection pooling.
- Configure Prisma with pooled Neon connection string for API runtime.
- Use direct connection string only for migrations.
- Keep database transactions short.
- Avoid long-running report queries on live API request path.

Example env:

```env
DATABASE_URL="postgresql://user:password@host/db?sslmode=require&pgbouncer=true"
DIRECT_URL="postgresql://user:password@host/db?sslmode=require"
JWT_ACCESS_SECRET="change-me"
JWT_REFRESH_SECRET="change-me"
REDIS_URL="redis://localhost:6379"
MSG91_AUTH_KEY="change-me"
MSG91_SENDER_ID="KGBVHD"
MSG91_TEMPLATE_TICKET_CREATED="template-id"
MSG91_TEMPLATE_ESCALATION="template-id"
MSG91_TEMPLATE_RESOLUTION="template-id"
RESEND_API_KEY="re_change_me"
RESEND_FROM_EMAIL="KGBV HelpDesk <support@example.com>"
CLOUDINARY_CLOUD_NAME="change-me"
CLOUDINARY_API_KEY="change-me"
CLOUDINARY_API_SECRET="change-me"
ROUTING_SERVICE_URL="http://routing-service:8000"
```

## 16. Provider Integrations

### 16.1 MSG91 SMS Adapter

Create one adapter at `src/modules/integrations/msg91/msg91.service.js`.

Responsibilities:

- Send ticket creation SMS.
- Send SLA escalation SMS.
- Send ticket resolved SMS.
- Send feedback rating SMS.
- Parse delivery failures into `Notification.failureReason`.

Do not call MSG91 directly from controllers. Controllers should create a notification job, and the worker should call the MSG91 adapter.

Recommended functions:

```js
async function sendSms({ to, templateId, variables, ticketId }) {}
async function sendTicketCreatedSms({ to, ticketNumber, schoolName }) {}
async function sendEscalationSms({ to, ticketNumber, level }) {}
async function sendResolutionSms({ to, ticketNumber, summary }) {}
```

### 16.2 Resend Email Adapter

Create one adapter at `src/modules/integrations/resend/resend.service.js`.

Responsibilities:

- Send ticket confirmation email.
- Send assignment email.
- Send escalation email.
- Send resolution email.
- Send report export links.

Important email intake note:

- Use Resend for outbound transactional emails.
- For email-to-ticket intake, use a receiving mailbox/webhook flow supported by your email setup.
- If inbound email is not available through the same provider setup, connect a department support mailbox through IMAP polling or a mail routing webhook, then create tickets through the backend service API.

Recommended functions:

```js
async function sendEmail({ to, subject, html, text, ticketId }) {}
async function sendTicketCreatedEmail({ to, ticket }) {}
async function sendEscalationEmail({ to, ticket, escalation }) {}
async function sendResolutionEmail({ to, ticket }) {}
```

### 16.3 Cloudinary Storage Adapter

Create one adapter at `src/modules/integrations/cloudinary/cloudinary.service.js`.

Responsibilities:

- Upload ticket attachments.
- Generate signed upload params.
- Delete attachment when allowed by admin policy.
- Return normalized metadata for `TicketAttachment`.

Recommended folder structure in Cloudinary:

```txt
kgbv-helpdesk/
  tickets/
    {ticketNumber}/
  reports/
    {yyyy-mm}/
```

Never store files in Neon PostgreSQL. Store metadata only.

## 17. Express Middleware Stack

Recommended order:

1. request id middleware
2. helmet
3. cors
4. JSON body parser
5. rate limiter
6. auth middleware
7. RBAC middleware
8. route handlers
9. not found handler
10. error handler

## 18. Dashboard Backend APIs

### GET `/dashboard/summary`

Returns:

```json
{
  "open": 120,
  "inProgress": 45,
  "escalated": 18,
  "resolvedToday": 72,
  "slaCompliancePercent": 91.4,
  "csat": 86.2
}
```

### GET `/dashboard/school-heatmap`

Returns open/escalated counts grouped by school with lat/lng.

### GET `/dashboard/category-breakdown`

Returns ticket counts grouped by L1 category.

### GET `/dashboard/escalation-alerts`

Returns active escalated tickets ordered by age.

## 19. Testing Checklist

Backend unit tests:

- ticket number generation
- SLA calculation
- status transition validator
- RBAC permissions
- escalation level selection
- feedback validation

Integration tests:

- create ticket
- assign ticket
- start ticket
- resolve ticket
- reopen ticket
- auto-close ticket
- manual escalation
- SLA breach escalation
- report filters

Performance tests:

- 200 concurrent users
- ticket list pagination under filters
- dashboard summary under load
- bulk school import

## 20. Production Readiness Checklist

- Prisma migrations reviewed.
- Seed script available for roles, categories, SLA defaults.
- Neon pooling configured.
- Background worker deployed separately from API server.
- Redis or queue service configured.
- Audit logs enabled.
- Centralized application logs enabled.
- Error monitoring enabled.
- Daily DB backup configured.
- Cloudinary file attachment storage configured.
- MSG91 templates approved and configured.
- Resend domain verified and configured.
- Rate limits configured.
- Admin MFA enabled.
- Report exports run asynchronously.
- Health check endpoint available at `/health`.

## 21. Task-Wise Project Submodules

Divide the backend into submodules so each module can be assigned to one developer or one sprint task without blocking the whole team.

### 21.1 Auth Module

Path: `src/modules/auth`

Tasks:

- Login, refresh token, logout.
- Password hashing.
- JWT middleware.
- MFA-ready structure for admin and authority users.
- Zod validation for login and refresh.

Deliverables:

- `auth.routes.js`
- `auth.controller.js`
- `auth.service.js`
- `auth.validation.js`
- `auth.middleware.js`

### 21.2 User and RBAC Module

Path: `src/modules/users`

Tasks:

- User CRUD.
- Role assignment.
- Agent profile management.
- Availability flag for routing.
- RBAC middleware.

Deliverables:

- user APIs
- role seed data
- permission matrix middleware

### 21.3 School Master Module

Path: `src/modules/schools`

Tasks:

- School CRUD.
- CSV/Excel bulk import.
- District/block filtering.
- Active/inactive school handling.

Deliverables:

- paginated school list API
- school import validation
- school seed/import script

### 21.4 Category Module

Path: `src/modules/categories`

Tasks:

- L1/L2 category tree.
- Admin category management.
- Active/inactive category handling.

Deliverables:

- `/categories/tree`
- default KGBV taxonomy seed

### 21.5 Ticket Module

Path: `src/modules/tickets`

Tasks:

- Ticket creation.
- Ticket number generation.
- Ticket list and detail APIs.
- Status transition engine.
- Assignment and reassignment.
- Comments and attachments metadata.
- Zod validation for every ticket endpoint.

Deliverables:

- ticket CRUD APIs
- ticket lifecycle service
- ticket status history
- audit events

### 21.6 SLA Module

Path: `src/modules/sla`

Tasks:

- SLA policy CRUD.
- Due-date calculation.
- Apply SLA on ticket creation.
- Admin updates for future tickets.

Deliverables:

- SLA policy APIs
- default SLA seed data
- SLA calculation utility

### 21.7 Escalation Module

Path: `src/modules/escalation`

Tasks:

- Escalation matrix CRUD.
- Manual escalation API.
- Auto escalation service used by worker.
- Escalation logs.

Deliverables:

- escalation APIs
- escalation worker service
- escalation notification events

### 21.8 Notification Module

Path: `src/modules/notifications`

Tasks:

- Notification table writes.
- Queue notification jobs.
- Retry failed notifications.
- Normalize MSG91 and Resend delivery responses.

Deliverables:

- notification service
- notification retry worker
- provider-independent notification API

### 21.9 MSG91 Integration Submodule

Path: `src/modules/integrations/msg91`

Tasks:

- Configure MSG91 auth key and sender ID.
- Implement template-based SMS sending.
- Log provider message ID.
- Handle provider errors.

Deliverables:

- `msg91.service.js`
- SMS template mapping config
- provider response parser

### 21.10 Resend Integration Submodule

Path: `src/modules/integrations/resend`

Tasks:

- Configure Resend API key and from email.
- Build reusable email layouts.
- Send ticket and escalation emails.
- Log Resend message ID.

Deliverables:

- `resend.service.js`
- email templates
- provider response parser

### 21.11 Cloudinary Integration Submodule

Path: `src/modules/integrations/cloudinary`

Tasks:

- Configure Cloudinary SDK.
- Upload attachments.
- Generate signed upload params.
- Normalize uploaded file metadata.

Deliverables:

- `cloudinary.service.js`
- attachment upload API integration
- storage metadata mapping

### 21.12 Feedback Module

Path: `src/modules/feedback`

Tasks:

- Feedback capture.
- Rating validation.
- Reopen flow.
- CSAT calculation.
- 48-hour auto-close support.

Deliverables:

- feedback API
- reopen API
- CSAT query service

### 21.13 Reports Module

Path: `src/modules/reports`

Tasks:

- Ticket summary reports.
- SLA compliance reports.
- School-wise reports.
- Agent performance reports.
- CSV/PDF export jobs.
- Cloudinary report upload.

Deliverables:

- report APIs
- async export worker
- report download links

### 21.14 Dashboard Module

Path: `src/modules/dashboard`

Tasks:

- Summary cards.
- School heatmap data.
- Category breakdown.
- Escalation alerts.
- CSAT dashboard.

Deliverables:

- dashboard aggregation APIs
- cache strategy for heavy widgets

### 21.15 AI Routing Boundary Module

Path: `src/modules/integrations/routing`

Tasks:

- Create routing request records.
- Send ticket context to Python routing service.
- Receive recommended agent.
- Validate agent availability.
- Fallback assignment if service fails.

Deliverables:

- routing adapter
- routing worker
- assignment fallback logic

### 21.16 Audit Module

Path: `src/modules/audit`

Tasks:

- Central audit logging helper.
- Ticket action logs.
- User action logs.
- IP and user-agent capture.

Deliverables:

- audit service
- audit query API for admin

## 22. Recommended Implementation Order

1. Auth, users, roles, RBAC.
2. School master and category master.
3. Ticket CRUD and lifecycle state machine.
4. SLA policy and due-date calculation.
5. Assignment boundary for AI routing.
6. Escalation matrix and escalation worker.
7. MSG91, Resend, and notification worker.
8. Cloudinary attachments.
9. Feedback and auto-close.
10. Dashboard APIs.
11. Reports and exports.
12. Security hardening and load testing.
