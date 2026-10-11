import React, { useEffect, useRef } from "react";

export function Modal({
  children,
  onClose,
  busy,
}: {
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const pending = useRef(busy);
  pending.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    const main = document.querySelector("main"),
      sidebar = document.querySelector(".sidebar");
    if (main instanceof HTMLElement) main.inert = true;
    if (sidebar instanceof HTMLElement) sidebar.inert = true;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length);
    (
      focusable().find(
        (e) => e.tagName === "INPUT" || e.tagName === "SELECT",
      ) || dialog
    ).focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending.current) {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const elements = focusable(),
          first = elements[0],
          last = elements.at(-1);
        if (!first) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (main instanceof HTMLElement) main.inert = false;
      if (sidebar instanceof HTMLElement) sidebar.inert = false;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="overlay modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-heading"
        tabIndex={-1}
        ref={ref}
      >
        {children}
      </div>
    </div>
  );
}
