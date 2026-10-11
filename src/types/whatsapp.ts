/**
 * Shared TypeScript types and validation constraints synchronized with firebase-blueprint.json
 */

export type WorkspaceRole = 'owner' | 'admin' | 'operator';

export interface UserProfile {
  uid: string;
  displayName: string;
  organizationName: string;
  role: WorkspaceRole;
  timezone: string;
  createdAt: any;
  updatedAt: any;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  notificationEmail: string;
  updatedAt: any;
}

export type WabaQualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type WabaConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'TOKEN_EXPIRED' | 'PENDING_VERIFICATION';
export type WabaOnboardingMethod = 'EMBEDDED_SIGNUP' | 'SYSTEM_USER_TOKEN';

export interface WabaAccount {
  id: string;
  userId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: WabaQualityRating;
  messagingLimitTier: string;
  status: WabaConnectionStatus;
  onboardingMethod: WabaOnboardingMethod;
  webhookSubscribed: boolean;
  lastHealthCheckAt: any;
  createdAt: any;
  updatedAt: any;
}

export type OptInStatus = 'OPTED_IN' | 'OPTED_OUT' | 'PENDING';
export type ConversationStatus = 'OPEN' | 'PENDING' | 'RESOLVED';

export interface Contact {
  id: string;
  userId: string;
  wabaAccountId: string;
  waId: string; // E.164 phone number
  profileName: string;
  email: string;
  company: string;
  tags: string[];
  optInStatus: OptInStatus;
  optInSource: string;
  notes: string;
  lastInboundAt: string;
  lastMessagePreview: string;
  conversationStatus: ConversationStatus;
  unreadCount: number;
  createdAt: any;
  updatedAt: any;
}

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageType = 'text' | 'template' | 'image' | 'document' | 'audio' | 'video';
export type MessageDeliveryStatus = 'QUEUED' | 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Message {
  id: string;
  userId: string;
  wabaAccountId: string;
  contactId: string;
  recipientPhone: string;
  direction: MessageDirection;
  messageType: MessageType;
  body: string;
  templateName: string;
  templateLanguage: string;
  mediaUrl: string;
  mediaCaption: string;
  metaMessageId: string;
  status: MessageDeliveryStatus;
  errorCode: string;
  errorMessage: string;
  rawApiResponse: string;
  retryCount: number;
  createdAt: any;
  updatedAt: any;
}

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type TemplateApprovalStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED';

export interface WhatsAppTemplate {
  id: string;
  userId: string;
  wabaAccountId: string;
  metaTemplateId: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateApprovalStatus;
  headerText: string;
  bodyText: string;
  footerText: string;
  createdAt: any;
  updatedAt: any;
}

export interface WebhookEventLog {
  id: string;
  userId: string;
  wabaId: string;
  phoneNumberId: string;
  eventType: 'messages' | 'statuses' | 'template_status_update' | 'account_update';
  signatureVerified: boolean;
  summary: string;
  payloadSnippet: string;
  createdAt: any;
}

// Verbatim Validation Constants from firebase-blueprint.json
export const VALIDATION_RULES = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  WABA_ID_PATTERN: /^[0-9a-zA-Z_\-]+$/,
  E164_PHONE_PATTERN: /^\+?[0-9]{7,20}$/,
  TEMPLATE_NAME_PATTERN: /^[a-z0-9_]+$/,
  MAX_DISPLAY_NAME: 120,
  MAX_ORG_NAME: 160,
  MAX_NOTES: 1000,
  MAX_MESSAGE_BODY: 4096,
  MAX_TAGS: 10,
  MAX_TAG_LENGTH: 40,
};

/**
 * Checks if a contact's last inbound message was within the 24-hour Meta Customer Service Window.
 */
export function isWithin24HourServiceWindow(lastInboundAt: string): {
  isOpen: boolean;
  remainingMinutes: number;
} {
  if (!lastInboundAt) {
    return { isOpen: false, remainingMinutes: 0 };
  }
  const inboundTime = new Date(lastInboundAt).getTime();
  if (Number.isNaN(inboundTime)) {
    return { isOpen: false, remainingMinutes: 0 };
  }
  const now = Date.now();
  const elapsedMs = now - inboundTime;
  const windowMs = 24 * 60 * 60 * 1000;
  if (elapsedMs < windowMs && elapsedMs >= 0) {
    return {
      isOpen: true,
      remainingMinutes: Math.max(0, Math.floor((windowMs - elapsedMs) / 60000)),
    };
  }
  return { isOpen: false, remainingMinutes: 0 };
}
