
import React from 'react';

const Layout = ({ children, banner }) => {
  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
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
          {banner && <img src={banner} alt="Banner" style={{ height: '50px' }} />}
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#212529' }}>AI Invigilator</h1>
        </div>
      </header>
      <main style={{
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '2rem',
        textAlign: 'center'
      }}>
        {children}
      </main>
    </div>
  );
};

export default Layout;
