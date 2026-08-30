type Listener = (open: boolean) => void;

let openCount = 0;
const listeners = new Set<Listener>();

function emit(): void {
  const open = openCount > 0;
  listeners.forEach((listener) => listener(open));
}

export function reportHelpBusinessModal(visible: boolean): void {
  if (visible) openCount += 1;
  else openCount = Math.max(0, openCount - 1);
  emit();
}

export function subscribeHelpBusinessModal(listener: Listener): () => void {
  listeners.add(listener);
  listener(openCount > 0);
  return () => {
    listeners.delete(listener);
  };
}

export function isHelpBusinessModalOpen(): boolean {
  return openCount > 0;
}

export function resetHelpBusinessModalForTests(): void {
  openCount = 0;
  listeners.clear();
}
