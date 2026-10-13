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
    const viewport = window.visualViewport;
    const overlay = dialog.parentElement!;
    const fitViewport = () => {
      overlay.style.height = `${viewport?.height ?? window.innerHeight}px`;
      overlay.style.top = `${viewport?.offsetTop ?? 0}px`;
    };
    fitViewport();
    viewport?.addEventListener("resize", fitViewport);
    viewport?.addEventListener("scroll", fitViewport);
    window.addEventListener("resize", fitViewport);
    const scrollY = window.scrollY;
    const bodyStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
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
      viewport?.removeEventListener("resize", fitViewport);
      viewport?.removeEventListener("scroll", fitViewport);
      window.removeEventListener("resize", fitViewport);
      document.removeEventListener("keydown", handler);
      if (main instanceof HTMLElement) main.inert = false;
      if (sidebar instanceof HTMLElement) sidebar.inert = false;
      Object.assign(document.body.style, bodyStyle);
      window.scrollTo(0, scrollY);
      previous?.focus({ preventScroll: true });
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
