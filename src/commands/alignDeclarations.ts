import * as vscode from "vscode";
import { padRight } from "../utils/text";

type ParsedDecl = {
  indent: string;
  typePart: string;
  ranges: string[];
  namePart: string;
  suffix: string;
  original: string;
};

function parseDeclarationLine(line: string): ParsedDecl | null {
  if (/^\s*$/.test(line)) {
    return null;
  }
  if (/^\s*\/\//.test(line)) {
    return null;
  }

  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";

  const trimmed = line.trim();

  const semicolonMatch = trimmed.match(/;(\s*\/\/.*)?$/);
  if (!semicolonMatch) {
    return null;
  }

  const suffix = semicolonMatch[0];
  const body = trimmed.slice(0, trimmed.length - suffix.length).trim();

  const nameMatch = body.match(/([A-Za-z_]\w*)$/);
  if (!nameMatch) {
    return null;
  }

  const namePart = nameMatch[1];
  const beforeName = body.slice(0, body.length - namePart.length).trim();

  const ranges = beforeName.match(/\[[^\]]+\]/g) || [];
  const typePart = beforeName.replace(/\[[^\]]+\]/g, "").trim();

  if (!typePart) {
    return null;
  }

  return {
    indent,
    typePart,
    ranges,
    namePart,
    suffix,
    original: line,
  };
}

function alignDeclarationBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const parsed = lines.map(parseDeclarationLine);

  const validDecls = parsed.filter((x): x is ParsedDecl => x !== null);

  if (validDecls.length === 0) {
    return text;
  }

  const typeWidth = Math.max(...validDecls.map((x) => x.typePart.length));
  const maxDims = Math.max(...validDecls.map((x) => x.ranges.length));

  // 每一维单独算宽度：第1维、第2维、第3维...
  const dimWidths = Array(maxDims).fill(0);

  for (const item of validDecls) {
    item.ranges.forEach((r, i) => {
      dimWidths[i] = Math.max(dimWidths[i], r.length);
    });
  }

  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const item = parsed[i];
    if (!item) {
      output.push(lines[i]);
      continue;
    }

    const pieces: string[] = [];
    pieces.push(item.indent);
    pieces.push(padRight(item.typePart, typeWidth));
    pieces.push(" ");

    // 每个 [] 单独占一列
    for (let d = 0; d < maxDims; d++) {
      const r = item.ranges[d] || "";
      pieces.push(padRight(r, dimWidths[d]));

      // 最后一维后面再补两个空格接变量名
      if (d !== maxDims - 1) {
        pieces.push(" ");
      } else {
        pieces.push(" ");
      }
    }

    pieces.push(item.namePart);
    pieces.push(item.suffix);

    output.push(pieces.join(""));
  }

  return output.join("\n");
}

export async function alignDeclarationsCommand(
  editor: vscode.TextEditor
): Promise<void> {
  const document = editor.document;
  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showInformationMessage(
      "SoCBuilder: Please select lines to align."
    );
    return;
  }

  const selectedText = document.getText(selection);
  const alignedText = alignDeclarationBlock(selectedText);

  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, alignedText);
  });
}