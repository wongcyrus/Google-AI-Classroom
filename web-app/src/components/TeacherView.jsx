import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase-config';
import { Link, Navigate } from 'react-router-dom';
import './TeacherView.css';

// Helper function to format bytes
const formatBytes = (bytes, decimals = 2) => {
    if (!bytes || bytes <= 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    if (i <= 0) {
        return `${Math.round(bytes)} Bytes`;
    }

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const TeacherView = ({ user }) => {
  const [classes, setClasses] = useState([]);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkRole = async () => {
        if (user) {
            const idTokenResult = await user.getIdTokenResult(true);
            setRole(idTokenResult.claims.role);
        }
    };
    checkRole();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const classesRef = collection(db, "classes");
    const qClasses = query(classesRef, where("teachers", "array-contains", user.email));
    const unsubscribeClasses = onSnapshot(qClasses, (querySnapshot) => {
      const classesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      classesData.sort((a, b) => a.id.localeCompare(b.id));
      setClasses(classesData);
      setLoading(false);
    });

    return () => unsubscribeClasses();
  }, [user]);

  if (role && role !== 'teacher') {
    return <Navigate to="/login" />;
  }

  if (loading) {
      return <div>Loading Dashboard...</div>
  }

  return (
    <div className="teacher-dashboard">
        <div className="dashboard-header">
            <h1>Teacher Dashboard</h1>
            <p>Welcome, {user.email}. Here's a summary of your classes.</p>
        </div>
        <div className="dashboard-grid">
            <div className="dashboard-widget classes-widget">
                <h2>My Classes</h2>
                <div className="class-card-list">
                    {classes.length > 0 ? (
                        classes.map(c => {
                            const usage = c.storageUsage || 0;
                            const quota = c.storageQuota || 0;
                            const percentage = quota > 0 ? (usage / quota) * 100 : 0;
                            const aiUsed = c.aiUsedQuota || 0;
                            const aiQuota = c.aiQuota || 0;
                            const aiPercentage = aiQuota > 0 ? (aiUsed / aiQuota) * 100 : 0;

                            return (
                                <div key={c.id} className="class-card">
                                    <h3>{c.name || c.id}</h3>
                                    <p>{c.students ? c.students.length : 0} student(s)</p>
                                    <div className="storage-info">
                                        <div className="progress-bar-container">
                                            <div className="progress-bar" style={{ width: `${percentage}%` }}></div>
                                        </div>
                                        <p className="storage-text">
                                            {quota > 0 ? `${formatBytes(usage)} of ${formatBytes(quota)} used` : `${formatBytes(usage)} used`}
                                        </p>
                                        <div className="storage-breakdown-summary" style={{ fontSize: '0.8em', color: '#666', textAlign: 'center' }}>
                                            <span>SS: {formatBytes(c.storageUsageScreenShots || 0)}</span> | 
                                            <span> Vids: {formatBytes(c.storageUsageVideos || 0)}</span> | 
                                            <span> Zips: {formatBytes(c.storageUsageZips || 0)}</span>
                                        </div>
                                    </div>
                                    <div className="storage-info">
                                        <label>AI Budget:</label>
                                        <div className="progress-bar-container">
                                            <div className="progress-bar" style={{ width: `${aiPercentage}%` }}></div>
                                        </div>
                                        <p className="storage-text">
                                            {`$${aiUsed.toFixed(2)} of $${aiQuota.toFixed(2)} used`}
                                        </p>
                                    </div>
                                    <Link to={`/class/${c.id}`} className="view-class-link">View Class</Link>
                                </div>
                            );
                        })
                    ) : (
                        <p>You are not enrolled in any classes.</p>
                    )}
                </div>
            </div>
        </div>
    </div>
  );
};

export default TeacherView;
