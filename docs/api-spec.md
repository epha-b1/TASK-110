openapi: "3.0.3"
info:
  title: Hospitality Operations Intelligence API
  version: "1.0.0"
  description: |
    Hospitality Operations Intelligence & Group Itinerary Platform.
    All endpoints require Bearer JWT unless marked public.
    Base URL: http://localhost:3000
servers:
  - url: http://localhost:3000
    description: Local

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    Error:
      type: object
      properties:
        statusCode:
          type: integer
        code:
          type: string
        message:
          type: string
        traceId:
          type: string

security:
  - bearerAuth: []

paths:
  /health:
    get:
      tags: [Health]
      summary: Health check
      security: []
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: ok

  /auth/register:
    post:
      tags: [Auth]
      summary: Register new user
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [username, password]
              properties:
                username:
                  type: string
                password:
                  type: string
                  minLength: 10
                  description: Min 10 chars, at least 1 number and 1 symbol
      responses:
        "201":
          description: User registered
        "409":
          description: Username already taken

  /auth/login:
    post:
      tags: [Auth]
      summary: Login
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [username, password]
              properties:
                username:
                  type: string
                password:
                  type: string
      responses:
        "200":
          description: Login successful
          content:
            application/json:
              schema:
                type: object
                properties:
                  accessToken:
                    type: string
                  user:
                    type: object
                    properties:
                      id:
                        type: string
                        format: uuid
                      username:
                        type: string
                      role:
                        type: string
        "401":
          description: Invalid credentials
        "423":
          description: Account locked

  /auth/logout:
    post:
      tags: [Auth]
      summary: Logout
      responses:
        "204":
          description: Logged out

  /auth/change-password:
    patch:
      tags: [Auth]
      summary: Change own password
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [currentPassword, newPassword]
              properties:
                currentPassword:
                  type: string
                newPassword:
                  type: string
                  minLength: 10
      responses:
        "200":
          description: Password changed

  /accounts/me:
    get:
      tags: [Accounts]
      summary: Get own profile
      responses:
        "200":
          description: User profile
    patch:
      tags: [Accounts]
      summary: Update own profile
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                legalName:
                  type: string
                addressLine1:
                  type: string
                addressLine2:
                  type: string
                city:
                  type: string
                state:
                  type: string
                  maxLength: 2
                zip:
                  type: string
                taxInvoiceTitle:
                  type: string
                preferredCurrency:
                  type: string
                  maxLength: 3
      responses:
        "200":
          description: Profile updated

  /accounts/me/delete:
    post:
      tags: [Accounts]
      summary: Self-service account deletion
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [password]
              properties:
                password:
                  type: string
      responses:
        "200":
          description: Account scheduled for deletion

  /accounts/me/export:
    post:
      tags: [Accounts]
      summary: Request data export (profile, activity logs, files)
      responses:
        "200":
          description: Export archive download URL
          content:
            application/json:
              schema:
                type: object
                properties:
                  downloadUrl:
                    type: string
                  expiresAt:
                    type: string
                    format: date-time

  /groups:
    get:
      tags: [Groups]
      summary: List groups for current user
      responses:
        "200":
          description: Groups
    post:
      tags: [Groups]
      summary: Create group
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:
                  type: string
      responses:
        "201":
          description: Group created with join code

  /groups/join:
    post:
      tags: [Groups]
      summary: Join group by join code
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [joinCode]
              properties:
                joinCode:
                  type: string
      responses:
        "200":
          description: Joined group
        "404":
          description: Invalid join code
        "409":
          description: Already a member

  /groups/{id}:
    get:
      tags: [Groups]
      summary: Get group details
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Group
    patch:
      tags: [Groups]
      summary: Update group (owner/admin only)
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                status:
                  type: string
                  enum: [active, archived]
      responses:
        "200":
          description: Updated

  /groups/{id}/members:
    get:
      tags: [Groups]
      summary: List group members
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Members

  /groups/{id}/members/{userId}:
    delete:
      tags: [Groups]
      summary: Remove member (owner/admin only)
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: userId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "204":
          description: Member removed

  /groups/{id}/required-fields:
    get:
      tags: [Groups]
      summary: List required member data fields for group
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Required fields
    post:
      tags: [Groups]
      summary: Add required field config (owner/admin only)
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [fieldName, fieldType]
              properties:
                fieldName:
                  type: string
                  example: vehicle_make
                fieldType:
                  type: string
                  enum: [text, phone, select]
                isRequired:
                  type: boolean
                  default: true
      responses:
        "201":
          description: Field config added

  /groups/{id}/required-fields/{fieldId}:
    patch:
      tags: [Groups]
      summary: Update required field config
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: fieldId
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                isRequired:
                  type: boolean
      responses:
        "200":
          description: Updated
    delete:
      tags: [Groups]
      summary: Remove required field config
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: fieldId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "204":
          description: Removed

  /groups/{id}/my-fields:
    get:
      tags: [Groups]
      summary: Get own field values for group
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Field values
    put:
      tags: [Groups]
      summary: Submit own field values for group
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              description: Key-value map of fieldName to value
              additionalProperties:
                type: string
      responses:
        "200":
          description: Field values saved
        "400":
          description: Phone format validation failed

  /groups/{groupId}/itineraries:
    get:
      tags: [Itineraries]
      summary: List itinerary items for group
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Itinerary items
    post:
      tags: [Itineraries]
      summary: Create itinerary item
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title, meetupDate, meetupTime, meetupLocation, idempotencyKey]
              properties:
                title:
                  type: string
                meetupDate:
                  type: string
                  pattern: "^\\d{2}/\\d{2}/\\d{4}$"
                  example: "12/25/2025"
                meetupTime:
                  type: string
                  pattern: "^\\d{1,2}:\\d{2} (AM|PM)$"
                  example: "09:30 AM"
                meetupLocation:
                  type: string
                notes:
                  type: string
                  maxLength: 2000
                idempotencyKey:
                  type: string
      responses:
        "201":
          description: Item created
        "409":
          description: Duplicate idempotency key

  /groups/{groupId}/itineraries/{itemId}:
    get:
      tags: [Itineraries]
      summary: Get itinerary item
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: itemId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Itinerary item
    patch:
      tags: [Itineraries]
      summary: Update itinerary item
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: itemId
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [idempotencyKey]
              properties:
                title:
                  type: string
                meetupDate:
                  type: string
                meetupTime:
                  type: string
                meetupLocation:
                  type: string
                notes:
                  type: string
                  maxLength: 2000
                idempotencyKey:
                  type: string
      responses:
        "200":
          description: Updated
    delete:
      tags: [Itineraries]
      summary: Delete itinerary item (owner/admin only)
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: itemId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "204":
          description: Deleted

  /groups/{groupId}/itineraries/{itemId}/checkpoints:
    get:
      tags: [Itineraries]
      summary: List checkpoints for itinerary item
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: itemId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Checkpoints (ordered)
    post:
      tags: [Itineraries]
      summary: Add checkpoint (max 30)
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: itemId
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [label, position]
              properties:
                label:
                  type: string
                description:
                  type: string
                position:
                  type: integer
                  minimum: 1
                  maximum: 30
      responses:
        "201":
          description: Checkpoint added
        "400":
          description: Max 30 checkpoints reached

  /groups/{groupId}/itineraries/{itemId}/checkpoints/{checkpointId}:
    patch:
      tags: [Itineraries]
      summary: Update checkpoint (position, label, description)
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: itemId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: checkpointId
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                label:
                  type: string
                description:
                  type: string
                position:
                  type: integer
                  minimum: 1
                  maximum: 30
      responses:
        "200":
          description: Checkpoint updated
        "409":
          description: Position conflict
    delete:
      tags: [Itineraries]
      summary: Delete checkpoint
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: itemId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: checkpointId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "204":
          description: Checkpoint deleted

  /groups/{groupId}/itineraries/{itemId}/checkin:
    post:
      tags: [Itineraries]
      summary: Check in to itinerary item
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: itemId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Checked in
        "400":
          description: Missing required member fields
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                    example: MISSING_REQUIRED_FIELDS
                  missingFields:
                    type: array
                    items:
                      type: string

  /groups/{groupId}/files:
    get:
      tags: [Files]
      summary: List files for group (members only)
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Files
    post:
      tags: [Files]
      summary: Upload file to group (max 10 MB)
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
      responses:
        "201":
          description: File uploaded (or existing file returned if SHA-256 matches)
        "400":
          description: File too large or MIME type not allowed
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                    enum: [FILE_TOO_LARGE, MIME_NOT_ALLOWED]

  /groups/{groupId}/files/{fileId}:
    get:
      tags: [Files]
      summary: Download file (members only)
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: fileId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: File content
    delete:
      tags: [Files]
      summary: Delete file (owner/admin only)
      parameters:
        - in: path
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: path
          name: fileId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "204":
          description: Deleted
        "403":
          description: Not owner or admin

  /notifications:
    get:
      tags: [Notifications]
      summary: Query notifications by cursor
      parameters:
        - in: query
          name: groupId
          required: true
          schema:
            type: string
            format: uuid
        - in: query
          name: after
          schema:
            type: string
            description: Cursor — last notification ID seen
        - in: query
          name: limit
          schema:
            type: integer
            default: 50
            maximum: 100
      responses:
        "200":
          description: Notifications with next cursor
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                          format: uuid
                        eventType:
                          type: string
                        actorId:
                          type: string
                          format: uuid
                        resourceType:
                          type: string
                        resourceId:
                          type: string
                        detail:
                          type: object
                        createdAt:
                          type: string
                          format: date-time
                  nextCursor:
                    type: string

  /notifications/{id}/read:
    patch:
      tags: [Notifications]
      summary: Mark notification as read
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Marked read

  /reports/occupancy:
    get:
      tags: [Reports]
      summary: Occupancy rate report
      parameters:
        - in: query
          name: propertyId
          schema:
            type: string
            format: uuid
        - in: query
          name: from
          required: true
          schema:
            type: string
            format: date
        - in: query
          name: to
          required: true
          schema:
            type: string
            format: date
        - in: query
          name: groupBy
          schema:
            type: string
            enum: [day, week, month]
            default: day
        - in: query
          name: roomType
          schema:
            type: string
      responses:
        "200":
          description: Occupancy rate time series
        "403":
          description: Property access denied

  /reports/adr:
    get:
      tags: [Reports]
      summary: Average Daily Rate report
      parameters:
        - in: query
          name: propertyId
          schema:
            type: string
            format: uuid
        - in: query
          name: from
          required: true
          schema:
            type: string
            format: date
        - in: query
          name: to
          required: true
          schema:
            type: string
            format: date
        - in: query
          name: groupBy
          schema:
            type: string
            enum: [day, week, month]
            default: day
      responses:
        "200":
          description: ADR time series

  /reports/revpar:
    get:
      tags: [Reports]
      summary: RevPAR report
      parameters:
        - in: query
          name: propertyId
          schema:
            type: string
            format: uuid
        - in: query
          name: from
          required: true
          schema:
            type: string
            format: date
        - in: query
          name: to
          required: true
          schema:
            type: string
            format: date
        - in: query
          name: groupBy
          schema:
            type: string
            enum: [day, week, month]
            default: day
      responses:
        "200":
          description: RevPAR time series

  /reports/revenue-mix:
    get:
      tags: [Reports]
      summary: Revenue mix by channel
      parameters:
        - in: query
          name: propertyId
          schema:
            type: string
            format: uuid
        - in: query
          name: from
          required: true
          schema:
            type: string
            format: date
        - in: query
          name: to
          required: true
          schema:
            type: string
            format: date
        - in: query
          name: groupBy
          schema:
            type: string
            enum: [day, week, month, channel, room_type]
            default: channel
      responses:
        "200":
          description: Revenue mix breakdown

  /reports/export:
    post:
      tags: [Reports]
      summary: Export report as CSV or Excel
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [reportType, from, to, format]
              properties:
                reportType:
                  type: string
                  enum: [occupancy, adr, revpar, revenue_mix]
                propertyId:
                  type: string
                  format: uuid
                from:
                  type: string
                  format: date
                to:
                  type: string
                  format: date
                groupBy:
                  type: string
                  enum: [day, week, month]
                format:
                  type: string
                  enum: [csv, excel]
                roomType:
                  type: string
                  minLength: 1
                  maxLength: 100
                  description: |
                    Optional room-type filter mirroring the GET
                    `/reports/{occupancy,adr,revpar}?roomType=...` query
                    parameter. When present, the exported rows are
                    restricted to rooms whose `room_type` matches exactly.
                    Applies to `occupancy`, `adr`, and `revpar` only;
                    ignored for `revenue_mix` because that report already
                    partitions by `room_type` when `groupBy=room_type`.
                includePii:
                  type: boolean
                  default: false
      responses:
        "200":
          description: Export file download URL
        "400":
          description: Validation error (e.g. empty or oversized roomType)
        "403":
          description: PII export not permitted

  /import/templates/{datasetType}:
    get:
      tags: [Import]
      summary: Download Excel template for dataset type
      description: Requires authentication and either hotel_admin or manager role.
      parameters:
        - in: path
          name: datasetType
          required: true
          schema:
            type: string
            enum: [staffing, evaluation]
      responses:
        "200":
          description: Excel template file
        "401":
          description: Unauthenticated
        "403":
          description: Forbidden — requires hotel_admin or manager role

  /import/upload:
    post:
      tags: [Import]
      summary: Upload and validate Excel import file
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file, datasetType]
              properties:
                file:
                  type: string
                  format: binary
                datasetType:
                  type: string
                  enum: [staffing, evaluation]
      responses:
        "200":
          description: Validation result with error receipt
          content:
            application/json:
              schema:
                type: object
                properties:
                  batchId:
                    type: string
                    format: uuid
                  totalRows:
                    type: integer
                  validRows:
                    type: integer
                  errorRows:
                    type: integer
                  errors:
                    type: array
                    items:
                      type: object
                      properties:
                        rowNumber:
                          type: integer
                        field:
                          type: string
                        reason:
                          type: string

  /import/{batchId}/commit:
    post:
      tags: [Import]
      summary: Commit validated import batch
      parameters:
        - in: path
          name: batchId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Import committed
        "409":
          description: Already committed or failed

  /import/{batchId}:
    get:
      tags: [Import]
      summary: Get import batch status and error receipt
      parameters:
        - in: path
          name: batchId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Batch status

  /reports/staffing:
    get:
      tags: [Reports]
      summary: Staffing report — position distribution and gaps
      parameters:
        - in: query
          name: propertyId
          schema:
            type: string
            format: uuid
        - in: query
          name: from
          schema:
            type: string
            format: date
        - in: query
          name: to
          schema:
            type: string
            format: date
      responses:
        "200":
          description: Staffing report

  /reports/evaluations:
    get:
      tags: [Reports]
      summary: Evaluation report — results, rewards, penalties
      parameters:
        - in: query
          name: propertyId
          schema:
            type: string
            format: uuid
        - in: query
          name: from
          schema:
            type: string
            format: date
        - in: query
          name: to
          schema:
            type: string
            format: date
      responses:
        "200":
          description: Evaluation report

  /face/enroll/start:
    post:
      tags: [Face]
      summary: Start face enrollment session
      responses:
        "201":
          description: Enrollment session created
          content:
            application/json:
              schema:
                type: object
                properties:
                  sessionId:
                    type: string
                    format: uuid
                  requiredAngles:
                    type: array
                    items:
                      type: string
                    example: [left, front, right]

  /face/enroll/{sessionId}/capture:
    post:
      tags: [Face]
      summary: Submit capture metadata for one angle
      parameters:
        - in: path
          name: sessionId
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [angle, blinkTimingMs, motionScore, textureScore]
              properties:
                angle:
                  type: string
                  enum: [left, front, right]
                blinkTimingMs:
                  type: integer
                  description: Blink duration in milliseconds
                motionScore:
                  type: number
                  description: Motion consistency score 0-1
                textureScore:
                  type: number
                  description: Texture/reflection heuristic score 0-1
                image:
                  type: string
                  format: binary
                  description: Optional raw image (deleted after 24h)
      responses:
        "200":
          description: Capture accepted
          content:
            application/json:
              schema:
                type: object
                properties:
                  livenessResult:
                    type: object
                    properties:
                      passed:
                        type: boolean
                      scores:
                        type: object
        "400":
          description: Liveness check failed

  /face/enroll/{sessionId}/complete:
    post:
      tags: [Face]
      summary: Complete enrollment — generate encrypted template
      parameters:
        - in: path
          name: sessionId
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "201":
          description: Enrollment complete
          content:
            application/json:
              schema:
                type: object
                properties:
                  enrollmentId:
                    type: string
                    format: uuid
                  version:
                    type: integer
        "400":
          description: Not all angles captured or liveness failed

  /face/enrollments:
    get:
      tags: [Face]
      summary: List own face enrollments (versions and status)
      responses:
        "200":
          description: Enrollments

  /face/enrollments/{id}:
    patch:
      tags: [Face]
      summary: Deactivate face enrollment
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [status]
              properties:
                status:
                  type: string
                  enum: [deactivated]
      responses:
        "200":
          description: Enrollment deactivated

  /quality/checks:
    get:
      tags: [Quality]
      summary: List data quality check configs
      responses:
        "200":
          description: Quality check configs
    post:
      tags: [Quality]
      summary: Create quality check config (Admin only)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [entityType, checkType, config]
              properties:
                entityType:
                  type: string
                  enum: [reservations, staffing, evaluations, users, files]
                checkType:
                  type: string
                  enum: [null_coverage, duplication_ratio, outlier]
                config:
                  type: object
                  description: |
                    null_coverage: {threshold: 0.05}
                    duplication_ratio: {threshold: 0.02}
                    outlier: {zScoreBound: 3.0, fields: ["rate_cents"]}
      responses:
        "201":
          description: Check config created

  /quality/checks/{id}/run:
    post:
      tags: [Quality]
      summary: Run quality check on demand
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Check result
          content:
            application/json:
              schema:
                type: object
                properties:
                  passed:
                    type: boolean
                  result:
                    type: object
                  traceId:
                    type: string

  /quality/results:
    get:
      tags: [Quality]
      summary: Get latest quality check results
      responses:
        "200":
          description: Quality results

  /audit-logs:
    get:
      tags: [Audit]
      summary: Query audit log (Hotel Admin only)
      parameters:
        - in: query
          name: actorId
          schema:
            type: string
            format: uuid
        - in: query
          name: action
          schema:
            type: string
        - in: query
          name: resourceType
          schema:
            type: string
        - in: query
          name: from
          schema:
            type: string
            format: date-time
        - in: query
          name: to
          schema:
            type: string
            format: date-time
        - in: query
          name: page
          schema:
            type: integer
            default: 1
      responses:
        "200":
          description: Audit log entries

  /audit-logs/export:
    get:
      tags: [Audit]
      summary: Export audit log as CSV (sensitive fields masked)
      parameters:
        - in: query
          name: from
          schema:
            type: string
            format: date-time
        - in: query
          name: to
          schema:
            type: string
            format: date-time
      responses:
        "200":
          description: CSV export
          content:
            text/csv:
              schema:
                type: string

  /exports/{filename}:
    get:
      tags: [Exports]
      summary: Download a previously generated export archive
      description: |
        Strict ownership gate. The caller must be authenticated and must
        either be the user who created the export or a hotel_admin. The
        `:filename` path parameter is the exact filename returned in the
        `downloadUrl` field of `/reports/export` and `/accounts/me/export`
        responses (e.g. `report-adr-<uuid>.csv`, `export-<userId>-<uuid>.zip`).
      parameters:
        - in: path
          name: filename
          required: true
          schema:
            type: string
      responses:
        "200":
          description: File download
        "403":
          description: Caller does not own the export
        "404":
          description: Export not found or expired

  /users:
    get:
      tags: [Users]
      summary: List all users (Hotel Admin only)
      parameters:
        - in: query
          name: page
          schema:
            type: integer
            default: 1
        - in: query
          name: limit
          schema:
            type: integer
            default: 20
            maximum: 100
      responses:
        "200":
          description: Paginated user list
        "403":
          description: Requires hotel_admin

  /users/{id}:
    get:
      tags: [Users]
      summary: Get user by id (Hotel Admin only)
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: User
        "404":
          description: Not found
    patch:
      tags: [Users]
      summary: Update user fields — role / status / property / PII flag (Hotel Admin only)
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                role:
                  type: string
                  enum: [hotel_admin, manager, analyst, member]
                status:
                  type: string
                  enum: [active, suspended, deleted]
                propertyId:
                  type: string
                  format: uuid
                piiExportAllowed:
                  type: boolean
      responses:
        "200":
          description: Updated
        "404":
          description: Not found
    delete:
      tags: [Users]
      summary: Soft-delete user (Hotel Admin only)
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "204":
          description: Deleted
        "409":
          description: Cannot delete own account via admin route

tags:
  - name: Health
  - name: Auth
  - name: Accounts
  - name: Users
  - name: Groups
  - name: Itineraries
  - name: Files
  - name: Notifications
  - name: Reports
  - name: Import
  - name: Face
  - name: Quality
  - name: Audit
  - name: Exports
