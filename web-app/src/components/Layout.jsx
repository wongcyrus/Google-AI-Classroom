
import React from 'react';

const Layout = ({ children }) => {
  return (
    <div style={{
      maxWidth: '1280px',
      margin: '0 auto',
      padding: '2rem',
      textAlign: 'center'
    }}>
      {children}
    </div>
  );
};

export default Layout;
