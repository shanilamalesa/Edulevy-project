'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatKES } from '@/lib/money';

export default function StaffPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ fullName: '', msisdn: '', roleTitle: 'Teacher', gross: '' });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const res = await fetch('/api/staff');
    if (res.ok) setStaff((await res.json()).data || []);
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

  async function addStaff() {
    setError('');
    if (!form.fullName.trim()) return setError('Name is required');
    if (!form.msisdn.trim()) return setError('Phone number is required');

    const shillings = parseFloat(form.gross);
    if (!shillings || shillings <= 0) return setError('Salary must be greater than zero');

    setSaving(true);
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: form.fullName.trim(),
        msisdn: form.msisdn.trim(),
        roleTitle: form.roleTitle,
        grossMinor: Math.round(shillings * 100),
      }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) return setError(json.error?.message || 'Could not save');

    setForm({ fullName: '', msisdn: '', roleTitle: 'Teacher', gross: '' });
    setAdding(false);
    refresh();
  }

  async function saveEdit() {
    setError('');
    setSaving(true);
    const res = await fetch(`/api/staff/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: editing.full_name,
        roleTitle: editing.role_title,
        grossMinor: Number(editing.gross_minor),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json();
      return setError(json.error?.message || 'Could not save');
    }
    setEditing(null);
    refresh();
  }

  async function toggleActive(s) {
    await fetch(`/api/staff/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !s.active }),
    });
    refresh();
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  const isManager = me?.role === 'manager';

  return (
    <main className="min-h-screen bg-slate-50">
      <Nav active="staff" me={me} />

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Staff <span className="text-slate-400 font-normal">({staff.length})</span>
          </h2>
          {isManager && (
            <button
              onClick={() => { setAdding(!adding); setError(''); }}
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {adding ? 'Cancel' : 'Add staff'}
            </button>
          )}
        </div>

        {/* <p className="text-xs text-slate-500 mb-6">
          A salary figure commits the school&apos;s money, so only the manager can add
          or change staff. Deactivated staff are excluded from future payroll runs
          but keep their history.
        </p> */}

        {adding && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
            <div className="grid grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input value={form.fullName} placeholder="Peter Otieno"
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input value={form.msisdn} placeholder="+254722000111"
                  onChange={(e) => setForm({ ...form, msisdn: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
                <select value={form.roleTitle}
                  onChange={(e) => setForm({ ...form, roleTitle: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                  {['Teacher', 'Bursar', 'Admin', 'Support'].map((r) =>
                    <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Salary (KES)</label>
                <input type="number" value={form.gross} placeholder="45000"
                  onChange={(e) => setForm({ ...form, gross: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <button onClick={addStaff} disabled={saving}
                className="bg-slate-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {error && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>
        )}

        {staff.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-slate-500 text-sm">No staff yet.</p>
            <p className="text-slate-400 text-xs mt-1">Payroll needs staff before it can generate a run.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Name</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Phone</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Role</th>
                  <th className="text-right font-medium text-slate-600 px-5 py-3">Monthly</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Status</th>
                  {isManager && <th className="px-5 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staff.map((s) => {
                  const isEditing = editing?.id === s.id;
                  return (
                    <tr key={s.id} className={s.active ? 'hover:bg-slate-50' : 'bg-slate-50/50 text-slate-400'}>
                      <td className="px-5 py-3">
                        {isEditing ? (
                          <input value={editing.full_name}
                            onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                            className="px-2 py-1 border border-slate-300 rounded text-sm w-full" />
                        ) : (
                          <span className="text-slate-900 font-medium">{s.full_name}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{s.msisdn}</td>
                      <td className="px-5 py-3 text-slate-500">{s.role_title || '—'}</td>
                      <td className="px-5 py-3 text-right">
                        {isEditing ? (
                          <input type="number" value={Number(editing.gross_minor) / 100}
                            onChange={(e) => setEditing({ ...editing, gross_minor: Math.round(e.target.value * 100) })}
                            className="px-2 py-1 border border-slate-300 rounded text-sm w-28 text-right" />
                        ) : (
                          <span className="font-medium text-slate-900">{formatKES(s.gross_minor)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                          s.active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {s.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {isManager && (
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          {isEditing ? (
                            <>
                              <button onClick={saveEdit} disabled={saving}
                                className="text-xs text-slate-900 font-medium mr-2">Save</button>
                              <button onClick={() => setEditing(null)}
                                className="text-xs text-slate-400">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => setEditing({ ...s })}
                                className="text-xs text-slate-400 hover:text-slate-900 mr-3">Edit</button>
                              <button onClick={() => toggleActive(s)}
                                className="text-xs text-slate-400 hover:text-slate-900">
                                {s.active ? 'Deactivate' : 'Reactivate'}
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function Nav({ active, me }) {
  const link = (href, text) => (
    <a href={href} className={active === text.toLowerCase()
      ? 'text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-900'}>{text}</a>
  );
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
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