// An interrupted stream must never become the implicit context of a new request.
export function completedContext(conversation: {
  complete: boolean;
  output: string;
  versions: { output: string }[];
}): string {
  return conversation.complete
    ? conversation.output
    : (conversation.versions.at(-1)?.output ?? "");
}
