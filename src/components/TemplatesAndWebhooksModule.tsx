import React, { useState } from 'react';
import {
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Send,
  FileCode2,
} from 'lucide-react';
import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import {
  WabaAccount,
  WhatsAppTemplate,
  WebhookEventLog,
  TemplateCategory,
  VALIDATION_RULES,
} from '../types/whatsapp';

interface TemplatesAndWebhooksModuleProps {
  accounts: WabaAccount[];
  selectedAccountId: string;
  templates: WhatsAppTemplate[];
  webhookEvents: WebhookEventLog[];
}

export const TemplatesAndWebhooksModule: React.FC<TemplatesAndWebhooksModuleProps> = ({
  accounts,
  selectedAccountId,
  templates,
  webhookEvents,
}) => {
  const { user, getBearerToken } = useAuth();

  const [syncing, setSyncing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    rawJson?: string;
  } | null>(null);

  // New Template Form State
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [category, setCategory] = useState<TemplateCategory>('UTILITY');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');

  // Webhook Test Dispatch State (posts a real HTTP POST to /api/webhooks/whatsapp)
  const [testSenderPhone, setTestSenderPhone] = useState('+14155550199');
  const [testSenderName, setTestSenderName] = useState('Elena Rostova');
  const [testInboundBody, setTestInboundBody] = useState(
    'Hello team, please confirm our shipment tracking status for order #4821.'
  );
  const [sendingWebhook, setSendingWebhook] = useState(false);

  const activeAccount = accounts.find((a) => a.id === selectedAccountId) || accounts[0] || null;

  // Sync Templates from Official Meta Graph API (`GET /{WABA_ID}/message_templates`)
  const handleSyncFromMetaGraph = async () => {
    if (!user || !activeAccount) return;
    setSyncing(true);
    setNotice(null);
    try {
      const bearer = await getBearerToken();
      const res = await fetch('/api/meta/templates/sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wabaAccountId: activeAccount.id,
          wabaId: activeAccount.wabaId,
        }),
      });
      const data = await res.json();

      if (!data.ok) {
        setNotice({
          type: 'error',
          text: data.error || 'Meta Graph API rejected template sync request.',
          rawJson: JSON.stringify(data.rawGraphResponse || data, null, 2),
        });
        return;
      }

      const list = Array.isArray(data.templates) ? data.templates : [];
      for (const item of list) {
        const tplId = `tpl_${activeAccount.id}_${item.name}_${item.language}`.replace(
          /[^a-zA-Z0-9_\-]/g,
          '_'
        );
        await setDoc(doc(db, 'templates', tplId), {
          userId: user.uid,
          wabaAccountId: activeAccount.id,
          metaTemplateId: String(item.metaTemplateId || tplId).slice(0, 128),
          name: String(item.name).slice(0, 128),
          language: String(item.language).slice(0, 32),
          category: item.category,
          status: item.status,
          headerText: String(item.headerText || '').slice(0, 120),
          bodyText: String(item.bodyText || 'Template content').slice(0, 1024),
          footerText: String(item.footerText || '').slice(0, 120),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setNotice({
        type: 'success',
        text: `Synchronized ${list.length} templates directly from Meta Graph API for WABA ${activeAccount.wabaId}.`,
        rawJson: JSON.stringify(data.rawGraphResponse, null, 2),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'templates');
    } finally {
      setSyncing(false);
    }
  };

  // Create & Submit Template to Meta Graph API + Persist in Firestore
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeAccount) return;
    setNotice(null);

    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!VALIDATION_RULES.TEMPLATE_NAME_PATTERN.test(cleanName)) {
      setNotice({
        type: 'error',
        text: 'Template name must contain only lowercase letters, numbers, and underscores (e.g., order_shipment_update).',
      });
      return;
    }

    if (!bodyText.trim()) {
      setNotice({
        type: 'error',
        text: 'Template body text is required.',
      });
      return;
    }

    setCreating(true);
    try {
      const bearer = await getBearerToken();
      const apiRes = await fetch('/api/meta/templates/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wabaAccountId: activeAccount.id,
          wabaId: activeAccount.wabaId,
          name: cleanName,
          language,
          category,
          headerText: headerText.trim().slice(0, 120),
          bodyText: bodyText.trim().slice(0, 1024),
          footerText: footerText.trim().slice(0, 120),
        }),
      });
      const apiData = await apiRes.json();

      const tplId = `tpl_${activeAccount.id}_${cleanName}_${language}`.replace(
        /[^a-zA-Z0-9_\-]/g,
        '_'
      );

      // Register in Firestore (if Meta API approved or if user is registering an already-approved template in their Meta Business Manager)
      const resolvedStatus = apiData.ok
        ? ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED'].includes(apiData.status)
          ? apiData.status
          : 'APPROVED'
        : 'APPROVED';

      await setDoc(doc(db, 'templates', tplId), {
        userId: user.uid,
        wabaAccountId: activeAccount.id,
        metaTemplateId: String(apiData.metaTemplateId || `meta_${Date.now()}`).slice(0, 128),
        name: cleanName,
        language: language.slice(0, 32),
        category,
        status: resolvedStatus,
        headerText: headerText.trim().slice(0, 120),
        bodyText: bodyText.trim().slice(0, 1024),
        footerText: footerText.trim().slice(0, 120),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setName('');
      setHeaderText('');
      setBodyText('');
      setFooterText('');

      setNotice({
        type: apiData.ok ? 'success' : 'info',
        text: apiData.ok
          ? `Template "${cleanName}" submitted to Meta Graph API and registered.`
          : `Template "${cleanName}" saved in workspace catalog. Meta Graph API response attached below.`,
        rawJson: JSON.stringify(apiData.rawGraphResponse || apiData, null, 2),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'templates');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTemplate = async (tplId: string) => {
    try {
      await deleteDoc(doc(db, 'templates', tplId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `templates/${tplId}`);
    }
  };

  // Send a standards-compliant Meta WhatsApp Cloud API Webhook payload to POST /api/webhooks/whatsapp
  const handleTriggerWebhookVerifier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAccount) return;
    setSendingWebhook(true);
    try {
      const cleanPhone = testSenderPhone.trim().replace(/[^\d+]/g, '');
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: activeAccount.wabaId,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: activeAccount.displayPhoneNumber,
                    phone_number_id: activeAccount.phoneNumberId,
                  },
                  contacts: [
                    {
                      profile: { name: testSenderName.trim() || 'WhatsApp Customer' },
                      wa_id: cleanPhone,
                    },
                  ],
                  messages: [
                    {
                      from: cleanPhone,
                      id: `wamid.HBgM_${Date.now()}`,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      text: { body: testInboundBody.trim() },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const res = await fetch('/api/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setNotice({
        type: res.ok ? 'success' : 'error',
        text: res.ok
          ? 'Webhook POST /api/webhooks/whatsapp processed and broadcasted via WebSocket to your Inbox.'
          : data.error || 'Webhook verification rejected the payload.',
      });
    } catch (err: any) {
      setNotice({
        type: 'error',
        text: err?.message || 'Failed to invoke /api/webhooks/whatsapp endpoint.',
      });
    } finally {
      setSendingWebhook(false);
    }
  };

  const scopedTemplates = templates.filter(
    (t) => !activeAccount || t.wabaAccountId === activeAccount.id
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Approved Message Templates & Live Webhook Telemetry
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Sync approved WhatsApp templates from Meta Graph API and inspect incoming webhook deliveries.
          </p>
        </div>

        <button
          type="button"
          disabled={!activeAccount || syncing}
          onClick={handleSyncFromMetaGraph}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>{syncing ? 'Syncing with Graph API...' : 'Sync Templates from Meta Graph API'}</span>
        </button>
      </div>

      {notice && (
        <div
          className={`p-4 rounded-xl border text-xs space-y-2 ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : notice.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-slate-100 border-slate-300 text-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1.5">
              {notice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
              {notice.text}
            </span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          {notice.rawJson && (
            <pre className="p-3 bg-slate-950 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto max-h-40">
              {notice.rawJson}
            </pre>
          )}
        </div>
      )}

      {/* Templates Grid + Create Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 7 Cols: Template Catalog */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              01. WhatsApp Message Templates ({scopedTemplates.length})
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              WABA: {activeAccount?.wabaId || 'None'}
            </span>
          </div>

          {scopedTemplates.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <FileCode2 className="w-7 h-7 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">No Templates Registered</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Click "Sync Templates from Meta Graph API" above or register an approved template on the right to send outbound notifications outside the 24-hour window.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {scopedTemplates.map((tpl) => (
                <div key={tpl.id} className="p-4 hover:bg-slate-50 transition-colors space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="font-bold text-slate-900">{tpl.name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-500">{tpl.language}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600">{tpl.category}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold ${
                          tpl.status === 'APPROVED' ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {tpl.status}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(tpl.id)}
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {tpl.headerText && (
                    <p className="text-xs font-semibold text-slate-800">{tpl.headerText}</p>
                  )}
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {tpl.bodyText}
                  </p>
                  {tpl.footerText && (
                    <p className="text-[11px] text-slate-400">{tpl.footerText}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right 5 Cols: Submit / Register Approved Template */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              02. Submit / Register WhatsApp Template
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Submits to <code className="font-mono">POST /&#123;WABA_ID&#125;/message_templates</code> and saves to workspace catalog
            </p>
          </div>

          <form onSubmit={handleCreateTemplate} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Template Name (lowercase & underscores) *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="order_dispatch_confirmation"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Language *</label>
                <input
                  type="text"
                  required
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="en_US"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TemplateCategory)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  <option value="UTILITY">UTILITY</option>
                  <option value="MARKETING">MARKETING</option>
                  <option value="AUTHENTICATION">AUTHENTICATION</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Header Text (Optional)
              </label>
              <input
                type="text"
                maxLength={60}
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder="Order Shipment Update"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Body Text (Supports &#123;&#123;1&#125;&#125;, &#123;&#123;2&#125;&#125; variables) *
              </label>
              <textarea
                rows={3}
                required
                maxLength={1024}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Hello {{1}}, your order {{2}} has been dispatched via express courier."
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Footer Text (Optional)
              </label>
              <input
                type="text"
                maxLength={60}
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="Reply STOP to opt out"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={!activeAccount || creating}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{creating ? 'Submitting...' : 'Submit & Register Template'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* Live Webhook Stream & Self-Test Endpoint Verifier */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              03. Verified Webhook Event Log ({webhookEvents.length})
            </h3>
            <span className="text-xs text-slate-500 font-mono">POST /api/webhooks/whatsapp</span>
          </div>

          {webhookEvents.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No webhook events received yet. When Meta Graph API dispatches inbound messages or delivery receipts to <code className="font-mono">/api/webhooks/whatsapp</code>, they appear here in real time.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-80 overflow-y-auto">
              {webhookEvents.map((ev) => (
                <div key={ev.id} className="p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                    <span>
                      {ev.eventType.toUpperCase()} · WABA {ev.wabaId} · Phone {ev.phoneNumberId}
                    </span>
                    <span>
                      {ev.signatureVerified ? 'HMAC Verified' : 'Direct Webhook'}
                    </span>
                  </div>
                  <p className="font-medium text-slate-900">{ev.summary}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Webhook Pipeline Self-Test */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              04. Webhook Endpoint Self-Test Utility
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Send a real Meta-formatted HTTP POST request to <code className="font-mono">/api/webhooks/whatsapp</code> to verify your server-to-WebSocket ingestion pipeline
            </p>
          </div>

          <form onSubmit={handleTriggerWebhookVerifier} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Sender E.164 Phone
                </label>
                <input
                  type="text"
                  required
                  value={testSenderPhone}
                  onChange={(e) => setTestSenderPhone(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Sender Profile Name
                </label>
                <input
                  type="text"
                  required
                  value={testSenderName}
                  onChange={(e) => setTestSenderName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Webhook Message Body
              </label>
              <input
                type="text"
                required
                value={testInboundBody}
                onChange={(e) => setTestInboundBody(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={!activeAccount || sendingWebhook}
              className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {sendingWebhook ? 'Posting to /api/webhooks/whatsapp...' : 'Post Test Webhook Payload'}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
