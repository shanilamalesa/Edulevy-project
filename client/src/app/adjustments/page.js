'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatKES } from '@/lib/money';

const KINDS = ['waiver', 'bursary', 'reversal', 'correction'];

export default function AdjustmentsPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [students, setStudents] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ studentId: '', kind: 'waiver', amount: '', reason: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const res = await fetch('/api/adjustments');
    if (res.ok) setItems((await res.json()).data || []);
  }

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return router.push('/login');
      setMe((await meRes.json()).data);

      const s = await fetch('/api/students');
      if (s.ok) setStudents((await s.json()).data || []);

      await refresh();
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleSubmit() {
    setError('');
    if (!form.studentId) return setError('Choose a student');
    if (form.reason.trim().length < 5) return setError('Give a reason — at least 5 characters');

    const shillings = parseFloat(form.amount);
    if (!shillings || shillings <= 0) return setError('Amount must be greater than zero');

    // A waiver or bursary reduces what is owed, so the amount is negative.
    // A correction increases it.
    const sign = ['waiver', 'bursary', 'reversal'].includes(form.kind) ? -1 : 1;

    setSaving(true);
    const res = await fetch('/api/adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: form.studentId,
        kind: form.kind,
        amountMinor: sign * Math.round(shillings * 100),
        reason: form.reason.trim(),
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) return setError(json.error?.message || 'Could not save');

    setForm({ studentId: '', kind: 'waiver', amount: '', reason: '' });
    refresh();
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  const isManager = me?.role === 'manager';

  return (
    <main className="min-h-screen bg-slate-50">
      <Nav active="adjustments" />

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Adjustments <span className="text-slate-400 font-normal">({items.length})</span>
          </h2>

          {items.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <p className="text-slate-500 text-sm">No adjustments yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Student</th>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Kind</th>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Reason</th>
                    <th className="text-right font-medium text-slate-600 px-5 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="text-slate-900">{a.student_name}</div>
                        <div className="text-xs text-slate-400 font-mono">{a.admission_no}</div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-block px-2 py-0.5 rounded bg-purple-50 text-purple-700 text-xs">
                          {a.kind}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-700">
                        {a.reason}
                        <span className="block text-xs text-slate-400">by {a.actor_email}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-slate-900">
                        {formatKES(Math.abs(a.amount_minor))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">New adjustment</h2>

          {!isManager ? (
            // The button is hidden, but the API rejects a bursar regardless.
            // Hiding a control is not security.
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <p className="text-sm text-amber-800 font-medium">Manager only</p>
              <p className="text-xs text-amber-700 mt-1">
                Waiving fees reduces what the school collects, so it is restricted
                to the manager. The API rejects it too, not just this form.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Student</label>
                <select
                  value={form.studentId}
                  onChange={(e) => setForm({ ...form, studentId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">Choose…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.admission_no} — {s.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Kind</label>
                <select
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (KES)</label>
                <input
                  type="number"
                  value={form.amount}
                  placeholder="500"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Reason</label>
                <textarea
                  value={form.reason}
                  rows={3}
                  placeholder="Family hardship — approved by board"
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Recorded permanently in the audit log.
                </p>
              </div>

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
                {saving ? 'Saving…' : 'Record adjustment'}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Nav({ active }) {
  const link = (href, text) => (
    
    <a href={href}
      className={active === text.toLowerCase()
        ? 'text-slate-900 font-medium'
        : 'text-slate-500 hover:text-slate-900'}
    >
      {text}
    </a>
  );
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <h1 className="font-semibold text-slate-900">EduLevy</h1>
        <nav className="flex items-center gap-4 text-sm">
          {link('/students', 'Students')}
          {link('/payments', 'Payments')}
          {link('/fee-items', 'Fees')}
          {link('/adjustments', 'Adjustments')}
        </nav>
      </div>
    </header>
  );
}