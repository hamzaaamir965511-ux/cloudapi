import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  PhoneCall,
  Users,
  FileCode2,
  Settings,
  LogOut,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthScreen } from './components/AuthScreen';
import { WabaConnectionModule } from './components/WabaConnectionModule';
import { InboxModule } from './components/InboxModule';
import { ContactManagementModule } from './components/ContactManagementModule';
import { TemplatesAndWebhooksModule } from './components/TemplatesAndWebhooksModule';
import { AccountSettingsModule } from './components/AccountSettingsModule';
import {
  WabaAccount,
  Contact,
  Message,
  WhatsAppTemplate,
  WebhookEventLog,
} from './types/whatsapp';

type NavTab = 'inbox' | 'accounts' | 'contacts' | 'templates' | 'settings';

const DashboardWorkspace: React.FC = () => {
  const {
    user,
    profile,
    loading,
    signOut,
    resendVerificationEmail,
    refreshUserToken,
    getBearerToken,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<NavTab>('accounts');
  const [accounts, setAccounts] = useState<WabaAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventLog[]>([]);
  const [verifyBanner, setVerifyBanner] = useState<string | null>(null);

  // Attach tenant-isolated Firestore listeners once user is authenticated and emailVerified
  useEffect(() => {
    if (!user || !user.emailVerified) return;

    const uid = user.uid;

    const unsubAccounts = onSnapshot(
      query(collection(db, 'waba_accounts'), where('userId', '==', uid)),
      (snap) => {
        const list: WabaAccount[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WabaAccount, 'id'>),
        }));
        setAccounts(list);
        if (list.length > 0 && !selectedAccountId) {
          setSelectedAccountId(list[0].id);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'waba_accounts')
    );

    const unsubContacts = onSnapshot(
      query(collection(db, 'contacts'), where('userId', '==', uid)),
      (snap) => {
        const list: Contact[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Contact, 'id'>),
        }));
        setContacts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'contacts')
    );

    const unsubMessages = onSnapshot(
      query(collection(db, 'messages'), where('userId', '==', uid)),
      (snap) => {
        const list: Message[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Message, 'id'>),
        }));
        setMessages(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'messages')
    );

    const unsubTemplates = onSnapshot(
      query(collection(db, 'templates'), where('userId', '==', uid)),
      (snap) => {
        const list: WhatsAppTemplate[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WhatsAppTemplate, 'id'>),
        }));
        setTemplates(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'templates')
    );

    const unsubWebhooks = onSnapshot(
      query(collection(db, 'webhook_events'), where('userId', '==', uid)),
      (snap) => {
        const list: WebhookEventLog[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WebhookEventLog, 'id'>),
        }));
        setWebhookEvents(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'webhook_events')
    );

    return () => {
      unsubAccounts();
      unsubContacts();
      unsubMessages();
      unsubTemplates();
      unsubWebhooks();
    };
  }, [user]);

  // Connect authenticated WebSocket to receive real-time verified Meta Webhook events
  useEffect(() => {
    if (!user || !user.emailVerified) return;

    let ws: WebSocket | null = null;
    let isMounted = true;

    const connectSocket = async () => {
      try {
        const token = await getBearerToken();
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onopen = () => {
          ws?.send(JSON.stringify({ type: 'auth', token }));
        };

        ws.onmessage = async (event) => {
          if (!isMounted) return;
          try {
            const packet = JSON.parse(event.data);
            if (packet.type !== 'whatsapp:webhook') return;

            const targetAcc =
              accounts.find(
                (a) =>
                  a.phoneNumberId === packet.phoneNumberId || a.wabaId === packet.wabaId
              ) || accounts[0];

            if (!targetAcc) return;

            const value = packet.value || {};
            const eventId = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

            // 1. Process Inbound Messages from Meta Webhook
            if (Array.isArray(value.messages) && value.messages.length > 0) {
              for (const inbound of value.messages) {
                const senderWaId = String(inbound.from || '').startsWith('+')
                  ? String(inbound.from)
                  : `+${String(inbound.from || '').replace(/[^\d]/g, '')}`;
                const senderName =
                  value.contacts?.[0]?.profile?.name || `WhatsApp ${senderWaId}`;
                const msgBody =
                  inbound.text?.body ||
                  inbound.image?.caption ||
                  `[${inbound.type || 'message'}]`;

                // Find or create Contact in Firestore
                let existingContact = contacts.find(
                  (c) =>
                    c.wabaAccountId === targetAcc.id &&
                    c.waId.replace(/[^\d]/g, '') === senderWaId.replace(/[^\d]/g, '')
                );

                const contactId =
                  existingContact?.id ||
                  `contact_${senderWaId.replace(/[^\d]/g, '')}`;

                if (!existingContact) {
                  await setDoc(doc(db, 'contacts', contactId), {
                    userId: user.uid,
                    wabaAccountId: targetAcc.id,
                    waId: senderWaId.slice(0, 24),
                    profileName: String(senderName).slice(0, 120),
                    email: '',
                    company: '',
                    tags: ['inbound-webhook'],
                    optInStatus: 'OPTED_IN',
                    optInSource: 'Inbound WhatsApp Message',
                    notes: '',
                    lastInboundAt: new Date().toISOString(),
                    lastMessagePreview: String(msgBody).slice(0, 500),
                    conversationStatus: 'OPEN',
                    unreadCount: 1,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  });
                } else {
                  await updateDoc(doc(db, 'contacts', contactId), {
                    lastInboundAt: new Date().toISOString(),
                    lastMessagePreview: String(msgBody).slice(0, 500),
                    conversationStatus: 'OPEN',
                    unreadCount: Math.min(10000, (existingContact.unreadCount || 0) + 1),
                    updatedAt: serverTimestamp(),
                  });
                }

                // Store Inbound Message (Idempotent by wamid)
                const safeWamid = String(inbound.id || `in_${Date.now()}`).replace(
                  /[^a-zA-Z0-9_\-]/g,
                  '_'
                );
                await setDoc(doc(db, 'messages', safeWamid.slice(0, 120)), {
                  userId: user.uid,
                  wabaAccountId: targetAcc.id,
                  contactId,
                  recipientPhone: senderWaId.slice(0, 24),
                  direction: 'INBOUND',
                  messageType: ['text', 'image', 'document', 'audio', 'video'].includes(
                    inbound.type
                  )
                    ? inbound.type
                    : 'text',
                  body: String(msgBody).slice(0, 4096),
                  templateName: '',
                  templateLanguage: '',
                  mediaUrl: '',
                  mediaCaption: '',
                  metaMessageId: String(inbound.id || '').slice(0, 160),
                  status: 'DELIVERED',
                  errorCode: '',
                  errorMessage: '',
                  rawApiResponse: JSON.stringify(inbound, null, 2).slice(0, 4096),
                  retryCount: 0,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }

              await setDoc(doc(db, 'webhook_events', eventId), {
                userId: user.uid,
                wabaId: String(packet.wabaId || targetAcc.wabaId).slice(0, 64),
                phoneNumberId: String(packet.phoneNumberId || targetAcc.phoneNumberId).slice(0, 64),
                eventType: 'messages',
                signatureVerified: Boolean(packet.signatureVerified),
                summary: `Inbound message received from ${value.messages[0]?.from}`,
                payloadSnippet: String(packet.rawPayload || '').slice(0, 4096),
                createdAt: serverTimestamp(),
              });
            }

            // 2. Process Delivery / Read / Failed Status Updates from Meta Webhook
            if (Array.isArray(value.statuses) && value.statuses.length > 0) {
              for (const st of value.statuses) {
                const wamid = String(st.id || '');
                const rawStatus = String(st.status || '').toUpperCase();
                const mappedStatus = ['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(rawStatus)
                  ? rawStatus
                  : 'SENT';

                const matchedMsg = messages.find((m) => m.metaMessageId === wamid);
                if (matchedMsg && matchedMsg.status !== 'READ') {
                  await updateDoc(doc(db, 'messages', matchedMsg.id), {
                    metaMessageId: matchedMsg.metaMessageId,
                    status: mappedStatus,
                    errorCode: String(st.errors?.[0]?.code || matchedMsg.errorCode || '').slice(0, 64),
                    errorMessage: String(
                      st.errors?.[0]?.title || matchedMsg.errorMessage || ''
                    ).slice(0, 500),
                    rawApiResponse: JSON.stringify(st, null, 2).slice(0, 4096),
                    retryCount: matchedMsg.retryCount,
                    updatedAt: serverTimestamp(),
                  });
                }
              }

              await setDoc(doc(db, 'webhook_events', eventId), {
                userId: user.uid,
                wabaId: String(packet.wabaId || targetAcc.wabaId).slice(0, 64),
                phoneNumberId: String(packet.phoneNumberId || targetAcc.phoneNumberId).slice(0, 64),
                eventType: 'statuses',
                signatureVerified: Boolean(packet.signatureVerified),
                summary: `Delivery status receipt: ${value.statuses[0]?.status?.toUpperCase()}`,
                payloadSnippet: String(packet.rawPayload || '').slice(0, 4096),
                createdAt: serverTimestamp(),
              });
            }
          } catch (err) {
            console.error('Error applying real-time webhook update:', err);
          }
        };
      } catch (err) {
        console.error('WebSocket initialization error:', err);
      }
    };

    connectSocket();

    return () => {
      isMounted = false;
      ws?.close();
    };
  }, [user, accounts, contacts, messages]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="space-y-2 text-center">
          <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-600">
            Verifying Workspace Session & Security Rules...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  // Enforce Verified Email Gate required by Hardened Firestore Security Rules
  if (!user.emailVerified) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-8 space-y-5">
          <div className="flex items-center gap-2.5 text-amber-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h2 className="text-lg font-bold font-display">Verify Your Email to Access Workspace</h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Our Zero-Trust security policy requires <code className="font-mono">email_verified == true</code> before accessing WhatsApp Business API credentials or customer data. Check <strong>{user.email}</strong> for your verification link, or sign in with Google for immediate verified access.
          </p>
          {verifyBanner && (
            <p className="text-xs text-emerald-400 font-medium">{verifyBanner}</p>
          )}
          <div className="flex flex-col gap-2.5 pt-2">
            <button
              type="button"
              onClick={async () => {
                await refreshUserToken();
              }}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>I Have Verified My Email — Continue</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const msg = await resendVerificationEmail();
                setVerifyBanner(msg);
              }}
              className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs rounded-lg cursor-pointer"
            >
              Resend Verification Email
            </button>
            <button
              type="button"
              onClick={signOut}
              className="w-full py-2 px-4 text-slate-400 hover:text-white text-xs cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8 sticky top-0 z-20">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('inbox');
          }}
          className="text-base font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0"
        >
          NexusWA Cloud
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveTab('inbox')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'inbox'
                ? 'text-slate-900 font-semibold underline underline-offset-8 decoration-2 decoration-emerald-600'
                : 'hover:text-slate-900'
            }`}
          >
            Inbox ({contacts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('accounts')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'accounts'
                ? 'text-slate-900 font-semibold underline underline-offset-8 decoration-2 decoration-emerald-600'
                : 'hover:text-slate-900'
            }`}
          >
            WABA Accounts ({accounts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contacts')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'contacts'
                ? 'text-slate-900 font-semibold underline underline-offset-8 decoration-2 decoration-emerald-600'
                : 'hover:text-slate-900'
            }`}
          >
            Contacts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('templates')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'templates'
                ? 'text-slate-900 font-semibold underline underline-offset-8 decoration-2 decoration-emerald-600'
                : 'hover:text-slate-900'
            }`}
          >
            Templates & Webhooks
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'settings'
                ? 'text-slate-900 font-semibold underline underline-offset-8 decoration-2 decoration-emerald-600'
                : 'hover:text-slate-900'
            }`}
          >
            Account Settings
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('accounts')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Connect WhatsApp Business
          </button>
        </div>
      </header>

      {/* Workspace Body: Sidebar + Main Content Viewport */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar Navigation (240px desktop) */}
        <aside className="w-60 bg-white border-r border-slate-200 hidden xl:flex flex-col justify-between p-4 shrink-0">
          <div className="space-y-6">
            <div className="px-2 space-y-1">
              <p className="text-[11px] font-medium text-slate-400">Workspace Organization</p>
              <p className="text-xs font-bold text-slate-900 truncate">
                {profile?.organizationName || 'Enterprise Workspace'}
              </p>
              <p className="text-[11px] text-slate-500 font-mono truncate">
                {user.email}
              </p>
            </div>

            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setActiveTab('inbox')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'inbox'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <MessageSquare className="w-4 h-4 shrink-0" />
                  <span>Omnichannel Inbox</span>
                </span>
                <span className="font-mono tabular-nums text-[11px]">{messages.length}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('accounts')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'accounts'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <PhoneCall className="w-4 h-4 shrink-0" />
                  <span>WABA Connections</span>
                </span>
                <span className="font-mono tabular-nums text-[11px]">{accounts.length}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('contacts')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'contacts'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 shrink-0" />
                  <span>Contact CRM</span>
                </span>
                <span className="font-mono tabular-nums text-[11px]">{contacts.length}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('templates')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'templates'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <FileCode2 className="w-4 h-4 shrink-0" />
                  <span>Templates & Webhooks</span>
                </span>
                <span className="font-mono tabular-nums text-[11px]">{templates.length}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Settings className="w-4 h-4 shrink-0" />
                  <span>Account Settings</span>
                </span>
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={signOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto max-w-[1440px] w-full mx-auto">
          {activeTab === 'inbox' && (
            <InboxModule
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onSelectAccount={setSelectedAccountId}
              contacts={contacts}
              messages={messages}
              templates={templates}
              onNavigateToContacts={() => setActiveTab('contacts')}
            />
          )}

          {activeTab === 'accounts' && (
            <WabaConnectionModule
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onSelectAccount={setSelectedAccountId}
            />
          )}

          {activeTab === 'contacts' && (
            <ContactManagementModule
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              contacts={contacts}
            />
          )}

          {activeTab === 'templates' && (
            <TemplatesAndWebhooksModule
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              templates={templates}
              webhookEvents={webhookEvents}
            />
          )}

          {activeTab === 'settings' && <AccountSettingsModule />}

          <footer className="mt-12 pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>NexusWA Cloud — Official WhatsApp Business API Management Platform</span>
            <span className="font-medium text-slate-700">Powered by Aamir Engineering</span>
          </footer>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <DashboardWorkspace />
    </AuthProvider>
  );
}
