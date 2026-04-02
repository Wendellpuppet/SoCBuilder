import * as vscode from "vscode";
import { padRight } from "../utils/text";

type ParsedDecl = {
  indent: string;
  dirPart: string;
  typePart: string;
  ranges: string[];
  namePart: string;
  suffix: string;
  original: string;
};

type ParsedParam = {
  indent: string;
  keyword: string;
  typePart: string;
  namePart: string;
  valuePart: string;
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
  const withoutRanges = beforeName
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutRanges) {
    return null;
  }

  const tokens = withoutRanges.split(/\s+/);

  let dirPart = "";
  let typePart = "";

  if (/^(input|output|inout)$/.test(tokens[0])) {
    dirPart = tokens[0];
    typePart = tokens.slice(1).join(" "); // 允许为空，例如 input a;
  } else {
    dirPart = "";
    typePart = tokens.join(" ");
  }

  // 至少要有方向或类型
  if (!dirPart && !typePart) {
    return null;
  }

  return {
    indent,
    dirPart,
    typePart,
    ranges,
    namePart,
    suffix,
    original: line,
  };
}

function parseParameterLine(line: string): ParsedParam | null {
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

  const keywordMatch = body.match(/^(parameter|localparam)\s+/);
  if (!keywordMatch) {
    return null;
  }

  const keyword = keywordMatch[1];
  const afterKeyword = body.slice(keyword.length).trim();

  // 先匹配无类型
  const noTypeMatch = afterKeyword.match(/^([A-Za-z_]\w*)\s*(=\s*.+)?$/);
  if (noTypeMatch) {
    const namePart = noTypeMatch[1];
    const rawValuePart = noTypeMatch[2] ? noTypeMatch[2].trim() : "";
    const valuePart = rawValuePart
      ? rawValuePart.replace(/^=\s*/, "= ")
      : "";

    return {
      indent,
      keyword,
      typePart: "",
      namePart,
      valuePart,
      suffix,
      original: line,
    };
  }

  // 再匹配有类型
  const typedMatch = afterKeyword.match(
    /^(.+?)\s+([A-Za-z_]\w*)\s*(=\s*.+)?$/
  );
  if (!typedMatch) {
    return null;
  }

  const typePart = typedMatch[1].trim();
  const namePart = typedMatch[2];
  const rawValuePart = typedMatch[3] ? typedMatch[3].trim() : "";
  const valuePart = rawValuePart
    ? rawValuePart.replace(/^=\s*/, "= ")
    : "";

  return {
    indent,
    keyword,
    typePart,
    namePart,
    valuePart,
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

  const GAP = " ";

  const dirWidth = Math.max(...validDecls.map((x) => x.dirPart.length));
  const typeWidth = Math.max(...validDecls.map((x) => x.typePart.length));
  const maxDims = Math.max(...validDecls.map((x) => x.ranges.length));

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

    // dir
    if (dirWidth > 0) {
      pieces.push(padRight(item.dirPart, dirWidth));
      pieces.push(GAP);
    }

    // type
    if (typeWidth > 0) {
      pieces.push(padRight(item.typePart, typeWidth));
      pieces.push(GAP);
    }

    // ranges
    for (let d = 0; d < maxDims; d++) {
      const r = item.ranges[d] || "";
      pieces.push(padRight(r, dimWidths[d]));
      pieces.push(GAP);
    }

    // name
    pieces.push(item.namePart);
    pieces.push(item.suffix);

    output.push(pieces.join(""));
  }

  return output.join("\n");
}

function alignParameterBlock(lines: string[]): string[] {
  const parsed = lines.map(parseParameterLine);
  const validParams = parsed.filter((x): x is ParsedParam => x !== null);

  if (validParams.length === 0) {
    return lines;
  }

  const blockIndent = validParams[0].indent;
  const keywordWidth = Math.max(...validParams.map((x) => x.keyword.length));
  const typeWidth = Math.max(...validParams.map((x) => x.typePart.length));
  const nameWidth = Math.max(...validParams.map((x) => x.namePart.length));

  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const item = parsed[i];
    if (!item) {
      output.push(lines[i]);
      continue;
    }

    const pieces: string[] = [];
    pieces.push(blockIndent);
    pieces.push(padRight(item.keyword, keywordWidth));
    pieces.push(" ");

    if (typeWidth > 0) {
      pieces.push(padRight(item.typePart, typeWidth));
      pieces.push(" ");
    }

    pieces.push(padRight(item.namePart, nameWidth));

    if (item.valuePart) {
      pieces.push(" ");
      pieces.push(item.valuePart);
    }

    pieces.push(item.suffix);

    output.push(pieces.join(""));
  }

  return output;
}

function alignMixedBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const isParam = parseParameterLine(line) !== null;
    const isDecl = parseDeclarationLine(line) !== null;

    if (!isParam && !isDecl) {
      output.push(line);
      i++;
      continue;
    }

    const block: string[] = [];
    const blockType = isParam ? "param" : "decl";

    while (i < lines.length) {
      const current = lines[i];
      const currentIsParam = parseParameterLine(current) !== null;
      const currentIsDecl = parseDeclarationLine(current) !== null;

      if (
        (blockType === "param" && currentIsParam) ||
        (blockType === "decl" && currentIsDecl)
      ) {
        block.push(current);
        i++;
      } else {
        break;
      }
    }

    if (blockType === "param") {
      output.push(...alignParameterBlock(block));
    } else {
output.push(...alignDeclarationBlock(block.join("\n")).split(/\r?\n/));
    }
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
  const alignedText = alignMixedBlock(selectedText);

  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, alignedText);
  });
}