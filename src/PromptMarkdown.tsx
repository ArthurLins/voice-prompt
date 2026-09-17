import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function PromptMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown-content">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children }) => (
            <span className="document-link">{children}</span>
          ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
