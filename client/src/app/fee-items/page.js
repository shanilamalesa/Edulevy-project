'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatKES } from '@/lib/money';

const CATEGORIES = ['tuition', 'trip', 'club', 'sport'];
const CLASSES = ['Form 1', 'Form 2', 'Form 3', 'Form 4'];

export default function FeeItemsPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: '', label: '', category: 'tuition', amount: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [bulkFor, setBulkFor] = useState(null);
  const [bulkClass, setBulkClass] = useState('');
  const [bulkResult, setBulkResult] = useState('');

  async function refresh() {
    const res = await fetch('/api/fee-items');
    if (res.ok) setItems((await res.json()).data || []);
  }

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return router.push('/login');
      setMe((await meRes.json()).data);
      await refresh();
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleSubmit() {
    setError('');
    if (!form.code.trim()) return setError('Code is required');
    if (!form.label.trim()) return setError('Label is required');

    const shillings = parseFloat(form.amount);
    if (!shillings || shillings <= 0) return setError('Amount must be greater than zero');

    setSaving(true);
    const res = await fetch('/api/fee-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: form.code.trim(),
        label: form.label.trim(),
        category: form.category,
        amountMinor: Math.round(shillings * 100),
      }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) return setError(json.error?.message || 'Could not save');

    setForm({ code: '', label: '', category: 'tuition', amount: '' });
    refresh();
  }

  // One SQL statement charges every matching student, in one transaction —
  // either they are all charged or none are.
  async function chargeBulk(feeItemId) {
    setBulkResult('');
    const res = await fetch('/api/charges/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feeItemId, classLabel: bulkClass || undefined }),
    });
    const json = await res.json();

    if (!res.ok) {
      setBulkResult(json.error?.message || 'Could not charge');
      return;
    }
    setBulkResult(`Charged ${json.data.created} students${bulkClass ? ` in ${bulkClass}` : ''}.`);
    setBulkFor(null);
    setBulkClass('');
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <Nav active="fees" me={me} />

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            Fee items <span className="text-slate-400 font-normal">({items.length})</span>
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            At the start of term, charge a whole class or the whole school in one action.
          </p>

          {bulkResult && (
            <p className="mb-4 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              {bulkResult}
            </p>
          )}

          {items.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <p className="text-slate-500 text-sm">No fee items yet.</p>
              <p className="text-slate-400 text-xs mt-1">Add one to start charging students.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Code</th>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Label</th>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Category</th>
                    <th className="text-right font-medium text-slate-600 px-5 py-3">Amount</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{f.code}</td>
                      <td className="px-5 py-3 text-slate-900">{f.label}</td>
                      <td className="px-5 py-3">
                        <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">
                          {f.category}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-slate-900">
                        {formatKES(f.amount_minor)}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {bulkFor === f.id ? (
                          <div className="flex gap-2 items-center justify-end">
                            <select
                              value={bulkClass}
                              onChange={(e) => setBulkClass(e.target.value)}
                              className="text-xs px-2 py-1 border border-slate-300 rounded bg-white"
                            >
                              <option value="">Whole school</option>
                              {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button onClick={() => chargeBulk(f.id)}
                              className="text-xs bg-slate-900 text-white px-2 py-1 rounded">
                              Charge
                            </button>
                            <button onClick={() => setBulkFor(null)}
                              className="text-xs text-slate-400">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => { setBulkFor(f.id); setBulkClass(''); }}
                            className="text-xs text-slate-400 hover:text-slate-900 underline">
                            Charge a class
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Add fee item</h2>
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <Field label="Code" value={form.code} placeholder="T3-TUITION"
              onChange={(v) => setForm({ ...form, code: v })} />

            <Field label="Label" value={form.label} placeholder="Term 3 Tuition"
              onChange={(v) => setForm({ ...form, label: v })} />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <Field label="Amount (KES)" value={form.amount} placeholder="12000" type="number"
              onChange={(v) => setForm({ ...form, amount: v })} />

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg
                         text-sm font-medium transition disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add fee item'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                   focus:outline-none focus:ring-2 focus:ring-slate-900"
      />
    </div>
  );
}

function Nav({ active, me }) {
  const link = (href, text) => (
    <a href={href} className={active === text.toLowerCase()
      ? 'text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-900'}>{text}</a>
  );
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-slate-900">{me?.tenantName || 'EduLevy'}</h1>
          <p className="text-xs text-slate-500">Signed in as {me?.role}</p>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          {link('/students', 'Students')}
          {link('/guardians', 'Guardians')}
          {link('/payments', 'Payments')}
          {link('/fee-items', 'Fees')}
          {link('/adjustments', 'Adjustments')}
          {link('/staff', 'Staff')}
          {link('/payroll', 'Payroll')}
          {link('/users', 'Accounts')}
        </nav>
      </div>
    </header>
  );
}