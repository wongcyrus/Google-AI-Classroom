
import React from 'react';

const AlertsWidget = ({ recentIrregularities, ipAddress }) => {
  return (
    <div className="alerts-widget">
        <h2>My Recent Alerts</h2>
        <div className="alert-list">
            {recentIrregularities.length > 0 ? (
                recentIrregularities.map(item => (
                    <div key={item.id} className="alert-item">
                        <p className="alert-title">{item.title}</p>
                        <span className="alert-time">{item.timestamp ? item.timestamp.toDate().toLocaleString() : ''}</span>
                    </div>
                ))
            ) : (
                <p>You have no recent alerts.</p>
            )}
        </div>
        <p style={{
            padding: '0 15px 15px',
            margin: 0,
            fontSize: '0.9rem',
            color: '#555',
            borderTop: '1px solid #e0e0e0',
            paddingTop: '15px',
            marginTop: '15px'
        }}>
            IP Address: {ipAddress || 'Fetching...'}
        </p>
    </div>
  );
};

export default AlertsWidget;
