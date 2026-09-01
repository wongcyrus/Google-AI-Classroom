import React, { useState } from 'react';

const INITIAL_VISIBLE_COUNT = 3;
const PAGE_SIZE = 4;

const AlertsWidget = ({ recentIrregularities = [], ipAddress = '' }) => {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  const totalAlerts = recentIrregularities.length;
  const displayedAlerts = recentIrregularities.slice(0, visibleCount);
  const hasMore = totalAlerts > visibleCount;

  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, totalAlerts));
  };

  const handleCollapse = () => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    if (typeof ts.toDate === 'function') {
      return ts.toDate().toLocaleString();
    }
    if (ts instanceof Date) {
      return ts.toLocaleString();
    }
    if (typeof ts === 'number' || typeof ts === 'string') {
      return new Date(ts).toLocaleString();
    }
    return '';
  };

  return (
    <div className="alerts-widget">
      <div className="alerts-widget-header">
        <h2>My Recent Alerts</h2>
        {totalAlerts > 0 && (
          <span className="alerts-count-badge">
            {totalAlerts} {totalAlerts === 1 ? 'alert' : 'alerts'}
          </span>
        )}
      </div>

      <div className="alert-list-container">
        <div className="alert-list">
          {totalAlerts > 0 ? (
            displayedAlerts.map(item => {
              const title = item.title || item.type || item.description || 'Irregularity Detected';
              const description = item.description && item.description !== title ? item.description : null;

              return (
                <div key={item.id} className={`alert-item ${item.severity ? `severity-${item.severity}` : ''}`}>
                  <div className="alert-item-header">
                    <p className="alert-title">{title}</p>
                    {item.severity && (
                      <span className={`severity-tag ${item.severity}`}>
                        {item.severity}
                      </span>
                    )}
                  </div>
                  {description && (
                    <p className="alert-desc">{description}</p>
                  )}
                  <span className="alert-time">{formatTimestamp(item.timestamp)}</span>
                </div>
              );
            })
          ) : (
            <p className="no-alerts-msg">You have no recent alerts.</p>
          )}
        </div>

        {/* Dynamic Pagination Controls */}
        {totalAlerts > INITIAL_VISIBLE_COUNT && (
          <div className="alerts-pagination-actions">
            {hasMore ? (
              <button
                type="button"
                className="alerts-load-more-btn"
                onClick={handleLoadMore}
              >
                ▼ Load More ({totalAlerts - visibleCount} remaining)
              </button>
            ) : (
              <button
                type="button"
                className="alerts-collapse-btn"
                onClick={handleCollapse}
              >
                ▲ Show Fewer Alerts
              </button>
            )}
          </div>
        )}
      </div>

      <p className="ip-address-footer">
        IP Address: {ipAddress || 'Fetching...'}
      </p>
    </div>
  );
};

export default AlertsWidget;
