/**
 * Firestore Security Rules Specification & Red-Team Verification Suite
 * Validates that all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TEST_CASES: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Cross-Tenant WABA Hijack',
    collectionPath: '/waba_accounts/acc_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_B', wabaId: '100200300', phoneNumberId: '900800700' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    collectionPath: '/waba_accounts/acc_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: false },
    payload: { userId: 'user_A', wabaId: '100200300', phoneNumberId: '900800700' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'PII Lateral Scrape',
    collectionPath: '/users/user_B/private/info',
    operation: 'get',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Contact',
    collectionPath: '/contacts/c_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_A', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Orphaned Contact Creation',
    collectionPath: '/contacts/c_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_A', wabaAccountId: 'non_existent_waba' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Cross-Tenant Message Creation',
    collectionPath: '/messages/m_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_A', wabaAccountId: 'other_users_waba', contactId: 'c_1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'ID Poisoning Attack',
    collectionPath: '/contacts/invalid$id!@#',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_A' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Tag Array Exhaustion',
    collectionPath: '/contacts/c_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_A', tags: new Array(25).fill('tag') },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Timestamp Spoofing on Create',
    collectionPath: '/messages/m_1',
    operation: 'create',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_A', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Owner Mutation on Update',
    collectionPath: '/contacts/c_1',
    operation: 'update',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { userId: 'user_B' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unbounded String Denial-of-Wallet',
    collectionPath: '/contacts/c_1',
    operation: 'update',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    payload: { notes: 'x'.repeat(10000) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthorized List Scraping',
    collectionPath: '/messages',
    operation: 'list',
    auth: { uid: 'user_A', email: 'a@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
];
