export function padRight(text: string, width: number): string {
  if (text.length >= width) {
    return text;
  }
  return text + " ".repeat(width - text.length);
}