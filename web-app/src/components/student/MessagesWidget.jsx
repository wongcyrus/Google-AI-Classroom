
import React from 'react';

const MessagesWidget = ({ recentMessages }) => {
  return (
    <div className="messages-widget">
        <h2>My Recent Messages</h2>
        <div className="message-list">
            {recentMessages.length > 0 ? (
                recentMessages.map(item => (
                    <div key={item.id} className="message-item">
                        <p className="message-text">{item.message}</p>
                        <span className="message-time">{item.timestamp ? item.timestamp.toDate().toLocaleString() : ''}</span>
                    </div>
                ))
            ) : (
                <p>You have no recent messages.</p>
            )}
        </div>
    </div>
  );
};

export default MessagesWidget;
