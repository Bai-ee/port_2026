'use client';

// Brief Studio rail - Client card. Admin client picker (GET /api/admin/clients,
// loaded by BriefStudio). Publish / Update / Saved briefs stay disabled until a
// client is picked: without `?as=` the server would fall back to the admin's
// OWN client.

import React from 'react';
import { Users } from 'lucide-react';
import { RailCard, GLASS } from '../../components/rail-ui';
import { RailField, RailEmptyHint, railFieldStyle } from '../../invoice/rail/rail-field-controls';

export default function ClientCard({ clients, clientsLoading, clientsError, clientId, onPick, open, onToggle }) {
  const picked = clients.find((c) => c.clientId === clientId);
  return (
    <RailCard
      id="brief-rail-client-card" icon={<Users size={18} strokeWidth={2} />} title="Client"
      subtitle={picked ? (picked.companyName || picked.clientId) : clientId || 'Pick a client'} color="#2a2420" open={open} onToggle={onToggle}
    >
      <RailField label="Client">
        <select
          id="brief-rail-client-select"
          value={clientId}
          disabled={clientsLoading}
          onChange={(e) => onPick(e.target.value)}
          style={railFieldStyle.input}
        >
          <option value="">{clientsLoading ? 'Loading clients…' : 'Select a client…'}</option>
          {clientId && !picked ? <option value={clientId}>{clientId}</option> : null}
          {clients.map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.companyName || c.clientId}</option>
          ))}
        </select>
      </RailField>
      {clientsError ? <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: '#dc2626' }}>{clientsError}</span> : null}
      <RailEmptyHint>
        Publishing, updating and the saved list all act on this client. Switching clients loads that client&apos;s own draft.
      </RailEmptyHint>
    </RailCard>
  );
}
