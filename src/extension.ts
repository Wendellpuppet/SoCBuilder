import * as vscode from "vscode";

type ParsedDecl = {
  indent: string;
  typePart: string;
  ranges: string[];
  namePart: string;
  suffix: string;
  original: string;
};

function parseDeclarationLine(line: string): ParsedDecl | null {
  if (/^\s*$/.test(line)) return null;
  if (/^\s*\/\//.test(line)) return null;

  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";

  // 提取所有维度 []
  const ranges = line.match(/\[[^\]]+\]/g) || [];

  // 去掉 [] 后再解析 type 和 name
  const lineWithoutRanges = line.replace(/\[[^\]]+\]/g, "").trim();

  const parts = lineWithoutRanges.split(/\s+/);

  if (parts.length < 2) return null;

  const namePart = parts.pop()!.replace(";", "");
  const typePart = parts.join(" ");

  return {
    indent,
    typePart,
    ranges,
    namePart,
    suffix: ";",
    original: line,
  };
}

function padRight(text: string, width: number): string {
  if (text.length >= width) {
    return text;
  }
  return text + " ".repeat(width - text.length);
}

function alignDeclarationBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const parsed = lines.map(parseDeclarationLine);

  const valid = parsed.filter(x => x !== null);

  if (valid.length === 0) return text;

  const typeWidth = Math.max(...valid.map(x => x!.typePart.length));

  // 计算最多多少维
  const maxDims = Math.max(...valid.map(x => x!.ranges.length));

  // 每一列宽度
  const dimWidths = Array(maxDims).fill(0);

  for (const item of valid) {
    item!.ranges.forEach((r, i) => {
      dimWidths[i] = Math.max(dimWidths[i], r.length);
    });
  }

  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const item = parsed[i];

    if (!item) {
      result.push(lines[i]);
      continue;
    }

    let line = item.indent;

    line += padRight(item.typePart, typeWidth) + "  ";

    // 对齐每一维
    for (let d = 0; d < maxDims; d++) {
      const r = item.ranges[d] || "";
      line += padRight(r, dimWidths[d]) + "  ";
    }

    line += item.namePart + item.suffix;

    result.push(line);
  }

  return result.join("\n");
}

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerTextEditorCommand(
    "socBuilder.alignDeclarations",
    async (editor) => {
      const document = editor.document;
      const selection = editor.selection;

      if (selection.isEmpty) {
        vscode.window.showInformationMessage(
          "Please select the declaration lines to align."
        );
        return;
      }

      const selectedText = document.getText(selection);
      const alignedText = alignDeclarationBlock(selectedText);

      await editor.edit((editBuilder) => {
        editBuilder.replace(selection, alignedText);
      });
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}