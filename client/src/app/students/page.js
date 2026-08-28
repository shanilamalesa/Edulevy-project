'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { balanceLabel } from '@/lib/money';

export default function StudentsPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [students, setStudents] = useState([]);
  const [balances, setBalances] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return router.push('/login');
      const meJson = await meRes.json();
      setMe(meJson.data);

      const res = await fetch('/api/students');
      const json = await res.json();
      setStudents(json.data || []);

      // The list endpoint does not return balances, so fetch each one.
      // Fine for a school-sized list; at scale the list route would
      // join the balance view instead.
      const entries = await Promise.all(
        (json.data || []).map(async (s) => {
          const b = await fetch(`/api/students/${s.id}/balance`);
          if (!b.ok) return [s.id, null];
          const bj = await b.json();
          return [s.id, bj.data];
        })
      );
      setBalances(Object.fromEntries(entries));
      setLoading(false);
    }
    load();
  }, [router]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const filtered = students.filter((s) => {
    const q = search.toLowerCase();
    return !q
      || s.full_name.toLowerCase().includes(q)
      || s.admission_no.toLowerCase().includes(q);
  });

  const tones = {
    owing:  'bg-red-50 text-red-700 border-red-200',
    paid:   'bg-green-50 text-green-700 border-green-200',
    credit: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-slate-900">{me?.tenantName || 'EduLevy'}</h1>
            <p className="text-xs text-slate-500">Signed in as {me?.role}</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/students" className="text-slate-900 font-medium">Students</a>
            <a href="/payments" className="text-slate-500 hover:text-slate-900">Payments</a>
            <button onClick={logout} className="text-slate-500 hover:text-slate-900">Sign out</button>
          </nav>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Students <span className="text-slate-400 font-normal">({filtered.length})</span>
          </h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or admission number"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-72
                       focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => {
                  const b = balances[s.id];
                  const label = balanceLabel(b?.balance_minor);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 text-slate-500 font-mono text-xs">{s.admission_no}</td>
                      <td className="px-5 py-3 text-slate-900 font-medium">{s.full_name}</td>
                      <td className="px-5 py-3 text-slate-500">{s.class_label || '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`inline-block px-2.5 py-1 rounded-md border text-xs font-medium ${tones[label.tone]}`}>
                          {label.text}
                        </span>
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