import React, { useState } from 'react';
import { ShieldCheck, Lock, Mail, ArrowRight, KeyRound, Building2, UserCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AuthScreen: React.FC = () => {
  const {
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    sendPasswordReset,
    authError,
    clearAuthError,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const switchMode = (nextMode: 'login' | 'register' | 'reset') => {
    clearAuthError();
    setStatusBanner(null);
    setMode(nextMode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    setStatusBanner(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else if (mode === 'register') {
        await registerWithEmail(email, password, displayName, organizationName);
        setStatusBanner('Account created. Please verify your email or sign in with Google for instant verified access.');
      } else if (mode === 'reset') {
        const msg = await sendPasswordReset(email);
        setStatusBanner(msg);
      }
    } catch {
      // Handled via authError in context
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    clearAuthError();
    setStatusBanner(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch {
      // Handled via context
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-8 py-4 border-b border-slate-800/80">
        <a href="#top" className="text-lg font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0">
          NexusWA Cloud
        </a>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <a href="#embedded-signup" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Embedded Signup
          </a>
          <a href="#cloud-api" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Cloud API
          </a>
          <a href="#webhooks" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Webhooks
          </a>
          <a href="#security" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Zero-Trust RBAC
          </a>
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Authorize Workspace
          </button>
        </div>
      </header>

      {/* Main Split Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left Column: Platform Architecture & Compliance */}
        <div className="lg:col-span-7 space-y-8">
          <div className="space-y-4">
            <p className="text-xs font-medium text-emerald-400 tracking-wide">
              Meta WhatsApp Business Cloud API Platform · Graph API v21.0
            </p>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white font-display leading-tight" style={{ textWrap: 'balance' }}>
              Enterprise WhatsApp Cloud API Operations & Real-Time Inbox
            </h1>
            <p className="text-base text-slate-300 max-w-2xl leading-relaxed">
              Connect eligible WhatsApp Business Accounts through Meta Embedded Signup, manage multi-number routing, dispatch approved templates, and process HMAC-verified webhooks with strict tenant isolation.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-800/80">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Official Meta Embedded Signup</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                OAuth 2.0 code exchange and System User token vaulting per WABA ID and Phone Number ID. Never requests personal WhatsApp OTPs.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Real Delivery Telemetry</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Distinguishes Queued, Accepted, Sent, Delivered, Read, and Failed states with 24-hour customer service window enforcement.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-4 text-xs text-slate-400 font-mono tabular-nums">
            <span>X-Hub-Signature-256 HMAC</span>
            <span aria-hidden="true">·</span>
            <span>E.164 Contact Validation</span>
            <span aria-hidden="true">·</span>
            <span>Tenant-Scoped Firestore Rules</span>
          </div>
        </div>

        {/* Right Column: Authentication Card */}
        <div className="lg:col-span-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-white font-display">
                {mode === 'login' && 'Sign in to Workspace'}
                {mode === 'register' && 'Create SaaS Workspace'}
                {mode === 'reset' && 'Reset Account Password'}
              </h2>
              <p className="text-xs text-slate-400">
                {mode === 'login' && 'Authenticate to access your connected WhatsApp Business accounts.'}
                {mode === 'register' && 'Provision an isolated multi-number WhatsApp Business workspace.'}
                {mode === 'reset' && 'Receive a secure password recovery link via email.'}
              </p>
            </div>

            {/* Segmented Mode Control */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'login' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'register' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Register
              </button>
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'reset' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Reset
              </button>
            </div>

            {authError && (
              <div className="p-3.5 rounded-lg bg-red-950/60 border border-red-800/80 text-xs text-red-200 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-2 flex-1 min-w-0">
                  <p className="font-medium">Authentication Notice</p>
                  <p className="text-red-300 leading-relaxed break-words">{authError}</p>
                  {typeof window !== 'undefined' && authError.includes('Authorized domains') && (
                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(window.location.hostname)}
                        className="px-2.5 py-1 bg-slate-900 border border-red-700/80 rounded text-[11px] font-mono text-white hover:bg-slate-800 cursor-pointer"
                      >
                        Copy Domain: {window.location.hostname}
                      </button>
                      <a
                        href="https://console.firebase.google.com/project/gen-lang-client-0035122854/authentication/settings"
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 bg-red-800/80 hover:bg-red-700 text-white rounded text-[11px] font-medium underline"
                      >
                        Open Firebase Authorized Domains →
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {statusBanner && (
              <div className="p-3.5 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-xs text-emerald-200 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{statusBanner}</p>
              </div>
            )}

            {/* Primary Google Workspace OAuth Button */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserCheck className="w-4 h-4 shrink-0" />
              <span>Continue with Verified Google Account</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="flex-shrink mx-3 text-xs text-slate-500">Or email credentials</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={120}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Elena Rostova"
                      className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Company / Business Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={160}
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      placeholder="Rostova Global Logistics Ltd."
                      className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Work Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                  <input
                    type="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@company.com"
                    className="w-full pl-10 pr-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {mode !== 'reset' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full pl-10 pr-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                <span>
                  {mode === 'login' && 'Sign In with Email'}
                  {mode === 'register' && 'Create Workspace Account'}
                  {mode === 'reset' && 'Send Password Reset Email'}
                </span>
              </button>
            </form>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800/80 px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
        <span>NexusWA Cloud · Enterprise WhatsApp Business API SaaS</span>
        <span className="font-medium text-slate-300">Powered by Aamir Engineering</span>
      </footer>
    </div>
  );
};
