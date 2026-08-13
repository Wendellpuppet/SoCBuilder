import * as vscode from "vscode";
import { padRight } from "../utils/text";

type ParsedConnection = {
  indent: string;
  name: string;
  expr: string;
  comma: string;
  comment: string;
  commentInfo: ParsedCommentInfo | null;
  shorthand: boolean;
};

type ParsedCommentInfo = {
  direction: string;
  ranges: string[];
};

function parseCommentInfo(comment: string): ParsedCommentInfo | null {
  const directionMatch = comment.match(/\b(input|output|inout|I|O)\b/i);
  if (!directionMatch) {
    return null;
  }

  return {
    direction: normalizeCommentDirection(directionMatch[1]),
    ranges: comment.match(/\[[^\]]+\]/g) || [],
  };
}

function normalizeCommentDirection(direction: string): string {
  const lower = direction.toLowerCase();
  if (lower === "i" || lower === "input") return "I";
  if (lower === "o" || lower === "output") return "O";
  return lower.toUpperCase();
}

function parseConnectionLine(line: string): ParsedConnection | null {
  if (/^\s*$/.test(line) || /^\s*\/\//.test(line)) {
    return null;
  }

  const match = line.match(
    /^(\s*)\.([A-Za-z_]\w*)(?:\s*\((.*)\))?\s*(,?)(\s*\/\/.*)?$/
  );
  if (!match) {
    return null;
  }

  const rawExpr = match[3];
  const comment = match[5] ? ` ${match[5].trim()}` : "";
  const shorthand = rawExpr === undefined;

  return {
    indent: match[1],
    name: match[2],
    expr: shorthand ? match[2] : rawExpr.trim(),
    comma: match[4] ?? "",
    comment,
    commentInfo: parseCommentInfo(comment),
    shorthand,
  };
}

function buildConnectionComment(
  commentInfo: ParsedCommentInfo,
  rangeWidth: number
): string {
  const rangeText = commentInfo.ranges.join(" ");
  if (rangeWidth === 0 || !rangeText) {
    return ` // ${commentInfo.direction}`;
  }

  return ` // ${commentInfo.direction} ${padRight(rangeText, rangeWidth)}`;
}

function alignConnectionBlock(lines: string[]): string[] {
  const parsed = lines.map(parseConnectionLine);
  const validConnections = parsed.filter(
    (item): item is ParsedConnection => item !== null
  );

  if (validConnections.length === 0) {
    return lines;
  }

  const nameWidth = Math.max(...validConnections.map((item) => item.name.length));
  const exprWidth = Math.max(...validConnections.map((item) => item.expr.length));
  const commentRangeWidth = Math.max(
    0,
    ...validConnections.map((item) =>
      item.commentInfo ? item.commentInfo.ranges.join(" ").length : 0
    )
  );
  const connectionBodies = parsed.map((item) => {
    if (!item) {
      return "";
    }

    const comma = item.comma || (item.comment ? " " : "");
    return [
      item.indent,
      ".",
      padRight(item.name, nameWidth),
      "(",
      padRight(item.expr, exprWidth),
      ")",
      comma,
    ].join("");
  });
  const commentColumn = Math.max(...connectionBodies.map((body) => body.length));
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const item = parsed[i];
    if (!item) {
      output.push(lines[i]);
      continue;
    }

    const body = connectionBodies[i];
    const comment = item.commentInfo
      ? buildConnectionComment(item.commentInfo, commentRangeWidth)
      : item.comment;

    output.push(
      comment ? `${padRight(body, commentColumn)}${comment}` : body
    );
  }

  return output;
}

function hasNextConnection(lines: string[], start: number): boolean {
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*$/.test(line) || /^\s*\/\//.test(line)) {
      continue;
    }

    return parseConnectionLine(line) !== null;
  }

  return false;
}

function alignInstantiationBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!parseConnectionLine(line)) {
      output.push(line);
      i++;
      continue;
    }

    const block: string[] = [];

    while (i < lines.length) {
      const current = lines[i];
      const isConnection = parseConnectionLine(current) !== null;
      const isSeparator = /^\s*$/.test(current) || /^\s*\/\//.test(current);

      if (isConnection) {
        block.push(current);
        i++;
      } else if (isSeparator && hasNextConnection(lines, i + 1)) {
        block.push(current);
        i++;
      } else {
        break;
      }
    }

    output.push(...alignConnectionBlock(block));
  }

  return output.join("\n");
}

export async function alignInstantiationCommand(
  editor: vscode.TextEditor
): Promise<void> {
  const document = editor.document;
  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showInformationMessage(
      "SoCBuilder: Please select an instantiation block to align."
    );
    return;
  }

  const selectedText = document.getText(selection);
  const alignedText = alignInstantiationBlock(selectedText);

  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, alignedText);
  });
}
