import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase-config';
import { Link, Navigate } from 'react-router-dom';
import './TeacherView.css';

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
                        classes.map(c => (
                            <div key={c.id} className="class-card">
                                <h3>{c.name || c.id}</h3>
                                <p>{c.students ? c.students.length : 0} student(s)</p>
                                <Link to={`/class/${c.id}`} className="view-class-link">View Class</Link>
                            </div>
                        ))
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