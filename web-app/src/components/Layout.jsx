import React, { useState, useEffect, useRef } from 'react';
import logo from '../assets/logo.jpg';
import { useNotifications } from '../hooks/useNotifications';
import { db } from '../firebase-config';
import { doc, updateDoc } from 'firebase/firestore';

// A simple bell icon component
const BellIcon = ({ count }) => (
  <div style={{ position: 'relative', cursor: 'pointer' }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 22.0001 12 22.0001C11.6496 22.0001 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    {count > 0 && (
      <span style={{
        position: 'absolute',
        top: '-5px',
        right: '-5px',
        background: 'red',
        color: 'white',
        borderRadius: '50%',
        padding: '2px 6px',
        fontSize: '10px',
        fontWeight: 'bold',
        border: '1px solid white'
      }}>
        {count}
      </span>
    )}
  </div>
);

const Layout = ({ children, banner, title, logoutButton, user }) => {
  const { notifications, unreadCount } = useNotifications(user);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef(null);

  const handleBellClick = () => {
    setShowNotifications(!showNotifications);
    if (!showNotifications && unreadCount > 0) {
      // Mark all as read when opening
      const promises = notifications
        .filter(n => !n.read)
        .map(n => updateDoc(doc(db, 'notifications', n.id), { read: true }));
      Promise.all(promises).catch(err => console.error("Error marking notifications as read:", err));
    }
  };

  // Close dropdown if clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notificationRef]);

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        backgroundColor: 'white',
        padding: '1rem 2rem',
        borderBottom: '1px solid #dee2e6'
      }}>
        <div style={{
          maxWidth: '1280px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {banner && <img src={banner} alt="Banner" style={{ height: '40px', marginRight: '1rem' }} />}
            {title && <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '500', color: '#212529' }}>{title}</h2>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div ref={notificationRef}>
              <div onClick={handleBellClick}>
                <BellIcon count={unreadCount} />
              </div>
              {showNotifications && (
                <div style={{
                  position: 'absolute',
                  top: '60px',
                  right: '2rem',
                  width: '350px',
                  backgroundColor: 'white',
                  border: '1px solid #dee2e6',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  zIndex: 100,
                  maxHeight: '400px',
                  overflowY: 'auto'
                }}>
                  <div style={{ padding: '1rem', borderBottom: '1px solid #dee2e6' }}>
                    <h4 style={{ margin: 0 }}>Notifications</h4>
                  </div>
                  {notifications.length > 0 ? (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {notifications.map(n => (
                        <li key={n.id} style={{
                          padding: '1rem',
                          borderBottom: '1px solid #f1f1f1',
                          backgroundColor: n.read ? 'white' : '#e9f5ff'
                        }}>
                          <p style={{ margin: 0, fontSize: '0.9rem' }}>{n.message}</p>
                          <small style={{ color: '#6c757d' }}>
                            {n.createdAt?.toDate().toLocaleString()}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ padding: '1rem', textAlign: 'center', color: '#6c757d' }}>No notifications yet.</p>
                  )}
                </div>
              )}
            </div>
            <img src={logo} alt="Gemini AI Classroom Assistant Logo" style={{ height: '40px' }} />
            <h1 style={{ fontSize: '1.2rem', margin: 0 }}>Gemini AI Classroom Assistant</h1>
            {logoutButton}
          </div>
        </div>
      </header>
      <main style={{
        width: '100%',
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '2rem',
        flex: 1
      }}>
        {children}
      </main>
      <footer style={{
        backgroundColor: 'white',
        padding: '1rem 2rem',
        borderTop: '1px solid #dee2e6',
        textAlign: 'center'
      }}>
        <p>Developed by <a href="https://hkiit.edu.hk/en/programmes/it114115-higher-diploma-in-cloud-and-data-centre-administration/index.html" target="_blank" rel="noopener noreferrer">Higher Diploma in Cloud and Data Centre Administration</a></p>
      </footer>
    </div>
  );
};

export default Layout;