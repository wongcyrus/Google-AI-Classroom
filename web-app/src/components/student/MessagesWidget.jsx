import React, { useState } from 'react';

const INITIAL_VISIBLE_COUNT = 3;
const PAGE_SIZE = 4;

const MessagesWidget = ({ recentMessages = [] }) => {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);

  const totalMessages = recentMessages.length;
  const displayedMessages = recentMessages.slice(0, visibleCount);
  const hasMore = totalMessages > visibleCount;

  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, totalMessages));
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
    <div className="messages-widget">
      <div className="messages-widget-header">
        <h2>My Recent Messages</h2>
        {totalMessages > 0 && (
          <span className="messages-count-badge">
            {totalMessages} {totalMessages === 1 ? 'message' : 'messages'}
          </span>
        )}
      </div>

      <div className="message-list-container">
        <div className="message-list">
          {totalMessages > 0 ? (
            displayedMessages.map(item => (
              <div key={item.id} className="message-item">
                <p className="message-text">{item.message}</p>
                <span className="message-time">{formatTimestamp(item.timestamp)}</span>
              </div>
            ))
          ) : (
            <p className="no-messages-msg">You have no recent messages.</p>
          )}
        </div>

        {totalMessages > INITIAL_VISIBLE_COUNT && (
          <div className="messages-pagination-actions">
            {hasMore ? (
              <button
                type="button"
                className="messages-load-more-btn"
                onClick={handleLoadMore}
              >
                ▼ Load More ({totalMessages - visibleCount} remaining)
              </button>
            ) : (
              <button
                type="button"
                className="messages-collapse-btn"
                onClick={handleCollapse}
              >
                ▲ Show Fewer Messages
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessagesWidget;
