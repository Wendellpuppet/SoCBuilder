import * as vscode from "vscode";

type ParsedDecl = {
  indent: string;
  typePart: string;
  rangePart: string;
  namePart: string;
  suffix: string;
  original: string;
};

function parseDeclarationLine(line: string): ParsedDecl | null {
  // 保留空行和纯注释行不处理
  if (/^\s*$/.test(line)) {
    return null;
  }
  if (/^\s*\/\//.test(line)) {
    return null;
  }

  // 只处理最基础的单变量声明:
  // logic a;
  // logic [7:0] a;
  // logic signed [7:0] a;
  // wire a;
  // reg [3:0] data;
  //
  // 暂不处理:
  // logic a, b;
  // logic a = 1'b0;
  // typedef / struct / enum
  // 复杂数组维度 / packed+unpacked 混合

  const regex =
    /^(\s*)(.+?)(\s+(\[[^\]]+\]))?(\s+)([A-Za-z_]\w*)(\s*;(\s*\/\/.*)?)$/;

  const match = line.match(regex);
  if (!match) {
    return null;
  }

  const indent = match[1] ?? "";
  const fullType = (match[2] ?? "").trim();
  const rangeWithSpace = match[3] ?? "";
  const rangePart = rangeWithSpace.trim();
  const namePart = match[6] ?? "";
  const suffix = match[7] ?? ";";

  return {
    indent,
    typePart: fullType,
    rangePart,
    namePart,
    suffix,
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

  const validDecls = parsed.filter((x): x is ParsedDecl => x !== null);

  if (validDecls.length === 0) {
    return text;
  }

  const typeWidth = Math.max(...validDecls.map((x) => x.typePart.length));
  const rangeWidth = Math.max(...validDecls.map((x) => x.rangePart.length));

  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const item = parsed[i];
    if (!item) {
      output.push(lines[i]);
      continue;
    }

    const typeCol = padRight(item.typePart, typeWidth);
    const rangeCol =
      rangeWidth > 0 ? padRight(item.rangePart, rangeWidth) : item.rangePart;

    const pieces = [item.indent, typeCol];

    // type 后面至少 2 空格
    pieces.push("  ");

    if (rangeWidth > 0) {
      pieces.push(rangeCol);
      pieces.push("  ");
    }

    pieces.push(item.namePart);
    pieces.push(item.suffix);

    output.push(pieces.join(""));
  }

  return output.join("\n");
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