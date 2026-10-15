'use client';

import React from 'react';
import Icon from '../Icon.jsx';

const ICON = { warn: 'alert', danger: 'circleX', ok: 'circleCheck', info: 'info' };

export default function Banner({ tone = 'info', id, children, actions, role }) {
  return (
    <div className={`ts-banner ts-banner--${tone}`} id={id} role={role}>
      <Icon name={ICON[tone] || 'info'} />
      <div>
        {children}
        {actions ? <div className="ts-banner-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
