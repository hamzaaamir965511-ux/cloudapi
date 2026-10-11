import React, { useState, useMemo } from 'react';
import {
  Search,
  Send,
  FileText,
  Image as ImageIcon,
  Clock,
  AlertCircle,
  CheckCheck,
  Check,
  RefreshCw,
  Terminal,
  User as UserIcon,
  Phone,
  Building,
  ShieldAlert,
} from 'lucide-react';
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import {
  WabaAccount,
  Contact,
  Message,
  WhatsAppTemplate,
  ConversationStatus,
  isWithin24HourServiceWindow,
} from '../types/whatsapp';

interface InboxModuleProps {
  accounts: WabaAccount[];
  selectedAccountId: string;
  onSelectAccount: (id: string) => void;
  contacts: Contact[];
  messages: Message[];
  templates: WhatsAppTemplate[];
  onNavigateToContacts: () => void;
}

export const InboxModule: React.FC<InboxModuleProps> = ({
  accounts,
  selectedAccountId,
  onSelectAccount,
  contacts,
  messages,
  templates,
  onNavigateToContacts,
}) => {
  const { user, getBearerToken } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ConversationStatus>('ALL');
  const [selectedContactId, setSelectedContactId] = useState<string>('');

  // Composer State
  const [composerTab, setComposerTab] = useState<'text' | 'template' | 'media'>('text');
  const [textBody, setTextBody] = useState('');
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [templateParamInput, setTemplateParamInput] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'document' | 'audio' | 'video'>('image');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');

  const [sending, setSending] = useState(false);
  const [inspectedMessage, setInspectedMessage] = useState<Message | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState<{
    type: 'error' | 'info' | 'success';
    text: string;
  } | null>(null);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || accounts[0] || null,
    [accounts, selectedAccountId]
  );

  // Filter contacts by active WABA account, conversation status, and search query
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (activeAccount && c.wabaAccountId !== activeAccount.id) return false;
      if (statusFilter !== 'ALL' && c.conversationStatus !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.profileName.toLowerCase().includes(q) ||
          c.waId.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [contacts, activeAccount, statusFilter, searchQuery]);

  const activeContact = useMemo(() => {
    const found = filteredContacts.find((c) => c.id === selectedContactId);
    return found || filteredContacts[0] || null;
  }, [filteredContacts, selectedContactId]);

  const conversationMessages = useMemo(() => {
    if (!activeContact) return [];
    return messages
      .filter((m) => m.contactId === activeContact.id)
      .sort((a, b) => {
        const tA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
        const tB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
        return tA - tB;
      });
  }, [messages, activeContact]);

  const approvedTemplates = useMemo(() => {
    return templates.filter(
      (t) =>
        (!activeAccount || t.wabaAccountId === activeAccount.id) &&
        t.status === 'APPROVED'
    );
  }, [templates, activeAccount]);

  const serviceWindow = useMemo(() => {
    if (!activeContact) return { isOpen: false, remainingMinutes: 0 };
    return isWithin24HourServiceWindow(activeContact.lastInboundAt);
  }, [activeContact]);

  const formatTimestamp = (ts: any) => {
    if (!ts) return '—';
    const date = ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const handleUpdateConversationStatus = async (contact: Contact, nextStatus: ConversationStatus) => {
    try {
      const ref = doc(db, 'contacts', contact.id);
      await updateDoc(ref, {
        conversationStatus: nextStatus,
        unreadCount: 0,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `contacts/${contact.id}`);
    }
  };

  // Send message through Official Meta Graph API via backend `/api/meta/messages/send`
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeAccount || !activeContact) return;
    setDispatchNotice(null);

    // 1. Respect Opt-In Consent Policy
    if (activeContact.optInStatus === 'OPTED_OUT') {
      setDispatchNotice({
        type: 'error',
        text: 'Cannot send message: Contact has explicitly OPTED_OUT. Meta WhatsApp Business Policy prohibits messaging opted-out recipients.',
      });
      return;
    }

    // 2. Respect Meta 24-Hour Customer Service Window Policy
    if ((composerTab === 'text' || composerTab === 'media') && !serviceWindow.isOpen) {
      setDispatchNotice({
        type: 'error',
        text: '24-Hour Customer Service Window is closed for this recipient. Per Meta policy, you must send an APPROVED Template message to initiate or re-open the conversation.',
      });
      setComposerTab('template');
      return;
    }

    let resolvedType: Message['messageType'] = 'text';
    let resolvedBody = '';
    let resolvedTemplateName = '';
    let resolvedTemplateLang = 'en_US';
    let resolvedMediaUrl = '';
    let resolvedMediaCaption = '';

    if (composerTab === 'text') {
      if (!textBody.trim()) return;
      resolvedType = 'text';
      resolvedBody = textBody.trim().slice(0, 4096);
    } else if (composerTab === 'template') {
      const tpl = approvedTemplates.find((t) => t.name === selectedTemplateName) || approvedTemplates[0];
      if (!tpl) {
        setDispatchNotice({
          type: 'error',
          text: 'Select an APPROVED WhatsApp template before sending.',
        });
        return;
      }
      resolvedType = 'template';
      resolvedTemplateName = tpl.name;
      resolvedTemplateLang = tpl.language;
      resolvedBody = `[Template: ${tpl.name}] ${tpl.bodyText}`.slice(0, 4096);
    } else if (composerTab === 'media') {
      if (!mediaUrl.trim().startsWith('https://')) {
        setDispatchNotice({
          type: 'error',
          text: 'Meta Cloud API requires a public HTTPS URL for media attachments.',
        });
        return;
      }
      resolvedType = mediaType;
      resolvedMediaUrl = mediaUrl.trim().slice(0, 1024);
      resolvedMediaCaption = mediaCaption.trim().slice(0, 1024);
      resolvedBody = resolvedMediaCaption || `[${mediaType.toUpperCase()}] ${resolvedMediaUrl}`;
    }

    setSending(true);
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      // Step 1: Record message as QUEUED in Firestore prior to Graph API dispatch
      const msgRef = doc(db, 'messages', msgId);
      await setDoc(msgRef, {
        userId: user.uid,
        wabaAccountId: activeAccount.id,
        contactId: activeContact.id,
        recipientPhone: activeContact.waId,
        direction: 'OUTBOUND',
        messageType: resolvedType,
        body: resolvedBody,
        templateName: resolvedTemplateName,
        templateLanguage: resolvedTemplateLang,
        mediaUrl: resolvedMediaUrl,
        mediaCaption: resolvedMediaCaption,
        metaMessageId: '',
        status: 'QUEUED',
        errorCode: '',
        errorMessage: '',
        rawApiResponse: JSON.stringify({ state: 'Dispatched to server queue' }),
        retryCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Step 2: Execute real Meta Graph API POST via server
      const bearer = await getBearerToken();
      const paramsList = templateParamInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const apiRes = await fetch('/api/meta/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wabaAccountId: activeAccount.id,
          phoneNumberId: activeAccount.phoneNumberId,
          recipientPhone: activeContact.waId,
          messageType: resolvedType,
          body: resolvedBody,
          templateName: resolvedTemplateName,
          templateLanguage: resolvedTemplateLang,
          templateParameters: paramsList,
          mediaUrl: resolvedMediaUrl,
          mediaCaption: resolvedMediaCaption,
        }),
      });

      const apiData = await apiRes.json();

      // Step 3: Update message with real Meta Graph API response status (ACCEPTED or FAILED, never fake DELIVERED)
      await updateDoc(msgRef, {
        metaMessageId: String(apiData.metaMessageId || '').slice(0, 160),
        status: apiData.ok ? apiData.status || 'ACCEPTED' : 'FAILED',
        errorCode: String(apiData.errorCode || '').slice(0, 64),
        errorMessage: String(apiData.errorMessage || '').slice(0, 500),
        rawApiResponse: String(apiData.rawApiResponse || JSON.stringify(apiData)).slice(0, 4096),
        retryCount: Number(apiData.retryCount || 0),
        updatedAt: serverTimestamp(),
      });

      // Update contact last message preview
      const contactRef = doc(db, 'contacts', activeContact.id);
      await updateDoc(contactRef, {
        lastMessagePreview: resolvedBody.slice(0, 500),
        updatedAt: serverTimestamp(),
      });

      if (apiData.ok) {
        setTextBody('');
        setMediaUrl('');
        setMediaCaption('');
        setTemplateParamInput('');
        setDispatchNotice({
          type: 'success',
          text: `Meta Graph API accepted request (Status: ${apiData.status} · WAMID: ${apiData.metaMessageId || 'assigned'}). Waiting for webhook delivery receipt.`,
        });
      } else {
        setDispatchNotice({
          type: 'error',
          text: `Meta Graph API Error (${apiData.errorCode}): ${apiData.errorMessage}`,
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `messages/${msgId}`);
    } finally {
      setSending(false);
    }
  };

  // Retry a FAILED message without creating a duplicate record
  const handleRetryFailedMessage = async (msg: Message) => {
    if (!activeAccount || msg.status !== 'FAILED') return;
    setSending(true);
    setDispatchNotice(null);
    try {
      const bearer = await getBearerToken();
      const apiRes = await fetch('/api/meta/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wabaAccountId: activeAccount.id,
          phoneNumberId: activeAccount.phoneNumberId,
          recipientPhone: msg.recipientPhone,
          messageType: msg.messageType,
          body: msg.body,
          templateName: msg.templateName,
          templateLanguage: msg.templateLanguage,
          mediaUrl: msg.mediaUrl,
          mediaCaption: msg.mediaCaption,
        }),
      });
      const apiData = await apiRes.json();

      const msgRef = doc(db, 'messages', msg.id);
      await updateDoc(msgRef, {
        metaMessageId: String(apiData.metaMessageId || msg.metaMessageId || '').slice(0, 160),
        status: apiData.ok ? apiData.status || 'ACCEPTED' : 'FAILED',
        errorCode: String(apiData.errorCode || '').slice(0, 64),
        errorMessage: String(apiData.errorMessage || '').slice(0, 500),
        rawApiResponse: String(apiData.rawApiResponse || JSON.stringify(apiData)).slice(0, 4096),
        retryCount: Math.min(10, (msg.retryCount || 0) + 1),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `messages/${msg.id}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[calc(100vh-9.5rem)] min-h-[620px]">
      {/* Top Filter Bar */}
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
            Business Line:
          </label>
          <select
            value={activeAccount?.id || ''}
            onChange={(e) => onSelectAccount(e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900"
          >
            {accounts.length === 0 && <option value="">No WABA Connected</option>}
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.verifiedName} ({acc.displayPhoneNumber})
              </option>
            ))}
          </select>
        </div>

        {/* Interactive Conversation Status Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {(['ALL', 'OPEN', 'PENDING', 'RESOLVED'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* 3-Pane Messaging Workspace */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0">
        {/* Left Pane (3 cols): Conversation List */}
        <div className="lg:col-span-3 border-r border-slate-200 flex flex-col min-h-0">
          <div className="p-3 border-b border-slate-200">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, E.164 phone..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredContacts.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <p className="text-xs font-semibold text-slate-700">No Conversations Found</p>
                <p className="text-[11px] text-slate-500">
                  Add a verified contact in Contact CRM or receive an inbound webhook message.
                </p>
                <button
                  type="button"
                  onClick={onNavigateToContacts}
                  className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Add Contact
                </button>
              </div>
            ) : (
              filteredContacts.map((contact) => {
                const isSelected = activeContact?.id === contact.id;
                const win = isWithin24HourServiceWindow(contact.lastInboundAt);
                return (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => setSelectedContactId(contact.id)}
                    className={`w-full text-left p-3.5 transition-colors block cursor-pointer ${
                      isSelected ? 'bg-slate-100/90' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {contact.profileName}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                        {contact.conversationStatus}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                      {contact.waId} · {win.isOpen ? '24h Open' : 'Template Only'}
                    </div>
                    <p className="text-xs text-slate-600 truncate mt-1">
                      {contact.lastMessagePreview || 'No messages yet'}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Center Pane (6 cols): Message Thread & Cloud API Composer */}
        <div className="lg:col-span-6 border-r border-slate-200 flex flex-col min-h-0 bg-slate-50/40">
          {!activeContact ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <p className="text-sm font-semibold text-slate-700">
                Select a Contact Conversation
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Choose a contact on the left to inspect real message history, delivery telemetry, and send Cloud API messages.
              </p>
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="px-5 py-3 bg-white border-b border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{activeContact.profileName}</h3>
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      · {activeContact.waId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {serviceWindow.isOpen ? (
                      <span className="text-emerald-700 font-medium">
                        24h Service Window Open ({Math.floor(serviceWindow.remainingMinutes / 60)}h{' '}
                        {serviceWindow.remainingMinutes % 60}m remaining)
                      </span>
                    ) : (
                      <span className="text-amber-700 font-medium">
                        Outside 24h Service Window · Approved Template Required
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {(['OPEN', 'PENDING', 'RESOLVED'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleUpdateConversationStatus(activeContact, st)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activeContact.conversationStatus === st
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message History Stream */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {conversationMessages.length === 0 ? (
                  <div className="text-center py-12 space-y-1">
                    <p className="text-xs font-semibold text-slate-600">
                      No Messages in Thread Yet
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Messages sent via Meta Graph API or received via verified webhooks appear here with exact status receipts.
                    </p>
                  </div>
                ) : (
                  conversationMessages.map((msg) => {
                    const isOutbound = msg.direction === 'OUTBOUND';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-xl p-3.5 text-xs space-y-2 border ${
                            isOutbound
                              ? msg.status === 'FAILED'
                                ? 'bg-red-50 border-red-200 text-red-950'
                                : 'bg-slate-900 border-slate-800 text-white'
                              : 'bg-white border-slate-200 text-slate-900'
                          }`}
                        >
                          {/* Media Preview */}
                          {msg.mediaUrl && (
                            <div className="rounded-lg overflow-hidden border border-slate-700/30 bg-slate-950/30 p-2 space-y-1">
                              {msg.messageType === 'image' ? (
                                <img
                                  src={msg.mediaUrl}
                                  alt={msg.mediaCaption || 'WhatsApp image attachment'}
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                  className="max-h-48 rounded object-cover"
                                />
                              ) : (
                                <div className="flex items-center gap-2 text-[11px] font-mono break-all">
                                  <FileText className="w-4 h-4 shrink-0" />
                                  <a
                                    href={msg.mediaUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline"
                                  >
                                    {msg.mediaUrl}
                                  </a>
                                </div>
                              )}
                            </div>
                          )}

                          <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>

                          {/* Error Diagnostics & Retry Button */}
                          {msg.status === 'FAILED' && (
                            <div className="pt-2 border-t border-red-200/80 flex items-center justify-between gap-3 text-[11px] text-red-700">
                              <span>
                                Error {msg.errorCode}: {msg.errorMessage}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRetryFailedMessage(msg)}
                                className="px-2 py-1 bg-red-700 text-white rounded font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Retry ({msg.retryCount})</span>
                              </button>
                            </div>
                          )}

                          {/* Metadata Footer: Unboxed text with · separators */}
                          <div
                            className={`flex items-center justify-end gap-1.5 text-[10px] font-mono tabular-nums ${
                              isOutbound
                                ? msg.status === 'FAILED'
                                  ? 'text-red-700'
                                  : 'text-slate-300'
                                : 'text-slate-400'
                            }`}
                          >
                            <span>{ msg.messageType.toUpperCase() }</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatTimestamp(msg.createdAt)}</span>
                            {isOutbound && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 font-semibold">
                                  {msg.status === 'READ' && <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />}
                                  {msg.status === 'DELIVERED' && <CheckCheck className="w-3.5 h-3.5" />}
                                  {(msg.status === 'SENT' || msg.status === 'ACCEPTED') && (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  {msg.status === 'FAILED' && <AlertCircle className="w-3.5 h-3.5 text-red-600" />}
                                  {msg.status}
                                </span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() =>
                                setInspectedMessage(inspectedMessage?.id === msg.id ? null : msg)
                              }
                              className="underline hover:opacity-100 opacity-80 cursor-pointer"
                            >
                              API JSON
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Dispatch Notice Banner */}
              {dispatchNotice && (
                <div
                  className={`px-4 py-2.5 border-t text-xs flex items-center justify-between gap-3 ${
                    dispatchNotice.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : dispatchNotice.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-slate-100 border-slate-200 text-slate-800'
                  }`}
                >
                  <span className="truncate">{dispatchNotice.text}</span>
                  <button
                    type="button"
                    onClick={() => setDispatchNotice(null)}
                    className="text-[11px] underline shrink-0 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Cloud API Composer */}
              <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setComposerTab('text')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        composerTab === 'text' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      Text Message
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposerTab('template')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        composerTab === 'template' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      Approved Template
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposerTab('media')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        composerTab === 'media' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      Media Attachment
                    </button>
                  </div>

                  <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                    Consent: {activeContact.optInStatus}
                  </span>
                </div>

                {composerTab === 'text' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={textBody}
                      onChange={(e) => setTextBody(e.target.value)}
                      placeholder={
                        serviceWindow.isOpen
                          ? 'Type a WhatsApp text reply...'
                          : '24h window closed — switch to Approved Template tab'
                      }
                      className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-slate-900"
                    />
                    <button
                      type="submit"
                      disabled={sending || !textBody.trim()}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{sending ? 'Sending...' : 'Send via Cloud API'}</span>
                    </button>
                  </div>
                )}

                {composerTab === 'template' && (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <select
                        value={selectedTemplateName}
                        onChange={(e) => setSelectedTemplateName(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono"
                      >
                        {approvedTemplates.length === 0 && (
                          <option value="">No APPROVED templates synced</option>
                        )}
                        {approvedTemplates.map((t) => (
                          <option key={t.id} value={t.name}>
                            {t.name} ({t.language} · {t.category})
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={templateParamInput}
                        onChange={(e) => setTemplateParamInput(e.target.value)}
                        placeholder="Body variables {{1}}, {{2}} (comma-separated)"
                        className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={sending || approvedTemplates.length === 0}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{sending ? 'Dispatching...' : 'Send Approved Template'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {composerTab === 'media' && (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <select
                        value={mediaType}
                        onChange={(e) => setMediaType(e.target.value as any)}
                        className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                      >
                        <option value="image">Image (HTTPS Link)</option>
                        <option value="document">PDF / Document</option>
                        <option value="audio">Audio</option>
                        <option value="video">Video</option>
                      </select>
                      <input
                        type="url"
                        value={mediaUrl}
                        onChange={(e) => setMediaUrl(e.target.value)}
                        placeholder="https://example.com/invoice.pdf"
                        className="sm:col-span-2 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={mediaCaption}
                        onChange={(e) => setMediaCaption(e.target.value)}
                        placeholder="Optional media caption..."
                        className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                      />
                      <button
                        type="submit"
                        disabled={sending || !mediaUrl.trim()}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>Send Media</span>
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </>
          )}
        </div>

        {/* Right Pane (3 cols): Contact Details & Raw Graph API Telemetry Inspector */}
        <div className="lg:col-span-3 flex flex-col min-h-0 bg-white overflow-y-auto divide-y divide-slate-200">
          {activeContact ? (
            <>
              <div className="p-4 space-y-3">
                <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                  <span>Contact CRM Profile</span>
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Name</span>
                    <span className="font-medium text-slate-900">{activeContact.profileName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> WhatsApp ID
                    </span>
                    <span className="font-mono tabular-nums text-slate-800">{activeContact.waId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1">
                      <Building className="w-3 h-3" /> Company
                    </span>
                    <span className="text-slate-800">{activeContact.company || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Opt-In Status</span>
                    <span className="font-mono font-medium text-slate-900">
                      {activeContact.optInStatus} ({activeContact.optInSource || 'Direct'})
                    </span>
                  </div>
                  <div className="pt-1">
                    <span className="text-slate-500 block mb-1">Tags</span>
                    <p className="text-xs text-slate-700 font-mono">
                      {activeContact.tags.length > 0 ? activeContact.tags.join(' · ') : 'No tags assigned'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-2">
                <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
                  <span>Delivery Status Rules</span>
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Messages are marked <strong>ACCEPTED</strong> when Meta Graph API returns a <code className="font-mono">wamid</code>. They transition to <strong>SENT</strong>, <strong>DELIVERED</strong>, or <strong>READ</strong> strictly upon receiving verified webhook status events.
                </p>
              </div>
            </>
          ) : null}

          {/* Raw Graph API Payload Inspector */}
          <div className="p-4 space-y-2 flex-1">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span>Actual Meta API Response</span>
            </h4>
            {inspectedMessage ? (
              <div className="space-y-2">
                <div className="text-[11px] font-mono text-slate-600">
                  WAMID: {inspectedMessage.metaMessageId || 'None'} · Status: {inspectedMessage.status}
                </div>
                <pre className="p-3 bg-slate-950 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto max-h-64">
                  {inspectedMessage.rawApiResponse}
                </pre>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                Click "API JSON" on any message bubble to inspect the raw Meta Graph API response payload and error codes.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
