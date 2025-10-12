import usePaginatedQuery from '../hooks/useCollectionQuery';
import './SharedViews.css';

const MessagesView = ({ user, classId, startTime, endTime }) => {
  const collectionPath = user ? `teachers/${user.uid}/messages` : null;

  const { 
    data: messages, 
    loading, 
    page, 
    isLastPage, 
    fetchNextPage, 
    fetchPrevPage 
  } = usePaginatedQuery(collectionPath, { classId, startTime, endTime });

  return (
    <div className="view-container">
        <div className="view-header">
            <h2>Notifications</h2>
        </div>

        <div className="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Message</th>
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr><td colSpan="2">Loading...</td></tr>
                    ) : messages.length > 0 ? (
                        messages.map(msg => (
                            <tr key={msg.id}>
                                <td>{new Date(msg.timestamp?.toDate()).toLocaleString()}</td>
                                <td>{msg.message}</td>
                            </tr>
                        ))
                    ) : (
                        <tr><td colSpan="2">No notifications match the current filter.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
        <div className="pagination-controls">
            <button onClick={fetchPrevPage} disabled={loading || page <= 1}>
            Previous
            </button>
            <span>Page {page}</span>
            <button onClick={fetchNextPage} disabled={loading || isLastPage}>
            Next
            </button>
        </div>
    </div>
  );
};

export default MessagesView;
