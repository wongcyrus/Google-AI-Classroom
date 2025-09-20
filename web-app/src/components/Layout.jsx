
import React from 'react';
import logo from '../assets/logo.jpg';

const Layout = ({ children, banner, title, logoutButton }) => {
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
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <img src={logo} alt="Gemini AI Classroom Assistant Logo" style={{ height: '40px', marginRight: '1rem' }} />
            <h1>Gemini AI Classroom Assistant</h1>
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
