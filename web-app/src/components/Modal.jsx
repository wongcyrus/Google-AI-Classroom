import React, { useId } from 'react';
import NativeDialog from './NativeDialog';

const Modal = ({ show, onClose, title, footer = null, hideDefaultFooter = false, children, contentStyle = {}, className = '' }) => {
    const titleId = useId();
    if (!show) return null;
    return (
        <NativeDialog
            isOpen={show}
            onClose={onClose}
            ariaLabelledBy={title ? titleId : undefined}
            ariaLabel={title ? undefined : 'Dialog'}
        >
            <div 
                className={className}
                style={{ 
                    backgroundColor: 'var(--color-surface, #ffffff)', 
                    padding: '1.75rem', 
                    borderRadius: 'var(--radius-lg, 14px)', 
                    border: '1px solid var(--color-border, #e2e8f0)',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                    width: '60vw', 
                    minWidth: 'min(500px, 90vw)', 
                    maxWidth: '90vw', 
                    height: '75dvh', 
                    maxHeight: '90dvh', 
                    display: 'flex', 
                    flexDirection: 'column',
                    ...contentStyle
                }} 
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
                    <h2 id={titleId} style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text-main, #0f172a)' }}>{title}</h2>
                    <button 
                        type="button"
                        onClick={onClose} 
                        aria-label="Close"
                        style={{ 
                            background: 'transparent', 
                            border: 'none', 
                            color: 'var(--color-text-muted, #64748b)', 
                            fontSize: '1.25rem', 
                            cursor: 'pointer',
                            padding: '0.25rem 0.5rem',
                            minBlockSize: '28px',
                            minInlineSize: '28px',
                            borderRadius: '4px',
                            lineHeight: 1
                        }}
                    >
                        <span aria-hidden="true">✕</span>
                    </button>
                </div>
                
                <div style={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {children}
                </div>
                
                {(footer || !hideDefaultFooter) && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border, #e2e8f0)', flexShrink: 0 }}>
                        {footer ? footer : (
                            <button type="button" onClick={onClose} className="secondary-btn" style={{ width: 'auto' }}>
                                Close
                            </button>
                        )}
                    </div>
                )}
            </div>
        </NativeDialog>
    );
};

export default Modal;
