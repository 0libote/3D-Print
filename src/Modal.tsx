import { createPortal } from "react-dom";
import React, { useEffect, useRef, useId } from "react";

// Count open modals so stacked dialogs (e.g. confirm over a form)
// keep the background locked until the last one closes.
let openCount = 0;

function lockBackground() {
  openCount += 1;
  if (openCount !== 1) return () => {};
  const root = document.documentElement;
  const body = document.body;
  const previous = {
    rootOverflow: root.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
  };
  // Compensate for the disappearing desktop scrollbar so the page
  // behind doesn't shift sideways when the dialog opens.
  const scrollbar = window.innerWidth - root.clientWidth;
  root.style.overflow = "hidden";
  body.style.overflow = "hidden";
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  return () => {
    openCount = Math.max(0, openCount - 1);
    if (openCount !== 0) return;
    root.style.overflow = previous.rootOverflow;
    body.style.overflow = previous.bodyOverflow;
    body.style.paddingRight = previous.bodyPaddingRight;
  };
}

export function Modal({
  children,
  onClose,
  busy,
}: {
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const pending = useRef(busy);
  pending.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    const previousDialog = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ]
      .filter((element) => element !== dialog)
      .at(-1);
    if (previousDialog) previousDialog.inert = true;
    const heading = dialog.querySelector("h2");
    if (heading) heading.id = headingId;
    const unlock = lockBackground();
    const main = document.querySelector("main"),
      sidebar = document.querySelector(".sidebar"),
      toast = document.querySelector(".toast"),
      notice = document.querySelector(".update-notice");
    if (main instanceof HTMLElement) main.inert = true;
    if (sidebar instanceof HTMLElement) sidebar.inert = true;
    if (toast instanceof HTMLElement) toast.inert = true;
    if (notice instanceof HTMLElement) notice.inert = true;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length);
    // Let phone users read the sheet before opening the software keyboard.
    const initialFocus = window.matchMedia(
      "(max-width: 780px), (max-width: 980px) and (max-height: 500px)",
    ).matches
      ? dialog
      : focusable().find(
          (e) => e.tagName === "INPUT" || e.tagName === "SELECT",
        ) || dialog;
    initialFocus.focus({ preventScroll: true });
    const handler = (e: KeyboardEvent) => {
      if (dialog.inert) return;
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
      if (previousDialog) previousDialog.inert = false;
      if (main instanceof HTMLElement && !previousDialog) main.inert = false;
      if (sidebar instanceof HTMLElement && !previousDialog)
        sidebar.inert = false;
      if (toast instanceof HTMLElement && !previousDialog) toast.inert = false;
      if (notice instanceof HTMLElement && !previousDialog)
        notice.inert = false;
      unlock();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
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
        aria-busy={busy}
        aria-labelledby={headingId}
        tabIndex={-1}
        ref={ref}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
