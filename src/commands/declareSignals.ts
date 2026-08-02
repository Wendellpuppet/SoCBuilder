import * as vscode from "vscode";

const SV_KEYWORDS = new Set([
  "assign",
  "always",
  "always_comb",
  "always_ff",
  "always_latch",
  "if",
  "else",
  "case",
  "casex",
  "casez",
  "endcase",
  "for",
  "while",
  "repeat",
  "forever",
  "begin",
  "end",
  "posedge",
  "negedge",
  "or",
  "and",
  "not",
  "module",
  "endmodule",
  "input",
  "output",
  "inout",
  "wire",
  "reg",
  "logic",
  "parameter",
  "localparam",
  "function",
  "endfunction",
  "task",
  "endtask",
  "generate",
  "endgenerate",
  "genvar",
  "default",
  "unique",
  "priority",
  "disable",
  "fork",
  "join",
  "join_any",
  "join_none",
  "return",
  "void",
  "signed",
  "unsigned",
  "typedef",
  "struct",
  "union",
  "enum",
  "packed",
  "unpacked",
  "inside",
  "with",
  "matches",
  "rand",
  "randc",
  "const",
  "static",
  "automatic",
  "virtual",
  "interface",
  "endinterface",
  "modport",
  "clocking",
  "endclocking",
  "property",
  "endproperty",
  "sequence",
  "endsequence",
  "assert",
  "assume",
  "cover",
  "restrict",
  "let"
]);

type DeclKind = "wire" | "reg";
type DeclStyle = "verilog" | "systemverilog";

type SignalInfo = {
  kind: DeclKind;
  ranges: string[];
};

type MissingSignal = {
  name: string;
  kind: DeclKind;
  ranges: string[];
};

function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, "").trim();
}

function stripSystemVerilogLiterals(text: string): string {
  return text
    .replace(/"([^"\\]|\\.)*"/g, " ")
    .replace(/\b\d*'[sS]?[bBoOdDhH]\s*[0-9a-fA-F_xXzZ?]+\b/g, " ")
    .replace(/\b\d+(?:_\d+)*\b/g, " ");
}

function extractIdentifiers(text: string): string[] {
  const cleaned = stripSystemVerilogLiterals(text);
  const ids: string[] = [];

  for (const match of cleaned.matchAll(/\b[A-Za-z_]\w*\b/g)) {
    const id = match[0];
    const index = match.index ?? 0;
    const prevChar = cleaned[index - 1] ?? "";
    const nextChar = cleaned[index + id.length] ?? "";
    const prevTwo = cleaned.slice(Math.max(0, index - 2), index);
    const nextTwo = cleaned.slice(index + id.length, index + id.length + 2);
    const after = cleaned.slice(index + id.length);

    if (prevChar === "$" || prevChar === "." || nextChar === ".") continue;
    if (prevTwo === "::" || nextTwo === "::") continue;
    if (/^\s*\(/.test(after)) continue;

    ids.push(id);
  }

  return ids;
}

function isValidSignalIdentifier(id: string): boolean {
  if (!/^[A-Za-z_]\w*$/.test(id)) {
    return false;
  }

  if (SV_KEYWORDS.has(id)) {
    return false;
  }

  if (id.startsWith("$")) {
    return false;
  }

  return true;
}

function extractRangesFromText(text: string): string[] {
  return text.match(/\[[^\]]+\]/g) || [];
}

function stripTrailingTerminator(line: string): string {
  return line.replace(/[;,]\s*$/, "").trim();
}

function extractBaseSignalName(text: string): string | null {
  const match = text.trim().match(/^([A-Za-z_]\w*)/);
  return match ? match[1] : null;
}

function findDeclaredSignals(documentText: string): Map<string, SignalInfo> {
  const declared = new Map<string, SignalInfo>();

  for (const rawLine of documentText.split(/\r?\n/)) {
    let line = stripComments(rawLine);
    if (!line) continue;

    // 1) parameter / localparam 也算“已知名字”，但不作为内部信号候选
    if (/^(parameter|localparam)\b/.test(line)) {
      line = stripTrailingTerminator(line);

      const keywordMatch = line.match(/^(parameter|localparam)\s+/);
      if (!keywordMatch) continue;

      const keyword = keywordMatch[1];
      const afterKeyword = line.slice(keyword.length).trim();
      const ranges = extractRangesFromText(afterKeyword);

      const noTypeMatch = afterKeyword.match(/^([A-Za-z_]\w*)\s*(=\s*.+)?$/);
      if (noTypeMatch) {
        declared.set(noTypeMatch[1], { kind: "wire", ranges });
        continue;
      }

      const typedMatch = afterKeyword.match(
        /^(.+?)\s+([A-Za-z_]\w*)\s*(=\s*.+)?$/
      );
      if (typedMatch) {
        declared.set(typedMatch[2], { kind: "wire", ranges });
        continue;
      }
    }

    // 2) 内部声明
    // wire a;
    // reg [7:0] b;
    // logic [3:0] c;
    const internalDeclLine = stripTrailingTerminator(line);
    let m = internalDeclLine.match(
      /^(wire|reg|logic)\b(.*?)\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*$/
    );
    if (m) {
      const declToken = m[1];
      const middle = m[2] ?? "";
      const names = m[3].split(",").map((x) => x.trim());
      const ranges = extractRangesFromText(middle);

      const kind: DeclKind = declToken === "reg" ? "reg" : "wire";

      for (const name of names) {
        declared.set(name, { kind, ranges });
      }
      continue;
    }

    // 3) 端口声明
    // input a;
    // output logic [7:0] b;
    // input a, b;
    const portDeclLine = stripTrailingTerminator(line);
    m = portDeclLine.match(/^(input|output|inout)\s+(.+?)\s*$/);
    if (m) {
      const rest = m[2].trim();

      // 无类型
      if (/^[A-Za-z_]\w*(\s*,\s*[A-Za-z_]\w*)*$/.test(rest)) {
        const names = rest.split(",").map((x) => x.trim());
        for (const name of names) {
          declared.set(name, { kind: "wire", ranges: [] });
        }
        continue;
      }

      // 有类型
      const typedMatch = rest.match(
        /^(.+?)\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)$/
      );
      if (typedMatch) {
        const typeText = typedMatch[1].trim();
        const names = typedMatch[2].split(",").map((x) => x.trim());
        const ranges = extractRangesFromText(typeText);

        for (const name of names) {
          declared.set(name, { kind: "wire", ranges });
        }
      }
    }
  }

  return declared;
}

function tryInferRangesFromSimpleRhs(
  rhs: string,
  declared: Map<string, SignalInfo>
): string[] {
  const trimmed = rhs.trim();

  // 只支持最简单情况：rhs 是一个单独标识符
  if (!/^[A-Za-z_]\w*$/.test(trimmed)) {
    return [];
  }

  const info = declared.get(trimmed);
  return info ? info.ranges : [];
}

function addIdentifiersAsCandidates(
  text: string,
  kind: DeclKind,
  declared: Map<string, SignalInfo>,
  addCandidate: (name: string, kind: DeclKind, ranges: string[]) => void,
  ranges: string[] = []
): void {
  const ids = extractIdentifiers(text);
  for (const id of ids) {
    if (!isValidSignalIdentifier(id)) continue;
    if (declared.has(id)) continue;
    addCandidate(id, kind, ranges);
  }
}

function isOutputPortName(portName: string): boolean {
  return /_o$/.test(portName);
}

function getPortInfoFromComment(line: string): { direction: string; ranges: string[] } | null {
  const commentMatch = line.match(/\/\/(.*)$/);
  if (!commentMatch) {
    return null;
  }

  const comment = commentMatch[1];
  const directionMatch = comment.match(/\b(input|output|inout)\b/i);
  if (!directionMatch) {
    return null;
  }

  return {
    direction: directionMatch[1].toLowerCase(),
    ranges: extractRangesFromText(comment),
  };
}

function isOutputPortConnection(line: string, portName: string): boolean {
  const portInfo = getPortInfoFromComment(line);
  if (portInfo) {
    return portInfo.direction === "output";
  }

  return isOutputPortName(portName);
}

function getPortConnectionRanges(line: string): string[] {
  return getPortInfoFromComment(line)?.ranges ?? [];
}

function scanNamedPortConnections(
  line: string,
  declared: Map<string, SignalInfo>,
  addCandidate: (name: string, kind: DeclKind, ranges: string[]) => void
): void {
  const connectionPattern = /(^|[\s,(])\.(\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = connectionPattern.exec(line)) !== null) {
    const portName = match[2];
    const expression = match[3].trim();
    if (!isOutputPortConnection(line, portName)) continue;
    if (!expression) {
      addCandidate(portName, "wire", getPortConnectionRanges(line));
      continue;
    }

    addIdentifiersAsCandidates(
      expression,
      "wire",
      declared,
      addCandidate,
      getPortConnectionRanges(line)
    );
  }

  const shorthandPattern = /(^|[\s,(])\.(\w+)\b(?!\s*\()/g;
  while ((match = shorthandPattern.exec(line)) !== null) {
    const portName = match[2];
    if (!isOutputPortConnection(line, portName)) continue;

    addCandidate(portName, "wire", getPortConnectionRanges(line));
  }
}

function makeDeclarationLine(sig: MissingSignal, style: DeclStyle): string {
  const rangeText = sig.ranges.length > 0 ? " " + sig.ranges.join(" ") : "";
  const keyword = style === "systemverilog" ? "logic" : sig.kind;
  return `${keyword}${rangeText} ${sig.name};`;
}

function findMissingSignals(documentText: string): MissingSignal[] {
  const declared = findDeclaredSignals(documentText);

  // 先收集候选，再做合并去重
  const candidates = new Map<string, MissingSignal>();

  const lines = documentText.split(/\r?\n/);

  let inAlwaysBlock = false;
  let beginDepth = 0;
  let currentAlwaysKind: DeclKind = "wire";

  const addCandidate = (name: string, kind: DeclKind, ranges: string[]) => {
    if (!isValidSignalIdentifier(name)) return;
    if (declared.has(name)) return;

    const existing = candidates.get(name);
    if (!existing) {
      candidates.set(name, { name, kind, ranges });
      return;
    }

    // reg 优先于 wire
    const mergedKind: DeclKind =
      existing.kind === "reg" || kind === "reg" ? "reg" : "wire";

    // 有位宽优先于无位宽
    const mergedRanges =
      existing.ranges.length > 0 ? existing.ranges : ranges;

    candidates.set(name, {
      name,
      kind: mergedKind,
      ranges: mergedRanges
    });
  };

  for (let rawLine of lines) {
    let line = stripComments(rawLine);
    if (!line) continue;

    // 跳过这些行
    if (
      /^(module|endmodule|input|output|inout|wire|reg|logic|parameter|localparam)\b/.test(
        line
      )
    ) {
      continue;
    }

    // assign lhs = rhs;
    if (line.startsWith("assign")) {
      const assignMatch = line.match(/^assign\s+(.+?)\s*=\s*(.+?)\s*;?$/);
      if (assignMatch) {
        const lhs = extractBaseSignalName(assignMatch[1]);
        const rhs = assignMatch[2];
        const ranges = tryInferRangesFromSimpleRhs(rhs, declared);
        if (lhs) {
          addCandidate(lhs, "wire", ranges);
        }

        // RHS 也可能有未声明简单信号
        addIdentifiersAsCandidates(rhs, "wire", declared, addCandidate);
      }
      continue;
    }

    scanNamedPortConnections(rawLine, declared, addCandidate);

    // always 起始
    if (
      line.startsWith("always_comb") ||
      line.startsWith("always_ff") ||
      line.startsWith("always_latch") ||
      line.startsWith("always ")
    ) {
      inAlwaysBlock = true;
      currentAlwaysKind = line.startsWith("always_ff") ? "reg" : "wire";

      // 去掉敏感列表，避免把 clock/reset 当成候选
      line = line.replace(/@\s*\([^)]*\)/g, "");
      // 去掉 block label
      line = line.replace(/begin\s*:\s*\w+/g, "begin");

      if (/\bbegin\b/.test(line)) {
        beginDepth += 1;
      }

      if (/\bend\b/.test(line)) {
        beginDepth -= 1;
        if (beginDepth <= 0) {
          inAlwaysBlock = false;
          beginDepth = 0;
        }
      }

      continue;
    }

    // always 内部
    if (inAlwaysBlock) {
      line = line.replace(/begin\s*:\s*\w+/g, "begin");
      scanNamedPortConnections(rawLine, declared, addCandidate);

      // lhs <= rhs; 或 lhs = rhs;
      const assignMatch = line.match(/^(.+?)\s*(<=|=)\s*(.+?)\s*;?$/);
      if (assignMatch) {
        const lhs = extractBaseSignalName(assignMatch[1]);
        const rhs = assignMatch[3];
        const ranges = tryInferRangesFromSimpleRhs(rhs, declared);
        if (lhs) {
          addCandidate(lhs, currentAlwaysKind, ranges);
        }

        addIdentifiersAsCandidates(rhs, "wire", declared, addCandidate);
      } else {
        // 非赋值行也扫一下 RHS 风格标识符
        addIdentifiersAsCandidates(line, "wire", declared, addCandidate);
      }

      if (/\bbegin\b/.test(line)) {
        beginDepth += 1;
      }

      if (/\bend\b/.test(line)) {
        beginDepth -= 1;
        if (beginDepth <= 0) {
          inAlwaysBlock = false;
          beginDepth = 0;
          currentAlwaysKind = "wire";
        }
      }
    }
  }

  return Array.from(candidates.values());
}

function findInsertPosition(document: vscode.TextDocument): vscode.Position {
  const lines = document.getText().split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (/\)\s*;/.test(lines[i])) {
      return new vscode.Position(i + 1, 0);
    }

    if (/^\s*endmodule\b/.test(lines[i])) {
      return new vscode.Position(i, 0);
    }
  }

  return new vscode.Position(0, 0);
}

export async function declareSignalsCommand(
  editor: vscode.TextEditor
): Promise<void> {
  const document = editor.document;
  const text = document.getText();

  const missingSignals = findMissingSignals(text);

  if (missingSignals.length === 0) {
    vscode.window.showInformationMessage(
      "SoCBuilder: No missing internal signals found."
    );
    return;
  }

  const pickedStyle = await vscode.window.showQuickPick(
    [
      {
        label: "SystemVerilog",
        description: "Declare all missing signals as logic",
        style: "systemverilog" as DeclStyle,
      },
      {
        label: "Verilog",
        description: "Infer wire/reg declarations",
        style: "verilog" as DeclStyle,
      },
    ],
    {
      placeHolder: "Select declaration style",
      ignoreFocusOut: true,
    }
  );

  if (!pickedStyle) {
    return;
  }

  const declLines = missingSignals.map((sig) =>
    makeDeclarationLine(sig, pickedStyle.style)
  );
  const insertText = declLines.join("\n") + "\n\n";

  const insertPos = findInsertPosition(document);

  await editor.edit((editBuilder) => {
    editBuilder.insert(insertPos, insertText);
  });

  vscode.window.showInformationMessage(
    `SoCBuilder: Declared ${missingSignals.length} internal signal(s) using ${pickedStyle.label}.`
  );
}
