import React, { useEffect, useState } from 'react';
import {
  Phone,
  ShieldCheck,
  RefreshCw,
  Trash2,
  Plus,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Terminal,
  Copy,
  Check,
} from 'lucide-react';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { WabaAccount, VALIDATION_RULES } from '../types/whatsapp';

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

interface WabaConnectionModuleProps {
  accounts: WabaAccount[];
  selectedAccountId: string;
  onSelectAccount: (id: string) => void;
}

export const WabaConnectionModule: React.FC<WabaConnectionModuleProps> = ({
  accounts,
  selectedAccountId,
  onSelectAccount,
}) => {
  const { user, getBearerToken } = useAuth();

  const [metaConfig, setMetaConfig] = useState<{
    metaAppId: string;
    metaConfigId: string;
    graphVersion: string;
    webhookCallbackUrl: string;
    webhookVerifyToken: string;
    hasAppSecret: boolean;
  } | null>(null);

  // Embedded Signup / Manual Meta Graph Connection Form State
  const [connectMode, setConnectMode] = useState<'embedded' | 'system_token'>('embedded');
  const [customAppId, setCustomAppId] = useState('');
  const [customConfigId, setCustomConfigId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState('');
  const [verifiedName, setVerifiedName] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const [busy, setBusy] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    title: string;
    details: string;
    rawJson?: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Re-authorization token modal state for expired/revoked accounts
  const [reauthAccountId, setReauthAccountId] = useState<string | null>(null);
  const [reauthToken, setReauthToken] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await getBearerToken();
        const res = await fetch('/api/meta/config', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && mounted) {
          const data = await res.json();
          setMetaConfig(data);
          if (data.metaAppId && data.metaAppId !== 'YOUR_META_APP_ID') {
            setCustomAppId(data.metaAppId);
          }
          if (data.metaConfigId && data.metaConfigId !== 'YOUR_META_EMBEDDED_SIGNUP_CONFIG_ID') {
            setCustomConfigId(data.metaConfigId);
          }
        }
      } catch (err) {
        console.error('Failed to load Meta server config:', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Listen for Meta Embedded Signup postMessage session info (WABA ID & Phone Number ID)
  useEffect(() => {
    const handleMetaMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
            const receivedWabaId = data.data?.waba_id;
            const receivedPhoneId = data.data?.phone_number_id;
            if (receivedWabaId) setWabaId(String(receivedWabaId));
            if (receivedPhoneId) setPhoneNumberId(String(receivedPhoneId));
            setFeedback({
              type: 'info',
              title: 'Meta Embedded Signup Session Received',
              details: `Authorized WABA ID (${receivedWabaId || 'pending'}) and Phone Number ID (${receivedPhoneId || 'pending'}) captured from Meta dialog.`,
              rawJson: JSON.stringify(data, null, 2),
            });
          } else if (data.event === 'CANCEL') {
            setFeedback({
              type: 'error',
              title: 'Meta Embedded Signup Cancelled',
              details: `Onboarding stopped at step: ${data.data?.current_step || 'user_cancelled'}.`,
            });
          }
        }
      } catch {
        // Ignore non-JSON postMessages
      }
    };

    window.addEventListener('message', handleMetaMessage);
    return () => window.removeEventListener('message', handleMetaMessage);
  }, []);

  const copyToClipboard = (value: string, label: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1800);
  };

  // Launch Official Meta Facebook Login for Business / Embedded Signup SDK
  const launchMetaEmbeddedSignup = () => {
    setFeedback(null);
    const activeAppId = customAppId.trim();
    const activeConfigId = customConfigId.trim();

    if (!activeAppId) {
      setFeedback({
        type: 'error',
        title: 'Meta App ID Required for Embedded Signup Popup',
        details:
          'Enter your Meta Developer App ID and Facebook Login for Business Configuration ID below, or switch to "Direct System User Token + WABA ID" to connect immediately via the Meta Graph API.',
      });
      return;
    }

    const runFbLogin = () => {
      if (!window.FB) return;
      window.FB.init({
        appId: activeAppId,
        autoLogAppEvents: true,
        xfbml: true,
        version: metaConfig?.graphVersion || 'v21.0',
      });

      const loginParams: Record<string, any> = {
        scope: 'whatsapp_business_management,whatsapp_business_messaging,business_management',
        extras: {
          feature: 'whatsapp_embedded_signup',
          version: 2,
          sessionInfoVersion: 3,
        },
      };

      if (activeConfigId) {
        loginParams.config_id = activeConfigId;
        loginParams.response_type = 'code';
        loginParams.override_default_response_type = true;
      }

      window.FB.login((response: any) => {
        if (response?.authResponse) {
          const code = response.authResponse.code;
          const token = response.authResponse.accessToken;
          if (token) setAccessToken(token);
          setFeedback({
            type: 'success',
            title: 'Facebook Login for Business Authorized',
            details: code
              ? 'Authorization code received from Meta. Confirm your WABA ID & Phone Number ID below to complete server-side token exchange.'
              : 'User access token received from Meta. Confirm your WABA ID & Phone Number ID below to complete verification.',
            rawJson: JSON.stringify(response.authResponse, null, 2),
          });
        } else {
          setFeedback({
            type: 'error',
            title: 'Meta Authorization Not Completed',
            details:
              'The user closed the Facebook Login for Business dialog or did not grant whatsapp_business_messaging permissions.',
          });
        }
      }, loginParams);
    };

    if (window.FB) {
      runFbLogin();
    } else {
      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.defer = true;
      script.onload = runFbLogin;
      script.onerror = () => {
        setFeedback({
          type: 'error',
          title: 'Unable to Load connect.facebook.net SDK',
          details:
            'Browser tracking protection or network firewall blocked the Facebook JS SDK. Use the Direct System User Token tab to authorize on the server.',
        });
      };
      document.body.appendChild(script);
    }
  };

  // Authorize & Verify Account via Backend `/api/meta/oauth/exchange` and store in Firestore
  const handleConnectWabaAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFeedback(null);

    const cleanWabaId = wabaId.trim();
    const cleanPhoneId = phoneNumberId.trim();
    const cleanToken = accessToken.trim();

    if (!VALIDATION_RULES.WABA_ID_PATTERN.test(cleanWabaId) || cleanWabaId.length < 5) {
      setFeedback({
        type: 'error',
        title: 'Invalid Meta WABA ID',
        details: 'WhatsApp Business Account ID must be 5–64 alphanumeric/numeric characters.',
      });
      return;
    }

    if (!VALIDATION_RULES.WABA_ID_PATTERN.test(cleanPhoneId) || cleanPhoneId.length < 5) {
      setFeedback({
        type: 'error',
        title: 'Invalid Meta Phone Number ID',
        details: 'Meta Phone Number ID must be 5–64 alphanumeric/numeric characters.',
      });
      return;
    }

    if (!cleanToken) {
      setFeedback({
        type: 'error',
        title: 'Missing Meta Access Token',
        details: 'Provide your authorized Meta System User Access Token or complete Embedded Signup.',
      });
      return;
    }

    setBusy(true);
    const accountId = `waba_${cleanPhoneId.replace(/[^a-zA-Z0-9_\-]/g, '')}`;

    try {
      const bearer = await getBearerToken();
      const response = await fetch('/api/meta/oauth/exchange', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wabaAccountId: accountId,
          wabaId: cleanWabaId,
          phoneNumberId: cleanPhoneId,
          accessToken: cleanToken,
        }),
      });

      const result = await response.json();

      const resolvedPhone = (
        result?.phoneDetails?.displayPhoneNumber ||
        displayPhoneNumber.trim() ||
        `+${cleanPhoneId.slice(0, 11)}`
      ).slice(0, 32);

      const resolvedName = (
        result?.phoneDetails?.verifiedName ||
        verifiedName.trim() ||
        `WABA ${cleanWabaId}`
      ).slice(0, 120);

      const resolvedQuality = result?.phoneDetails?.qualityRating || 'UNKNOWN';
      const resolvedTier = (result?.phoneDetails?.messagingLimitTier || 'TIER_1K').slice(0, 64);
      const resolvedStatus = result?.verifiedWithMetaGraph ? 'CONNECTED' : 'PENDING_VERIFICATION';

      const docRef = doc(db, 'waba_accounts', accountId);
      await setDoc(docRef, {
        userId: user.uid,
        wabaId: cleanWabaId,
        phoneNumberId: cleanPhoneId,
        displayPhoneNumber: resolvedPhone,
        verifiedName: resolvedName,
        qualityRating: ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'].includes(resolvedQuality)
          ? resolvedQuality
          : 'UNKNOWN',
        messagingLimitTier: resolvedTier,
        status: resolvedStatus,
        onboardingMethod: connectMode === 'embedded' ? 'EMBEDDED_SIGNUP' : 'SYSTEM_USER_TOKEN',
        webhookSubscribed: Boolean(result?.webhookSubscribed),
        lastHealthCheckAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      onSelectAccount(accountId);
      setWabaId('');
      setPhoneNumberId('');
      setDisplayPhoneNumber('');
      setVerifiedName('');
      setAccessToken('');

      if (result?.verifiedWithMetaGraph) {
        setFeedback({
          type: 'success',
          title: 'WhatsApp Business Account Verified with Meta Graph API',
          details: `Connected ${resolvedName} (${resolvedPhone}). Access token encrypted in server vault.`,
          rawJson: JSON.stringify(result.rawGraphResponse, null, 2),
        });
      } else {
        setFeedback({
          type: 'info',
          title: 'Account Registered — Meta Graph API Returned Verification Notice',
          details:
            result?.rawGraphResponse?.error?.message ||
            'Credentials stored in server vault, but live Graph API inspection returned an error. Check the raw Graph API response below.',
          rawJson: JSON.stringify(result?.rawGraphResponse || result, null, 2),
        });
      }
    } catch (error: any) {
      try {
        handleFirestoreError(error, OperationType.CREATE, `waba_accounts/${accountId}`);
      } catch (fsErr: any) {
        setFeedback({
          type: 'error',
          title: 'Failed to Save WABA Account',
          details: fsErr?.message || 'Permission or validation error.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  // Run Live Connection Health Check against Meta Graph API
  const handleCheckHealth = async (account: WabaAccount, overrideToken?: string) => {
    setCheckingId(account.id);
    setFeedback(null);
    try {
      const bearer = await getBearerToken();
      const res = await fetch('/api/meta/accounts/health', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wabaAccountId: account.id,
          phoneNumberId: account.phoneNumberId,
          accessToken: overrideToken,
        }),
      });
      const data = await res.json();

      // If user supplied a new token during re-auth, also vault it on the server
      if (overrideToken && overrideToken.trim()) {
        await fetch('/api/meta/oauth/exchange', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            wabaAccountId: account.id,
            wabaId: account.wabaId,
            phoneNumberId: account.phoneNumberId,
            accessToken: overrideToken.trim(),
          }),
        });
      }

      const accRef = doc(db, 'waba_accounts', account.id);
      const nextStatus = data.healthy
        ? 'CONNECTED'
        : data.status === 'TOKEN_EXPIRED'
        ? 'TOKEN_EXPIRED'
        : 'DISCONNECTED';

      await updateDoc(accRef, {
        displayPhoneNumber: (
          data?.phoneDetails?.displayPhoneNumber || account.displayPhoneNumber
        ).slice(0, 32),
        verifiedName: (data?.phoneDetails?.verifiedName || account.verifiedName).slice(0, 120),
        qualityRating: ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'].includes(
          data?.phoneDetails?.qualityRating
        )
          ? data.phoneDetails.qualityRating
          : account.qualityRating,
        messagingLimitTier: (
          data?.phoneDetails?.messagingLimitTier || account.messagingLimitTier
        ).slice(0, 64),
        status: nextStatus,
        webhookSubscribed: Boolean(data.healthy || account.webhookSubscribed),
        lastHealthCheckAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setReauthAccountId(null);
      setReauthToken('');

      setFeedback({
        type: data.healthy ? 'success' : 'error',
        title: data.healthy
          ? `Health Check Passed (${account.displayPhoneNumber})`
          : `Health Check Alert: ${nextStatus}`,
        details: data.healthy
          ? `Verified Name: ${data.phoneDetails?.verifiedName} · Quality Rating: ${data.phoneDetails?.qualityRating}`
          : data.error || data.metaError?.message || 'Meta Graph API rejected token or Phone Number ID.',
        rawJson: JSON.stringify(data.rawGraphResponse || data.metaError || data, null, 2),
      });
    } catch (error: any) {
      setFeedback({
        type: 'error',
        title: 'Health Check Failed',
        details: error?.message || 'Unable to verify connection health.',
      });
    } finally {
      setCheckingId(null);
    }
  };

  const handleDisconnectAccount = async (account: WabaAccount) => {
    setCheckingId(account.id);
    setFeedback(null);
    try {
      const bearer = await getBearerToken();
      await fetch('/api/meta/accounts/disconnect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wabaAccountId: account.id,
          phoneNumberId: account.phoneNumberId,
        }),
      });

      const accRef = doc(db, 'waba_accounts', account.id);
      await deleteDoc(accRef);

      setFeedback({
        type: 'info',
        title: 'WhatsApp Business Account Disconnected',
        details: `Revoked server vault token and removed ${account.verifiedName} (${account.displayPhoneNumber}).`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `waba_accounts/${account.id}`);
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            WhatsApp Business Account Connections
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Official Meta Embedded Signup & Graph API credential vault. Each business phone number is isolated to your workspace.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-600 font-mono tabular-nums">
          <span>Connected Numbers: {accounts.length}</span>
          <span aria-hidden="true">·</span>
          <span>Graph API {metaConfig?.graphVersion || 'v21.0'}</span>
        </div>
      </div>

      {/* API Response / Diagnostic Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border text-xs space-y-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              : feedback.type === 'error'
              ? 'bg-red-50/80 border-red-200 text-red-900'
              : 'bg-slate-100 border-slate-300 text-slate-900'
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 font-semibold">
              {feedback.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
              {feedback.type === 'error' && <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />}
              {feedback.type === 'info' && <Terminal className="w-4 h-4 text-slate-700 shrink-0" />}
              <span>{feedback.title}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs underline opacity-75 hover:opacity-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          <p className="leading-relaxed">{feedback.details}</p>
          {feedback.rawJson && (
            <pre className="p-3 bg-slate-950 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto max-h-48">
              {feedback.rawJson}
            </pre>
          )}
        </div>
      )}

      {/* Connected Accounts Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            01. Authorized WhatsApp Business Phone Numbers
          </h3>
          <span className="text-xs text-slate-500">
            Select an active line to scope Inbox, Templates, and Contacts
          </span>
        </div>

        {accounts.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <Phone className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                No WhatsApp Business Accounts Connected Yet
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Use the Official Meta Embedded Signup flow or register a Meta System User Access Token with your WABA ID and Phone Number ID below.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                  <th className="py-3 px-4">Verified Business Name</th>
                  <th className="py-3 px-4">Display Phone Number</th>
                  <th className="py-3 px-4">WABA ID · Phone ID</th>
                  <th className="py-3 px-4">Connection Status</th>
                  <th className="py-3 px-4">Quality · Limit</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {accounts.map((acc) => {
                  const isSelected = acc.id === selectedAccountId;
                  const isChecking = checkingId === acc.id;
                  return (
                    <React.Fragment key={acc.id}>
                      <tr
                        onClick={() => onSelectAccount(acc.id)}
                        className={`transition-colors cursor-pointer ${
                          isSelected ? 'bg-emerald-50/40' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3.5 px-4 font-semibold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{acc.verifiedName}</span>
                            {isSelected && (
                              <span className="text-[11px] font-normal text-emerald-700">
                                · Active Workspace Line
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-slate-700">
                          {acc.displayPhoneNumber}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-slate-500">
                          {acc.wabaId} · {acc.phoneNumberId}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`font-medium ${
                              acc.status === 'CONNECTED'
                                ? 'text-emerald-700'
                                : acc.status === 'TOKEN_EXPIRED'
                                ? 'text-amber-700'
                                : 'text-red-700'
                            }`}
                          >
                            {acc.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-slate-600">
                          Quality: {acc.qualityRating} · {acc.messagingLimitTier}
                        </td>
                        <td
                          className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={isChecking}
                            onClick={() => handleCheckHealth(acc)}
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                            <span>Verify Health</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setReauthAccountId(reauthAccountId === acc.id ? null : acc.id)
                            }
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Rotate Token</span>
                          </button>
                          <button
                            type="button"
                            disabled={isChecking}
                            onClick={() => handleDisconnectAccount(acc)}
                            className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Disconnect</span>
                          </button>
                        </td>
                      </tr>
                      {reauthAccountId === acc.id && (
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <td colSpan={6} className="p-4">
                            <div className="flex flex-col sm:flex-row items-center gap-3">
                              <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
                                New System User Token for {acc.displayPhoneNumber}:
                              </span>
                              <input
                                type="password"
                                value={reauthToken}
                                onChange={(e) => setReauthToken(e.target.value)}
                                placeholder="Paste fresh EAAG... Meta Graph API token"
                                className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => handleCheckHealth(acc, reauthToken)}
                                className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                Save & Re-Verify on Graph API
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Onboarding & Meta Embedded Signup Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 7 Columns: Official Meta Embedded Signup & Credential Registration */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                02. Connect Eligible WhatsApp Business Account
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Authenticate via Facebook Login for Business (Embedded Signup) or System User Access Token
              </p>
            </div>

            {/* Interactive Segmented Mode Toggle */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
              <button
                type="button"
                onClick={() => setConnectMode('embedded')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  connectMode === 'embedded'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Embedded Signup
              </button>
              <button
                type="button"
                onClick={() => setConnectMode('system_token')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  connectMode === 'system_token'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                System User Token
              </button>
            </div>
          </div>

          {connectMode === 'embedded' && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Meta Developer App ID
                  </label>
                  <input
                    type="text"
                    value={customAppId}
                    onChange={(e) => setCustomAppId(e.target.value)}
                    placeholder="e.g. 129481928491824"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Facebook Login for Business Config ID
                  </label>
                  <input
                    type="text"
                    value={customConfigId}
                    onChange={(e) => setCustomConfigId(e.target.value)}
                    placeholder="e.g. 981237918237192"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={launchMetaEmbeddedSignup}
                className="w-full py-2.5 px-4 bg-[#1877F2] hover:bg-[#166FE5] text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>Launch Official Meta Embedded Signup (Facebook Login for Business)</span>
              </button>
            </div>
          )}

          <form onSubmit={handleConnectWabaAccount} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  WhatsApp Business Account ID (WABA ID) *
                </label>
                <input
                  type="text"
                  required
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder="e.g. 104928194829104"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Phone Number ID *
                </label>
                <input
                  type="text"
                  required
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="e.g. 109482910482910"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Display Phone Number (Fallback if offline)
                </label>
                <input
                  type="text"
                  value={displayPhoneNumber}
                  onChange={(e) => setDisplayPhoneNumber(e.target.value)}
                  placeholder="+1 555 019 2834"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Verified Business Name (Fallback if offline)
                </label>
                <input
                  type="text"
                  value={verifiedName}
                  onChange={(e) => setVerifiedName(e.target.value)}
                  placeholder="Apex Global Support"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Authorized Meta Graph API Access Token (Encrypted in Server Vault) *
              </label>
              <input
                type="password"
                required
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="EAAGm0PX4ZCpsBA..."
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-slate-900"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Your token is encrypted using AES-256-CBC on the backend and verified immediately against{' '}
                <code className="font-mono">graph.facebook.com/{metaConfig?.graphVersion || 'v21.0'}/&#123;PHONE_NUMBER_ID&#125;</code>.
              </p>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>
                {busy
                  ? 'Verifying with Meta Graph API...'
                  : 'Verify & Connect WhatsApp Business Account'}
              </span>
            </button>
          </form>
        </div>

        {/* Right 5 Columns: Webhook Configuration & Compliance Checklist */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="border-b border-slate-200 pb-4">
            <h3 className="text-sm font-semibold text-slate-900">
              03. Meta App Webhook & Callback Endpoints
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure these exact endpoints inside Meta App Dashboard → WhatsApp → Configuration
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Public Callback URL (HTTPS — Use <code className="font-mono">ais-pre</code>, NOT <code className="font-mono">ais-dev</code>)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={
                    metaConfig?.webhookCallbackUrl ||
                    `${window.location.origin.replace('://ais-dev-', '://ais-pre-')}/api/webhooks/whatsapp`
                  }
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-700"
                />
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      metaConfig?.webhookCallbackUrl ||
                        `${window.location.origin.replace('://ais-dev-', '://ais-pre-')}/api/webhooks/whatsapp`,
                      'url'
                    )
                  }
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium hover:bg-slate-50 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedField === 'url' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedField === 'url' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Important: Meta servers cannot reach private <code className="font-mono">ais-dev</code> URLs or localhost/private tunnels unless the app is deployed or publicly shared.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Verify Token (<code className="font-mono">hub.verify_token</code>)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={metaConfig?.webhookVerifyToken || 'nexuswa_verify_token_prod'}
                  onChange={(e) =>
                    setMetaConfig((prev) =>
                      prev ? { ...prev, webhookVerifyToken: e.target.value } : prev
                    )
                  }
                  className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-800"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const tokenToSave =
                      metaConfig?.webhookVerifyToken || 'nexuswa_verify_token_prod';
                    copyToClipboard(tokenToSave, 'token');
                    try {
                      const bearer = await getBearerToken();
                      await fetch('/api/meta/webhook-token', {
                        method: 'POST',
                        headers: {
                          Authorization: `Bearer ${bearer}`,
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ verifyToken: tokenToSave }),
                      });
                    } catch {
                      // Ignore
                    }
                  }}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium hover:bg-slate-50 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedField === 'token' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedField === 'token' ? 'Saved & Copied' : 'Save & Copy'}</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={async () => {
                const tokenToTest =
                  metaConfig?.webhookVerifyToken || 'nexuswa_verify_token_prod';
                const challengeVal = '1158201444';
                const res = await fetch(
                  `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
                    tokenToTest
                  )}&hub.challenge=${challengeVal}`
                );
                const text = await res.text();
                setFeedback({
                  type: res.ok && text === challengeVal ? 'success' : 'error',
                  title:
                    res.ok && text === challengeVal
                      ? 'Server Webhook Handshake Verified (HTTP 200 OK)'
                      : 'Server Webhook Handshake Failed',
                  details:
                    res.ok && text === challengeVal
                      ? `GET /api/webhooks/whatsapp echoed hub.challenge="${text}" with status 200. If Meta Dashboard still shows (#N/A:WBxP-...), click "Share" -> "Publish/Make Public" in AI Studio or deploy to Vercel so Meta's external servers can reach the URL without Google login redirect.`
                      : `Unexpected response (${res.status}): ${text}`,
                });
              }}
              className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              Test Meta Handshake (GET hub.challenge) Locally
            </button>
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Meta Policy & Security Enforcement</span>
            </h4>
            <ul className="space-y-2 text-xs text-slate-600 leading-relaxed">
              <li>
                · <strong>No Personal OTPs or QR Scraping:</strong> Only official Meta OAuth 2.0 and System User tokens are accepted.
              </li>
              <li>
                · <strong>Strict Tenant Isolation:</strong> Each user and business phone number uses its own dedicated credential vault key.
              </li>
              <li>
                · <strong>Required Webhook Fields:</strong> Subscribe to <code className="font-mono">messages</code> and <code className="font-mono">message_template_status_update</code>.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
