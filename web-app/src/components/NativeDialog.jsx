import React, { useEffect, useRef } from 'react';
import './NativeDialog.css';

/**
 * Reusable accessible modal dialog built on the native <dialog> element.
 * Provides top-layer rendering, inert background, focus containment & restoration,
 * Esc/back-gesture dismissal, and scroll containment, with a graceful fallback
 * for test environments (jsdom) that do not implement HTMLDialogElement.showModal().
 */
export default function NativeDialog({
  isOpen = true,
  onClose,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = '',
  style,
  ariaLabelledBy,
  ariaLabel,
  children,
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const startedInsideRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    if (isOpen) {
      if (typeof dialogEl.showModal === 'function') {
        if (!dialogEl.open) {
          dialogEl.showModal();
        }
      } else {
        dialogEl.setAttribute('open', '');
      }
    } else if (typeof dialogEl.close === 'function' && dialogEl.open) {
      dialogEl.close();
    } else {
      dialogEl.removeAttribute('open');
    }

    return () => {
      if (typeof dialogEl.close === 'function' && dialogEl.open) {
        dialogEl.close();
      } else {
        dialogEl.removeAttribute('open');
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCancel = (e) => {
    e.preventDefault();
    if (closeOnEscape) {
      onCloseRef.current?.(e);
    }
  };

  const handlePointerDown = (e) => {
    startedInsideRef.current = e.target !== dialogRef.current;
  };

  const handleClick = (e) => {
    const clickedBackdrop = e.target === dialogRef.current;
    const wasInsideDrag = startedInsideRef.current;
    startedInsideRef.current = false;
    if (closeOnBackdropClick && clickedBackdrop && !wasInsideDrag) {
      e.stopPropagation();
      onCloseRef.current?.(e);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={`native-dialog ${className}`.trim()}
      style={style}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      onCancel={handleCancel}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {children}
    </dialog>
  );
}
