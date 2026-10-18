import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, extra }: { title: ReactNode; subtitle?: ReactNode; extra?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 20, color: '#26265c' }}>{title}</h2>
        {subtitle ? (
          <div className="text-muted" style={{ marginTop: 2 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {extra ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{extra}</div> : null}
    </div>
  );
}
