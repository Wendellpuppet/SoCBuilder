import * as vscode from "vscode";
import {
  DeclStyle,
  findDeclaredSignals,
  makeDeclarationLine,
  MissingSignal,
} from "./declareSignals";

type PortCommentInfo = {
  direction: string;
  ranges: string[];
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRangesFromText(text: string): string[] {
  return text.match(/\[[^\]]+\]/g) || [];
}

function normalizeCommentDirection(direction: string): string {
  const lower = direction.toLowerCase();
  if (lower === "i" || lower === "input") return "input";
  if (lower === "o" || lower === "output") return "output";
  return lower;
}

function getPortInfoFromComment(line: string): PortCommentInfo | null {
  const commentMatch = line.match(/\/\/(.*)$/);
  if (!commentMatch) {
    return null;
  }

  const comment = commentMatch[1];
  const directionMatch = comment.match(/\b(input|output|inout|I|O)\b/i);
  if (!directionMatch) {
    return null;
  }

  return {
    direction: normalizeCommentDirection(directionMatch[1]),
    ranges: extractRangesFromText(comment),
  };
}

function isValidSignalIdentifier(name: string): boolean {
  return /^[A-Za-z_]\w*$/.test(name);
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1] ?? "";

    if (ch === "/" && next === "/") {
      const lineEnd = text.indexOf("\n", i + 2);
      if (lineEnd === -1) {
        return -1;
      }
      i = lineEnd;
      continue;
    }

    if (ch === "\"") {
      i++;
      while (i < text.length) {
        if (text[i] === "\\" && i + 1 < text.length) {
          i += 2;
          continue;
        }
        if (text[i] === "\"") {
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "(") {
      depth++;
      continue;
    }

    if (ch === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function findInstantiationPortBlock(
  documentText: string,
  instanceName: string
): string | null {
  const instanceRegex = new RegExp(`\\b${escapeRegExp(instanceName)}\\b\\s*\\(`, "g");
  const match = instanceRegex.exec(documentText);
  if (!match) {
    return null;
  }

  const openIndex = documentText.indexOf("(", match.index);
  if (openIndex === -1) {
    return null;
  }

  const closeIndex = findMatchingParen(documentText, openIndex);
  if (closeIndex === -1) {
    return null;
  }

  return documentText.slice(openIndex + 1, closeIndex);
}

function extractConnectedSignal(line: string): string | null {
  const namedMatch = line.match(/(^|[\s,(])\.(\w+)\s*\(\s*([^)]*?)\s*\)/);
  if (namedMatch) {
    const portName = namedMatch[2];
    const expression = namedMatch[3].trim();
    return expression || portName;
  }

  const shorthandMatch = line.match(/(^|[\s,(])\.(\w+)\b(?!\s*\()/);
  return shorthandMatch ? shorthandMatch[2] : null;
}

function findOutputSignalsFromInstantiation(
  documentText: string,
  instanceName: string
): MissingSignal[] | null {
  const portBlock = findInstantiationPortBlock(documentText, instanceName);
  if (portBlock === null) {
    return null;
  }

  const declared = findDeclaredSignals(documentText);
  const outputs: MissingSignal[] = [];
  const seen = new Set<string>();

  for (const line of portBlock.split(/\r?\n/)) {
    const portInfo = getPortInfoFromComment(line);
    if (!portInfo || portInfo.direction !== "output") {
      continue;
    }

    const signalName = extractConnectedSignal(line);
    if (!signalName || !isValidSignalIdentifier(signalName)) {
      continue;
    }

    if (seen.has(signalName) || declared.has(signalName)) {
      continue;
    }

    seen.add(signalName);
    outputs.push({
      name: signalName,
      kind: "wire",
      ranges: portInfo.ranges,
    });
  }

  return outputs;
}

async function pickDeclarationStyle(): Promise<DeclStyle | null> {
  const pickedStyle = await vscode.window.showQuickPick(
    [
      {
        label: "SystemVerilog",
        description: "Declare instance outputs as logic",
        style: "systemverilog" as DeclStyle,
      },
      {
        label: "Verilog",
        description: "Declare instance outputs as wire",
        style: "verilog" as DeclStyle,
      },
    ],
    {
      placeHolder: "Select declaration style",
      ignoreFocusOut: true,
    }
  );

  return pickedStyle?.style ?? null;
}

export async function declareModuleOutputsByNameCommand(
  editor: vscode.TextEditor
): Promise<void> {
  const instanceName = await vscode.window.showInputBox({
    prompt: "Enter instance name",
    placeHolder: "e.g. u_fifo",
    ignoreFocusOut: true,
  });

  if (!instanceName) {
    return;
  }

  const documentText = editor.document.getText();
  const missingOutputs = findOutputSignalsFromInstantiation(
    documentText,
    instanceName.trim()
  );

  if (missingOutputs === null) {
    vscode.window.showErrorMessage(
      `SoCBuilder: Instance '${instanceName.trim()}' was not found in the current document.`
    );
    return;
  }

  if (missingOutputs.length === 0) {
    vscode.window.showInformationMessage(
      `SoCBuilder: No undeclared output signal(s) found for instance '${instanceName.trim()}'.`
    );
    return;
  }

  const style = await pickDeclarationStyle();
  if (!style) {
    return;
  }

  const insertText =
    missingOutputs.map((sig) => makeDeclarationLine(sig, style)).join("\n") +
    "\n\n";

  await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, insertText);
  });

  vscode.window.showInformationMessage(
    `SoCBuilder: Declared ${missingOutputs.length} output signal(s) for instance '${instanceName.trim()}'.`
  );
}
