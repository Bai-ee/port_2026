'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../AuthContext';

const cell = { padding: '8px 10px', borderBottom: '1px solid rgba(0,0,0,0.08)', textAlign: 'left', fontSize: 13, verticalAlign: 'top' };

export default function RecordsWaitlistAdminPage() {
  const { user, isAdmin, adminReady } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const authed = useCallback(async (suffix = '') => {
    const token = await user.getIdToken();
    return fetch(`/api/admin/records-waitlist${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
  }, [user]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    authed().then(async (r) => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Failed to load.');
      setRows(b.rows);
    }).catch((e) => setError(e.message));
  }, [user, isAdmin, authed]);

  const downloadCsv = async () => {
    const r = await authed('?format=csv');
    if (!r.ok) { setError('CSV download failed.'); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url; a.download = 'records-waitlist.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  let body;
  if (!user) body = <p>Sign in as an admin to view the waitlist.</p>;
  else if (!adminReady) body = <p>Checking access.</p>;
  else if (!isAdmin) body = <p>Admin access required.</p>;
  else if (error) body = <p role="alert">{error}</p>;
  else if (!rows) body = <p>Loading.</p>;
  else body = (
    <>
      <div id="records-waitlist-admin-header-row" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <strong id="records-waitlist-admin-count">{rows.length} on the waitlist</strong>
        <button type="button" onClick={downloadCsv} style={{ padding: '8px 14px', cursor: 'pointer' }}>Download CSV</button>
      </div>
      <div id="records-waitlist-admin-table-container" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead><tr>{['Email', 'Name', 'Role', 'Collection', 'Discogs', 'Note', 'Joined'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{r.email}</td><td style={cell}>{r.name}</td><td style={cell}>{r.role}</td>
                <td style={cell}>{r.collectionSize}</td><td style={cell}>{r.discogsUsername}</td>
                <td style={{ ...cell, maxWidth: 280, overflowWrap: 'anywhere' }}>{r.note}</td>
                <td style={cell}>{(r.createdAt || '').slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <main id="records-waitlist-admin-shell" style={{ padding: '2rem clamp(1rem,4vw,3rem)', fontFamily: '"Space Grotesk", system-ui, sans-serif', minHeight: '100dvh', background: 'rgba(254,253,249,1)', color: '#1a1a1a' }}>
      <h1 style={{ fontWeight: 500, marginTop: 0 }}>Records waitlist</h1>
      {body}
    </main>
  );
}
