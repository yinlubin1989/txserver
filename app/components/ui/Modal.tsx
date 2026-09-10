"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

export function Modal({ children, onClose, label, className = "", initialFocusRef }: {
  children: ReactNode;
  onClose: () => void;
  label: string;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const startedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    initialFocusRef?.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [initialFocusRef]);

  function isBackdrop(event: PointerEvent<HTMLDialogElement> | MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }

  function keepFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      event.currentTarget.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <dialog ref={dialogRef} aria-label={label} className={`site-modal ${className}`} onKeyDown={keepFocusInside}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onPointerDown={(event) => { startedOnBackdrop.current = isBackdrop(event); }}
    onClick={(event) => { if (startedOnBackdrop.current && isBackdrop(event)) onClose(); startedOnBackdrop.current = false; }}>
    {children}
  </dialog>;
}

export default Modal;
