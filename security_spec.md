# Security Specification — NexusWA Cloud (WhatsApp Business API SaaS)

## 1. Data Invariants
1. **Tenant Isolation Invariant**: Every document in `/waba_accounts`, `/contacts`, `/messages`, `/templates`, and `/webhook_events` must have a `userId` field that strictly equals `request.auth.uid`, and `request.auth.token.email_verified == true`.
2. **PII Split Isolation Invariant**: User email and private notification settings live exclusively in `/users/{userId}/private/{docId}` and can only be read or written by the exact owner (`request.auth.uid == userId`).
3. **Relational Integrity Invariant**:
   - A `Contact`, `Message`, or `Template` cannot be created unless its referenced `/waba_accounts/$(incoming().wabaAccountId)` exists and belongs to `request.auth.uid`.
   - A `Message` cannot be created unless its referenced `/contacts/$(incoming().contactId)` exists and belongs to `request.auth.uid`.
4. **Temporal & Immutable Fields Invariant**:
   - On `create`, `createdAt == request.time` and `updatedAt == request.time`.
   - On `update`, `updatedAt == request.time` and immutable fields (`userId`, `uid`, `createdAt`, `wabaAccountId`, `contactId`) cannot be changed.
5. **Strict Key & Volumetric Guard Invariant**: Every entity validation helper enforces `.keys().hasAll(...)` and `.keys().hasOnly(...)`, regex patterns on IDs and phone numbers, and `.size()` bounds on every string and array.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Cross-Tenant WABA Hijack**: Authenticated user `user_A` creates `/waba_accounts/acc_1` with `userId: "user_B"`. -> `PERMISSION_DENIED`
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create a `WabaAccount`. -> `PERMISSION_DENIED`
3. **PII Lateral Scrape**: Authenticated user `user_A` attempts `get` on `/users/user_B/private/info`. -> `PERMISSION_DENIED`
4. **Shadow Field Injection on Contact**: User creates `/contacts/c_1` with an undeclared field `"isAdmin": true`. -> `PERMISSION_DENIED`
5. **Orphaned Contact Creation**: User creates `/contacts/c_1` referencing a non-existent `wabaAccountId: "non_existent_waba"`. -> `PERMISSION_DENIED`
6. **Cross-Tenant Message Creation**: User creates `/messages/m_1` referencing a `wabaAccountId` owned by another user. -> `PERMISSION_DENIED`
7. **ID Poisoning Attack**: User attempts to create `/contacts/invalid$id!@#` violating `^[a-zA-Z0-9_\-]+$`. -> `PERMISSION_DENIED`
8. **Tag Array Exhaustion**: User creates `/contacts/c_1` with 25 tags (exceeding max 10 tags) or non-string first element. -> `PERMISSION_DENIED`
9. **Timestamp Spoofing on Create**: User creates `/messages/m_1` with a backdated `createdAt` instead of `request.time`. -> `PERMISSION_DENIED`
10. **Immutable Owner Mutation on Update**: User updates `/contacts/c_1` attempting to change `userId` or `createdAt`. -> `PERMISSION_DENIED`
11. **Unbounded String Denial-of-Wallet**: User updates `notes` on `/contacts/c_1` with a 10,000-character string (limit 1000). -> `PERMISSION_DENIED`
12. **Unauthorized List Scraping**: User executes an unfiltered `list` query on `/messages` without `where('userId', '==', request.auth.uid)`. -> `PERMISSION_DENIED`

## 3. Conflict & Red Team Audit Report
- **Identity Spoofing**: Blocked on all collections via `data.userId == request.auth.uid` and immutable `incoming().userId == existing().userId`.
- **State Shortcutting**: `Message` and `WabaAccount` status transitions require valid enum values and `isValid[Entity](incoming())` wrapping the entire `allow update` expression.
- **Resource Poisoning**: Blocked by `isValidId()` on all document path parameters and strict `.size()` caps on every string and list.
- **Value Poisoning**: Every `allow update` begins with `isValid[Entity](incoming())` before action-specific `affectedKeys().hasOnly(...)` checks.
