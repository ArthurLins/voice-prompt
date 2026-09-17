import type { Config } from "./config";
import { LoaderCircle } from "lucide-react";
export type Question = { question: string; options: string[] };
export type QuestionResult = {
  questions: Question[];
  assistant: Record<string, unknown>;
};
export type AnsweredTurn = {
  assistant: Record<string, unknown>;
  answers: string[];
};
export type PendingQuestions = QuestionResult & {
  turns: AnsweredTurn[];
  answers: string[];
  settings: Config;
  previous: string;
  source: string;
};
export default function Clarification({
  pending,
  busy,
  error = "",
  onAnswers,
  onSubmit,
  onCancel,
  onStop,
}: {
  pending: Pick<PendingQuestions, "questions" | "answers">;
  busy: boolean;
  error?: string;
  onAnswers: (answers: string[]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onStop: () => void;
}) {
  return (
    <form
      className="clarification-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h1>Waiting for your answers</h1>
      <div className="clarification-fields">
        <p>Answer what you know. Blank fields remain open.</p>
        {pending.questions.map((q, index) => (
          <fieldset key={index} disabled={busy}>
            <legend>{q.question}</legend>
            {q.options.length > 0 && (
              <div className="clarification-options">
                {q.options.map((option, optionIndex) => (
                  <label key={optionIndex}>
                    <input
                      type="radio"
                      name={`question-${index}`}
                      checked={pending.answers[index] === option}
                      onChange={() =>
                        onAnswers(
                          pending.answers.map((a, i) =>
                            i === index ? option : a,
                          ),
                        )
                      }
                    />
                    {option}
                  </label>
                ))}
              </div>
            )}
            <textarea
              aria-label={q.question}
              placeholder={
                q.options.length ? "Or write your own answer" : "Your answer"
              }
              maxLength={2000}
              rows={2}
              value={pending.answers[index] ?? ""}
              onChange={(e) =>
                onAnswers(
                  pending.answers.map((a, i) =>
                    i === index ? e.target.value : a,
                  ),
                )
              }
            />
          </fieldset>
        ))}
      </div>
      <footer>
        <button
          type="button"
          className="quiet-button"
          onClick={busy ? onStop : onCancel}
        >
          {busy ? "Cancel" : "Discard questions"}
        </button>
        <button
          className="primary"
          title={error || undefined}
          aria-invalid={Boolean(error)}
          disabled={busy}
          type="submit"
        >
          {busy && <LoaderCircle size={14} className="spin" />}
          {busy ? "Processing…" : error ? "Try again" : "Continue"}
        </button>
      </footer>
    </form>
  );
}
