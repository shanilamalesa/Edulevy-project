'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail]= useState('');
    const [password, setPassword] = useState('');
    const [tenantSlug, setTenantSlug] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState('');

async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password, tenantSlug }),
        });

        const json = await res.json();

        if (!res.ok) {
            setError(json.error?.message || 'Login failed');
            setLoading(false);
            return;
        }

        router.push('/students');
    } catch {
        setError('Could not reach the server');
        setLoading(false);
    }

}

      return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-slate-900">EduLevy</h1>
          <p className="text-sm text-slate-500 mt-1">School fee management</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">School</label>
              <input
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="Green-hills"
                autoComplete="off"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.ac.ke"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="pt-2">
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg
                           text-sm font-medium transition disabled:opacity-50"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              <p className="text-center text-sm text-slate-500 mt-6">
                  Need an account? <a href="/register" className="text-slate-900 underline">Request one</a>
            </p>
            <p className="text-center text-xs text-slate-400 mt-4">
              Newly requested accounts cannot sign in until a manager approves them.
          </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
