# Clinic Appointment Booking API & Web Interface

A production-grade REST API and web application implementing the 5-level technical specification from [koyaacademy.com/assessment-api](https://koyaacademy.com/assessment-api).

---

## 🛠 Features by Level

- **Level 1 — Core Booking**:
  - `POST /reset` — Clears bookings and replaces all slots with custom test data.
  - `GET /slots` — Lists all appointment slots earliest `start` first, with `available` boolean flag; supports `?provider=` exact-match filtering.
  - `POST /bookings` — Creates a confirmed appointment for an available slot (`201 Created`).
  - `GET /bookings/:id` — Looks up a specific booking by its ID (`200 OK` or `404 Not Found`).

- **Level 2 — Authentication & Input Validation**:
  - `X-API-Key` header authentication enforced on all API routes (`401 Unauthorized` for missing or invalid key).
  - Validation: `slot_id`, `name`, and `email` must be present and non-empty (`400 Bad Request`).
  - Strict email format validation.
  - Slot non-existence check (`404 Not Found`).
  - Past slot check: prevents booking slots that have already started (`400 Bad Request`).
  - Sanitization: trims `name` and `email` whitespace, normalizes `email` to lowercase.

- **Level 3 — Concurrency & Cancellation**:
  - Double booking prevention: prevents booking already reserved slots (`409 Conflict`).
  - Race condition safety: atomic checks and writes ensure simultaneous requests can never double-book the same slot.
  - `DELETE /bookings/:id` (and `PATCH /bookings/:id/cancel`) — Cancels an appointment, releases the slot back to available, returns the updated booking (`200 OK`).
  - Re-cancelling returns `409 Conflict`.

- **Level 4 — Idempotency & Cursor Pagination**:
  - `Idempotency-Key` header: retrying a request with the same key and same body returns the identical response (`201`) without creating a duplicate booking.
  - Reusing an `Idempotency-Key` with a different request payload returns `422 Unprocessable Entity`.
  - `GET /bookings?email=...` — Cursor-based pagination (`limit` 1–50, `cursor`, `next_cursor`), case-insensitive email filtering, ordered oldest first (`created_at ASC`).

- **Level 5 — Rate Limiting**:
  - Maximum 5 booking attempts per email per minute (failed validation/404 attempts included).
  - 6th attempt is blocked with `429 Too Many Requests` and a `Retry-After: <seconds>` header.
  - Rate limiting is scoped per email; other users are completely unaffected.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The server will run on **http://localhost:3000**.

### 3. Web Interface
Visit **http://localhost:3000** in your browser to:
- Browse and filter available appointment slots by doctor.
- Book a slot by providing patient details.
- View immediate booking confirmation.
- Look up previous bookings by email and cancel appointments.

---

## 🧪 Running the Comprehensive Test Suite

Run the full automated test suite verifying all 5 levels:
```bash
node test_all_levels.js
```

---

## 🔑 Authentication
Include the `X-API-Key` header in all API calls:
```http
X-API-Key: clinic-api-key-2026
```
*(Can be customized via the `API_KEY` environment variable)*
