'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { balanceLabel } from '@/lib/money';

const CLASSES = ['Form 1', 'Form 2', 'Form 3', 'Form 4'];

export default function StudentsPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [students, setStudents] = useState([]);
  const [balances, setBalances] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ admissionNo: '', fullName: '', classLabel: 'Form 1' });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadStudents() {
    const res = await fetch('/api/students');
    if (!res.ok) return;
    const json = await res.json();
    const list = json.data || [];
    setStudents(list);

    const entries = await Promise.all(
      list.map(async (s) => {
        const b = await fetch(`/api/students/${s.id}/balance`);
        if (!b.ok) return [s.id, null];
        return [s.id, (await b.json()).data];
      })
    );
    setBalances(Object.fromEntries(entries));
  }

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return router.push('/login');
      setMe((await meRes.json()).data);
      await loadStudents();
      setLoading(false);
    }
    load();
  }, [router]);

  async function addStudent() {
    setError('');
    if (!form.admissionNo.trim()) return setError('Admission number is required');
    if (!form.fullName.trim()) return setError('Name is required');

    setSaving(true);
    const res = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) return setError(json.error?.message || 'Could not save');

    setForm({ admissionNo: '', fullName: '', classLabel: 'Form 1' });
    setAdding(false);
    loadStudents();
  }

  async function saveEdit() {
    setError('');
    setSaving(true);
    const res = await fetch(`/api/students/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: editing.full_name, classLabel: editing.class_label }),
    });
    setSaving(false);

    if (!res.ok) {
      const json = await res.json();
      return setError(json.error?.message || 'Could not save');
    }
    setEditing(null);
    loadStudents();
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const filtered = students.filter((s) => {
    const q = search.toLowerCase();
    return !q || s.full_name.toLowerCase().includes(q) || s.admission_no.toLowerCase().includes(q);
  });

  const tones = {
    owing:  'bg-red-50 text-red-700 border-red-200',
    paid:   'bg-green-50 text-green-700 border-green-200',
    credit: 'bg-blue-50 text-blue-700 border-blue-200',
    none:   'bg-slate-50 text-slate-500 border-slate-200',
  };

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <Nav active="students" me={me} onLogout={logout} />

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Students <span className="text-slate-400 font-normal">({filtered.length})</span>
          </h2>
          <div className="flex gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or admission number"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-64"
            />
            <button
              onClick={() => { setAdding(!adding); setError(''); }}
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {adding ? 'Cancel' : 'Add student'}
            </button>
          </div>
        </div>

        {adding && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
            <div className="grid grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Admission no.</label>
                <input
                  value={form.admissionNo}
                  placeholder="ADM-025"
                  onChange={(e) => setForm({ ...form, admissionNo: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
                <input
                  value={form.fullName}
                  placeholder="Amina Otieno"
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
                <select
                  value={form.classLabel}
                  onChange={(e) => setForm({ ...form, classLabel: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <button
                onClick={addStudent}
                disabled={saving}
                className="bg-slate-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
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

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-slate-500 text-sm">
              {students.length === 0 ? 'No students yet.' : 'No students match that search.'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Admission</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Name</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Class</th>
                  <th className="text-right font-medium text-slate-600 px-5 py-3">Balance</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => {
                  const b = balances[s.id];
                  const label = balanceLabel(b?.balance_minor, b?.charged_minor);
                  const isEditing = editing?.id === s.id;

                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 text-slate-500 font-mono text-xs">{s.admission_no}</td>

                      <td className="px-5 py-3">
                        {isEditing ? (
                          <input
                            value={editing.full_name}
                            onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                            className="px-2 py-1 border border-slate-300 rounded text-sm w-full"
                          />
                        ) : (
                          <a href={`/students/${s.id}`} className="text-slate-900 font-medium hover:underline">
                            {s.full_name}
                          </a>
                        )}
                      </td>

                      <td className="px-5 py-3">
                        {isEditing ? (
                          <select
                            value={editing.class_label || ''}
                            onChange={(e) => setEditing({ ...editing, class_label: e.target.value })}
                            className="px-2 py-1 border border-slate-300 rounded text-sm bg-white"
                          >
                            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <span className="text-slate-500">{s.class_label || '—'}</span>
                        )}
                      </td>

                      <td className="px-5 py-3 text-right">
                        <span className={`inline-block px-2.5 py-1 rounded-md border text-xs font-medium ${tones[label.tone]}`}>
                          {label.text}
                        </span>
                      </td>

                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button onClick={saveEdit} disabled={saving}
                              className="text-xs text-slate-900 font-medium mr-2">Save</button>
                            <button onClick={() => setEditing(null)}
                              className="text-xs text-slate-400">Cancel</button>
                          </>
                        ) : (
                          <button onClick={() => setEditing({ ...s })}
                            className="text-xs text-slate-400 hover:text-slate-900">Edit</button>
                        )}
                      </td>
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

function Nav({ active, me, onLogout }) {
  const link = (href, text) => (
    <a href={href}
       className={active === text.toLowerCase()
         ? 'text-slate-900 font-medium'
         : 'text-slate-500 hover:text-slate-900'}>
      {text}
    </a>
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
          {link('/payroll', 'Payroll')}
          <button onClick={onLogout} className="text-slate-500 hover:text-slate-900">Sign out</button>
        </nav>
      </div>
    </header>
  );
}