import React from 'react';

const Modal = ({ show, onClose, title, children }) => {
    if (!show) return null;
    return (
        <div 
            style={{ 
                position: 'fixed', 
                top: 0, 
                left: 0, 
                right: 0, 
                bottom: 0, 
                backgroundColor: 'rgba(15, 23, 42, 0.65)', 
                backdropFilter: 'blur(4px)',
                zIndex: 1000, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                padding: '1.5rem'
            }} 
            onClick={onClose}
        >
            <div 
                style={{ 
                    backgroundColor: 'var(--color-surface, #ffffff)', 
                    padding: '1.75rem', 
                    borderRadius: 'var(--radius-lg, 14px)', 
                    border: '1px solid var(--color-border, #e2e8f0)',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                    zIndex: 1001, 
                    width: '60vw', 
                    minWidth: '500px', 
                    maxWidth: '90vw', 
                    height: '75vh', 
                    maxHeight: '90vh', 
                    display: 'flex', 
                    flexDirection: 'column'
                }} 
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
                    <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text-main, #0f172a)' }}>{title}</h2>
                    <button 
                        onClick={onClose} 
                        style={{ 
                            background: 'transparent', 
                            border: 'none', 
                            color: 'var(--color-text-muted, #64748b)', 
                            fontSize: '1.25rem', 
                            cursor: 'pointer',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            lineHeight: 1
                        }}
                    >
                        ✕
                    </button>
                </div>
                
                <div style={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {children}
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border, #e2e8f0)' }}>
                    <button onClick={onClose} className="secondary-btn" style={{ width: 'auto' }}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Modal;
