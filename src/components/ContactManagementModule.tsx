import React, { useState, useMemo } from 'react';
import {
  Search,
  UserPlus,
  Edit3,
  Trash2,
  CheckCircle2,
  X,
  Download,
  Upload,
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
import {
  WabaAccount,
  Contact,
  OptInStatus,
  VALIDATION_RULES,
} from '../types/whatsapp';

interface ContactManagementModuleProps {
  accounts: WabaAccount[];
  selectedAccountId: string;
  contacts: Contact[];
}

export const ContactManagementModule: React.FC<ContactManagementModuleProps> = ({
  accounts,
  selectedAccountId,
  contacts,
}) => {
  const { user } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [optInFilter, setOptInFilter] = useState<'ALL' | OptInStatus>('ALL');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');

  // Add / Edit Contact Drawer / Form State
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [wabaAccountId, setWabaAccountId] = useState(selectedAccountId || accounts[0]?.id || '');
  const [waId, setWaId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [optInStatus, setOptInStatus] = useState<OptInStatus>('OPTED_IN');
  const [optInSource, setOptInSource] = useState('Web Form Consent');
  const [notes, setNotes] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (selectedAccountId && c.wabaAccountId !== selectedAccountId) return false;
      if (optInFilter !== 'ALL' && c.optInStatus !== optInFilter) return false;
      if (selectedTag !== 'ALL' && !c.tags.includes(selectedTag)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.profileName.toLowerCase().includes(q) ||
          c.waId.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [contacts, selectedAccountId, optInFilter, selectedTag, searchQuery]);

  const openCreateForm = () => {
    setEditingContact(null);
    setWabaAccountId(selectedAccountId || accounts[0]?.id || '');
    setWaId('');
    setProfileName('');
    setEmail('');
    setCompany('');
    setTagsInput('enterprise, priority');
    setOptInStatus('OPTED_IN');
    setOptInSource('Explicit Customer Opt-In');
    setNotes('');
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (contact: Contact) => {
    setEditingContact(contact);
    setWabaAccountId(contact.wabaAccountId);
    setWaId(contact.waId);
    setProfileName(contact.profileName);
    setEmail(contact.email);
    setCompany(contact.company);
    setTagsInput(contact.tags.join(', '));
    setOptInStatus(contact.optInStatus);
    setOptInSource(contact.optInSource);
    setNotes(contact.notes);
    setFormError(null);
    setShowForm(true);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);
    setFormSuccess(null);

    const targetWaba = wabaAccountId || selectedAccountId || accounts[0]?.id;
    if (!targetWaba) {
      setFormError('Connect a WhatsApp Business Account first before adding contacts.');
      return;
    }

    const cleanPhone = waId.trim().replace(/[\s\-()]/g, '');
    if (!VALIDATION_RULES.E164_PHONE_PATTERN.test(cleanPhone)) {
      setFormError('Enter a valid E.164 WhatsApp phone number (7–20 digits, e.g., +14155550199).');
      return;
    }

    const cleanName = profileName.trim().slice(0, VALIDATION_RULES.MAX_DISPLAY_NAME);
    if (!cleanName) {
      setFormError('Contact profile name is required.');
      return;
    }

    const parsedTags = tagsInput
      .split(',')
      .map((t) => t.trim().slice(0, VALIDATION_RULES.MAX_TAG_LENGTH))
      .filter(Boolean)
      .slice(0, VALIDATION_RULES.MAX_TAGS);

    setSaving(true);
    try {
      if (editingContact) {
        const ref = doc(db, 'contacts', editingContact.id);
        await updateDoc(ref, {
          profileName: cleanName,
          email: email.trim().slice(0, 254),
          company: company.trim().slice(0, 120),
          tags: parsedTags,
          optInStatus,
          optInSource: optInSource.trim().slice(0, 80),
          notes: notes.trim().slice(0, VALIDATION_RULES.MAX_NOTES),
          conversationStatus: editingContact.conversationStatus,
          unreadCount: editingContact.unreadCount,
          lastInboundAt: editingContact.lastInboundAt,
          lastMessagePreview: editingContact.lastMessagePreview,
          updatedAt: serverTimestamp(),
        });
        setFormSuccess(`Updated contact ${cleanName} (${cleanPhone}).`);
      } else {
        const contactId = `contact_${cleanPhone.replace(/[^0-9]/g, '')}_${Date.now().toString(36)}`;
        const ref = doc(db, 'contacts', contactId);
        await setDoc(ref, {
          userId: user.uid,
          wabaAccountId: targetWaba,
          waId: cleanPhone,
          profileName: cleanName,
          email: email.trim().slice(0, 254),
          company: company.trim().slice(0, 120),
          tags: parsedTags,
          optInStatus,
          optInSource: optInSource.trim().slice(0, 80),
          notes: notes.trim().slice(0, VALIDATION_RULES.MAX_NOTES),
          lastInboundAt: new Date().toISOString(),
          lastMessagePreview: 'Contact added with active 24h window',
          conversationStatus: 'OPEN',
          unreadCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setFormSuccess(`Created contact ${cleanName} (${cleanPhone}).`);
      }
      setShowForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'contacts');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContact = async (contact: Contact) => {
    try {
      await deleteDoc(doc(db, 'contacts', contact.id));
      setFormSuccess(`Deleted contact ${contact.profileName}.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `contacts/${contact.id}`);
    }
  };

  const handleExportCsv = () => {
    const headers = ['Profile Name', 'WhatsApp E.164', 'Email', 'Company', 'Opt-In Status', 'Tags'];
    const rows = filteredContacts.map((c) => [
      `"${c.profileName.replace(/"/g, '""')}"`,
      `"${c.waId}"`,
      `"${c.email}"`,
      `"${c.company}"`,
      `"${c.optInStatus}"`,
      `"${c.tags.join(';')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexuswa_contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleQuickImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const targetWaba = selectedAccountId || accounts[0]?.id;
    if (!targetWaba) {
      setFormError('Connect a WhatsApp Business Account before importing CSV contacts.');
      return;
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    let imported = 0;

    for (let i = 1; i < Math.min(lines.length, 25); i++) {
      const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      const name = (cols[0] || '').slice(0, 120);
      const phone = (cols[1] || '').replace(/[\s\-()]/g, '');
      if (name && VALIDATION_RULES.E164_PHONE_PATTERN.test(phone)) {
        const contactId = `contact_${phone.replace(/[^0-9]/g, '')}_${i}`;
        await setDoc(doc(db, 'contacts', contactId), {
          userId: user.uid,
          wabaAccountId: targetWaba,
          waId: phone,
          profileName: name,
          email: (cols[2] || '').slice(0, 254),
          company: (cols[3] || '').slice(0, 120),
          tags: ['csv-import'],
          optInStatus: 'OPTED_IN',
          optInSource: 'CSV Bulk Import',
          notes: '',
          lastInboundAt: new Date().toISOString(),
          lastMessagePreview: 'Imported via CSV',
          conversationStatus: 'OPEN',
          unreadCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        imported++;
      }
    }
    setFormSuccess(`Imported ${imported} verified contacts from CSV.`);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Contact Management & Opt-In Ledger
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage E.164 WhatsApp recipients, explicit opt-in consent records, and segmentation tags.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV</span>
            <input type="file" accept=".csv" onChange={handleQuickImportCsv} className="hidden" />
          </label>
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={openCreateForm}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Contact</span>
          </button>
        </div>
      </div>

      {formSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{formSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setFormSuccess(null)}
            className="text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create / Edit Contact Modal Panel */}
      {showForm && (
        <div className="bg-white border border-slate-300 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              {editingContact ? `Edit Contact: ${editingContact.profileName}` : 'Add New WhatsApp Contact'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {formError}
            </div>
          )}

          <form onSubmit={handleSaveContact} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Associated WABA Account *
                </label>
                <select
                  value={wabaAccountId}
                  disabled={Boolean(editingContact)}
                  onChange={(e) => setWabaAccountId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.verifiedName} ({acc.displayPhoneNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Marcus Vance"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  WhatsApp Number (E.164) *
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingContact)}
                  value={waId}
                  onChange={(e) => setWaId(e.target.value)}
                  placeholder="+14155550199"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="marcus@company.com"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Company</label>
                <input
                  type="text"
                  maxLength={120}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Vance Freight Systems"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Opt-In Consent Status *
                </label>
                <select
                  value={optInStatus}
                  onChange={(e) => setOptInStatus(e.target.value as OptInStatus)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  <option value="OPTED_IN">OPTED_IN (Verified Consent)</option>
                  <option value="PENDING">PENDING</option>
                  <option value="OPTED_OUT">OPTED_OUT (Do Not Message)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Consent Source
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={optInSource}
                  onChange={(e) => setOptInSource(e.target.value)}
                  placeholder="Checkout Opt-in Checkbox"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Segmentation Tags (comma-separated, max 10)
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="vip, logistics, emea"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  CRM Notes
                </label>
                <input
                  type="text"
                  maxLength={1000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Key account decision maker..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                {saving ? 'Saving...' : editingContact ? 'Save Changes' : 'Create Contact'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts by name, E.164 phone, email, or company..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-slate-900"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'OPTED_IN', 'PENDING', 'OPTED_OUT'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setOptInFilter(status)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  optInFilter === status
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700"
          >
            <option value="ALL">All Tags ({allTags.length})</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                Tag: {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* High-Density Contact Data Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredContacts.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-800">No Matching Contacts</p>
            <p className="text-xs text-slate-500">
              Add a new contact with E.164 formatting or clear your active search filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                  <th className="py-3 px-4">Contact Name</th>
                  <th className="py-3 px-4">WhatsApp E.164</th>
                  <th className="py-3 px-4">Company · Email</th>
                  <th className="py-3 px-4">Consent Status</th>
                  <th className="py-3 px-4">Segmentation Tags</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredContacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {contact.profileName}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                      {contact.waId}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {contact.company || '—'} · {contact.email || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      <span
                        className={`font-medium ${
                          contact.optInStatus === 'OPTED_IN'
                            ? 'text-emerald-700'
                            : contact.optInStatus === 'OPTED_OUT'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {contact.optInStatus}
                      </span>
                      <span className="text-slate-400"> · {contact.optInSource || 'Direct'}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {contact.tags.length > 0 ? contact.tags.join(' · ') : '—'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditForm(contact)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteContact(contact)}
                        className="px-2.5 py-1 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
