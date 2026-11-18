import React, { useEffect, useRef } from 'react';

/**
 * Native <dialog> modal wrapper following modern-web-guidance:
 * - Uses top-layer showModal() (no role="dialog" / aria-modal / manual focus trap)
 * - Uses closedby="any" (or "none" when canDismiss=false) + pointerdown/pointerup fallback for Safari
 * - Syncs native `close` and `cancel` events back to React state
 */
export default function NativeModalDialog({
  open,
  onClose,
  canDismiss = true,
  ariaLabel,
  ariaLabelledBy,
  className = '',
  style,
  children,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
      }
    } else if (dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    const handleCancel = (e) => {
      if (!canDismiss) {
        e.preventDefault();
        return;
      }
      onClose?.();
    };

    const handleNativeClose = () => {
      if (open) {
        onClose?.();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleNativeClose);

    // Fallback for browsers without <dialog closedby="any"> (e.g. Safari)
    let cleanupPointer = null;
    if (canDismiss && !('closedBy' in HTMLDialogElement.prototype)) {
      const outside = (e) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      const onPointerDown = (e) => {
        pressedOutside = outside(e);
      };
      const onPointerUp = (e) => {
        if (pressedOutside && outside(e)) {
          if (typeof dialog.close === 'function') {
            dialog.close();
          } else {
            onClose?.();
          }
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      cleanupPointer = () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleNativeClose);
      cleanupPointer?.();
    };
  }, [open, canDismiss, onClose]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`native-modal-dialog ${className}`.trim()}
      style={style}
      closedby={canDismiss ? 'any' : 'none'}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {children}
    </dialog>
  );
}
