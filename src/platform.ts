export function isMac(): boolean {
  return /Mac/i.test(navigator.platform);
}

export function commandKey(): string {
  return isMac() ? "Cmd" : "Ctrl";
}

export function commandPressed(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  return isMac() ? event.metaKey : event.ctrlKey;
}
