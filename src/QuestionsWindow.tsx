import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Clarification, { type Question } from "./Clarification";
import WindowControls from "./WindowControls";

export type QuestionsSnapshot = {
  conversationId: string;
  roundId: string;
  pending: { questions: Question[]; answers: string[] };
  busy: boolean;
  error: string;
};
export type QuestionAction = {
  conversationId: string;
  roundId: string;
  action: "answers" | "submit" | "discard" | "stop";
  answers: string[];
};
export default function QuestionsWindow() {
  const [snapshot, setSnapshot] = useState<QuestionsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  useEffect(() => {
    let disposed = false;
    let changed = false;
    let off: (() => void) | undefined;
    void (async () => {
      off = await getCurrentWindow().listen<QuestionsSnapshot | null>(
        "questions-state",
        ({ payload }) => {
          changed = true;
          if (
            !payload ||
            payload.roundId !== latest.current?.roundId ||
            payload.busy ||
            payload.error
          )
            setSending(false);
          setSnapshot((current) =>
            payload && current?.roundId === payload.roundId
              ? {
                  ...payload,
                  pending: {
                    ...payload.pending,
                    answers: current.pending.answers,
                  },
                }
              : payload,
          );
        },
      );
      if (disposed) {
        off();
        return;
      }
      const initial = await invoke<QuestionsSnapshot | null>("get_questions");
      if (!disposed && !changed) setSnapshot(initial);
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  async function send(
    action: QuestionAction["action"],
    answers = latest.current?.pending.answers ?? [],
  ) {
    const current = latest.current;
    if (!current) return;
    setError("");
    if (action === "submit") setSending(true);
    try {
      await emitTo("main", "question-action", {
        conversationId: current.conversationId,
        roundId: current.roundId,
        action,
        answers,
      } satisfies QuestionAction);
    } catch (e) {
      setSending(false);
      setError(String(e));
    }
  }
  return (
    <div className="questions-window tool-shell">
      <header className="document-bar">
        <div
          className="window-drag"
          onMouseDown={(e) => {
            if (e.button === 0 && e.detail === 1)
              void getCurrentWindow()
                .startDragging()
                .catch((e) => setError(String(e)));
          }}
        >
          Questions
        </div>
        <WindowControls
          closeLabel="Close questions"
          hideMinimize
          onError={setError}
        />
      </header>
      {snapshot ? (
        <Clarification
          pending={snapshot.pending}
          error={error || snapshot.error}
          busy={snapshot.busy || sending}
          onAnswers={(answers) => {
            const next = {
              ...snapshot,
              pending: { ...snapshot.pending, answers },
            };
            latest.current = next;
            setSnapshot(next);
            void send("answers", answers);
          }}
          onSubmit={() => void send("submit")}
          onCancel={() => void send("discard")}
          onStop={() => void send("stop")}
        />
      ) : (
        <p className="empty-document">No pending questions.</p>
      )}
    </div>
  );
}
