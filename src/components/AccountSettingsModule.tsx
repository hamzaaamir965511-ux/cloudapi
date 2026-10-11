import React, { useState, useEffect } from 'react';
import { Save, KeyRound, CheckCircle2, Shield, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AccountSettingsModule: React.FC = () => {
  const {
    user,
    profile,
    privateInfo,
    updateWorkspaceProfile,
    sendPasswordReset,
  } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [organizationName, setOrganizationName] = useState(profile?.organizationName || '');
  const [timezone, setTimezone] = useState(profile?.timezone || 'UTC');
  const [notificationEmail, setNotificationEmail] = useState(
    privateInfo?.notificationEmail || user?.email || ''
  );

  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setOrganizationName(profile.organizationName);
      setTimezone(profile.timezone);
    }
    if (privateInfo) {
      setNotificationEmail(privateInfo.notificationEmail);
    }
  }, [profile, privateInfo]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setBanner(null);
    try {
      await updateWorkspaceProfile(displayName, organizationName, timezone, notificationEmail);
      setBanner('Workspace profile and isolated PII notification settings updated.');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerPasswordReset = async () => {
    if (!user?.email) return;
    const msg = await sendPasswordReset(user.email);
    setBanner(msg);
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-xl font-bold text-slate-900 font-display">
          Workspace Profile & Security Settings
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Manage your organization identity, RBAC role verification, and isolated PII contact settings.
        </p>
      </div>

      {banner && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{banner}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
            01. Organization & Operator Identity
          </h3>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Business / Organization Name
              </label>
              <input
                type="text"
                required
                maxLength={160}
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Operational Timezone
              </label>
              <input
                type="text"
                required
                maxLength={64}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Alert & Webhook Failure Notification Email (Isolated PII Vault)
              </label>
              <input
                type="email"
                required
                maxLength={254}
                value={notificationEmail}
                onChange={(e) => setNotificationEmail(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Workspace Settings'}</span>
            </button>
          </form>
        </div>

        <div className="md:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
            02. RBAC & Session Security
          </h3>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Firebase Tenant UID</span>
              <span className="font-mono text-slate-800">{user?.uid.slice(0, 16)}...</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Account Email</span>
              <span className="font-mono text-slate-800">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Email Verified Gate</span>
              <span className="font-mono font-semibold text-emerald-700">
                {user?.emailVerified ? 'VERIFIED' : 'PENDING'}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Assigned RBAC Role</span>
              <span className="font-mono font-semibold text-slate-900 uppercase">
                {profile?.role || 'owner'}
              </span>
            </div>
          </div>

          <div className="pt-2 space-y-3">
            <button
              type="button"
              onClick={handleTriggerPasswordReset}
              className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Send Password Reset Link to Email</span>
            </button>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-1">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-600" />
                <span>Zero-Trust Data Isolation</span>
              </div>
              <p className="leading-relaxed">
                Every Firestore query and backend Graph API proxy call verifies your signed Firebase ID Token (<code className="font-mono">Bearer</code>) and enforces strict <code className="font-mono">userId == request.auth.uid</code> ownership.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
