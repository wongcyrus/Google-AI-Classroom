
import React from 'react';

const Layout = ({ children, banner, title }) => {
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
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {banner && <img src={banner} alt="Banner" style={{ height: '40px', marginRight: '1rem' }} />}
            {title && <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '500', color: '#212529' }}>{title}</h2>}
          </div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#212529' }}>AI Invigilator</h1>
        </div>
      </header>
      <main style={{
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '2rem',
        textAlign: 'left'
      }}>
        {children}
      </main>
    </div>
  );
};

export default Layout;
