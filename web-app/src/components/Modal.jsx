import React from 'react';

const Modal = ({ show, onClose, title, children }) => {
    if (!show) return null;
    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
            <div style={{ backgroundColor: '#FFF', padding: '20px 25px', borderRadius: '8px', zIndex: 1001, width: '60vw', minWidth: '600px', maxWidth: '90vw', height: '70vh', maxHeight: '90vh', display: 'flex', flexDirection: 'column'}} onClick={e => e.stopPropagation()}>
                <h2 style={{marginTop: 0}}>{title}</h2>
                <div style={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>{children}</div>
                <button onClick={onClose} style={{ marginTop: '15px', width: 'auto', alignSelf: 'flex-end', padding: '8px 16px' }}>Close</button>
            </div>
        </div>
    );
};

export default Modal;
