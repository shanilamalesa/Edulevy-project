'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GuardiansPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [guardians, setGuardians] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [form, setForm] = useState({ msisdn: '', fullName: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [linkFor, setLinkFor] = useState(null);   // guardian id being linked
  const [linkStudent, setLinkStudent] = useState('');

  async function refresh() {
    const res = await fetch(`/api/guardians${search ? `?search=${encodeURIComponent(search)}` : ''}`);
    if (res.ok) setGuardians((await res.json()).data || []);
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

  useEffect(() => {
    if (loading) return;
    const t = setTimeout(async () => {
        const res = await fetch(`/api/guardians${search ? `?search={encodeURIComponent(search)}` : ''}`);
        if (res.ok) setGuardians((await res.json()).data || []);
    }, 250);
    return () =>clearTimeout(t);
  }, [search, loading]);

  async function addGuardian() {
    setError('');
    if (!form.msisdn.trim()) return setError('Phone number is required');

    setSaving(true);
    const res = await fetch('/api/guardians', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msisdn: form.msisdn.trim(), fullName: form.fullName.trim() }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) return setError(json.error?.message || 'Could not save');

    setForm({ msisdn: '', fullName: '' });
    refresh();
  }

  async function link(guardianId) {
    if (!linkStudent) return;
    const res = await fetch(`/api/guardians/${guardianId}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: linkStudent }),
    });
    if (!res.ok) {
      const json = await res.json();
      setError(json.error?.message || 'Could not link');
    }
    setLinkFor(null);
    setLinkStudent('');
    refresh();
  }

  async function unlink(guardianId, studentId) {
    await fetch(`/api/guardians/${guardianId}/students/${studentId}`, { method: 'DELETE' });
    refresh();
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <Nav active="guardians" me={me} />

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Guardians <span className="text-slate-400 font-normal">({guardians.length})</span>
            </h2>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or number"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-64"
            />
          </div>

          <p className="text-xs text-slate-500 mb-4">
            A parent can only see the children linked to their number. This is what
            USSD and WhatsApp check — there is no password on those channels.
          </p>

          {guardians.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <p className="text-slate-500 text-sm">No guardians registered yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {guardians.map((g) => (
                <div key={g.id} className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{g.full_name || 'Unnamed'}</p>
                      <p className="text-sm text-slate-500 font-mono">{g.msisdn}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {g.pin_set && (
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          PIN set
                        </span>
                      )}
                      {g.pin_locked && (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700">
                          Locked
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    {g.students?.length === 0 && (
                      <span className="text-xs text-amber-600">
                        No children linked — this number sees nothing
                      </span>
                    )}
                    {g.students?.map((s) => (
                      <span key={s.id}
                        className="inline-flex items-center gap-1.5 text-xs bg-slate-100
                                   text-slate-700 px-2 py-1 rounded">
                        {s.fullName}
                        <button
                          onClick={() => unlink(g.id, s.id)}
                          className="text-slate-400 hover:text-red-600"
                          title="Unlink"
                        >
                          ×
                        </button>
                      </span>
                    ))}

                    {linkFor === g.id ? (
                      <div className="flex gap-2 items-center">
                        <select
                          value={linkStudent}
                          onChange={(e) => setLinkStudent(e.target.value)}
                          className="text-xs px-2 py-1 border border-slate-300 rounded bg-white"
                        >
                          <option value="">Choose student…</option>
                          {students.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.admission_no} — {s.full_name}
                            </option>
                          ))}
                        </select>
                        <button onClick={() => link(g.id)}
                          className="text-xs bg-slate-900 text-white px-2 py-1 rounded">
                          Link
                        </button>
                        <button onClick={() => setLinkFor(null)}
                          className="text-xs text-slate-500">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { setLinkFor(g.id); setLinkStudent(''); }}
                        className="text-xs text-slate-500 hover:text-slate-900 underline">
                        + Link a child
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Register a guardian</h2>
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone number</label>
              <input
                value={form.msisdn}
                placeholder="0712345678"
                onChange={(e) => setForm({ ...form, msisdn: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <p className="text-xs text-slate-400 mt-1">
                Stored in international format. 0712… becomes +254712…
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
              <input
                value={form.fullName}
                placeholder="Mary Otieno"
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              onClick={addGuardian}
              disabled={saving}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg
                         text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Register'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Nav({ active, me }) {
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
        </nav>
      </div>
    </header>
  );
}