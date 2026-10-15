import { useRef, useState } from "react";
import { Modal } from "./Modal";

/** A promise-based decision keeps the triggering operation and its scope together. */
export function useDecision() {
  const [request, setRequest] = useState<{
    message: string;
    input: boolean;
  } | null>(null);
  const [text, setText] = useState("");
  const resolve = useRef<(value: string | null) => void>(() => {});
  function ask(message: string, input = false): Promise<string | null> {
    setText("");
    setRequest({ message, input });
    return new Promise((done) => {
      resolve.current = done;
    });
  }
  function finish(value: string | null) {
    setRequest(null);
    resolve.current(value);
  }
  return {
    confirm: async (message: string) => (await ask(message)) !== null,
    prompt: (message: string) => ask(message, true),
    decision: request && (
      <Modal busy={false} onClose={() => finish(null)}>
        <h2 id="dialog-heading">
          {request.input ? "Print failure" : "Confirm action"}
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            finish(text);
          }}
        >
          <p>{request.message}</p>
          {request.input && (
            <label className="field">
              <span>Notes</span>
              <textarea
                maxLength={2000}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="outline-button"
              onClick={() => finish(null)}
            >
              Cancel
            </button>
            <button type="submit" className="auth-submit">
              Confirm
            </button>
          </div>
        </form>
      </Modal>
    ),
  };
}
