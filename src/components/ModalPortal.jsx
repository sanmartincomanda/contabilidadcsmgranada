import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

let openModalCount = 0;
let previousBodyOverflow = '';
let previousBodyPaddingRight = '';

function lockPageScroll() {
    if (openModalCount === 0) {
        previousBodyOverflow = document.body.style.overflow;
        previousBodyPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        document.body.style.overflow = 'hidden';
        if (scrollbarWidth) document.body.style.paddingRight = `${scrollbarWidth}px`;
        document.documentElement.classList.add('app-modal-open');
    }
    openModalCount += 1;
}

function unlockPageScroll() {
    openModalCount = Math.max(0, openModalCount - 1);
    if (openModalCount > 0) return;
    document.body.style.overflow = previousBodyOverflow;
    document.body.style.paddingRight = previousBodyPaddingRight;
    document.documentElement.classList.remove('app-modal-open');
}

export default function ModalPortal({ children, onClose }) {
    const rootRef = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const previouslyFocused = document.activeElement;
        lockPageScroll();

        const focusTimer = window.setTimeout(() => {
            const modal = rootRef.current?.firstElementChild;
            if (!modal) return;
            if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
            if (!modal.hasAttribute('aria-modal')) modal.setAttribute('aria-modal', 'true');
            if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
            const preferredFocus = modal.querySelector('[autofocus], [data-autofocus]');
            (preferredFocus || modal).focus({ preventScroll: true });
        }, 0);

        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && onCloseRef.current) onCloseRef.current();
        };
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', handleKeyDown);
            unlockPageScroll();
            if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };
    }, []);

    if (typeof document === 'undefined') return null;
    return createPortal(<div ref={rootRef}>{children}</div>, document.body);
}
