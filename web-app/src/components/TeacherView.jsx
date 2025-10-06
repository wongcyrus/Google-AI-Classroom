import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase-config';
import { Link, Navigate } from 'react-router-dom';
import './TeacherView.css';
import { formatBytes } from '../utils/formatters';

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
    const qClasses = query(classesRef, where("teacherUids", "array-contains", user.uid));
    const unsubscribeClasses = onSnapshot(qClasses, async (querySnapshot) => {
      const classesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      classesData.sort((a, b) => a.id.localeCompare(b.id));
      
      const updatedClasses = await Promise.all(classesData.map(async c => {
          const storageRef = doc(db, "classes", c.id, "metadata", "storage");
          const aiMetaRef = doc(db, "classes", c.id, "metadata", "ai");
          const [storageSnap, aiMetaSnap] = await Promise.all([
            getDoc(storageRef),
            getDoc(aiMetaRef)
          ]);

          let mergedData = { ...c };
          if (storageSnap.exists()) {
              mergedData = { ...mergedData, ...storageSnap.data() };
          }
          if (aiMetaSnap.exists()) {
              mergedData = { ...mergedData, ...aiMetaSnap.data() };
          }
          return mergedData;
      }));

      setClasses(updatedClasses);
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
                                    <p>{c.studentUids ? c.studentUids.length : 0} student(s)</p>
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
