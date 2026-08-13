import * as vscode from "vscode";
import {
  findModuleInWorkspace,
  ModuleInfo,
  resolveSearchTarget,
} from "./instantiateModuleByName";
import {
  DeclStyle,
  findDeclaredSignals,
  makeDeclarationLine,
  MissingSignal,
} from "./declareSignals";

function getPortRanges(typePart: string): string[] {
  return typePart.match(/\[[^\]]+\]/g) || [];
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

async function pickModule(
  matches: ModuleInfo[],
  moduleName: string
): Promise<ModuleInfo | null> {
  if (matches.length === 1) {
    return matches[0];
  }

  const picked = await vscode.window.showQuickPick(
    matches.map((m) => ({
      label: m.moduleName,
      description: m.filePath,
      detail: `params: ${m.params.length}, ports: ${m.ports.length}`,
      module: m,
    })),
    {
      placeHolder: `Multiple modules named '${moduleName}' found. Select one.`,
      ignoreFocusOut: true,
    }
  );

  return picked?.module ?? null;
}

async function pickDeclarationStyle(): Promise<DeclStyle | null> {
  const pickedStyle = await vscode.window.showQuickPick(
    [
      {
        label: "SystemVerilog",
        description: "Declare module outputs as logic",
        style: "systemverilog" as DeclStyle,
      },
      {
        label: "Verilog",
        description: "Declare module outputs as wire",
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
  const searchPath = await vscode.window.showInputBox({
    prompt: "Enter search path first (workspace-relative or absolute)",
    placeHolder: "e.g. example or /path/to/rtl",
    ignoreFocusOut: true,
  });

  if (searchPath === undefined) {
    return;
  }

  const moduleName = await vscode.window.showInputBox({
    prompt: "Enter module name",
    placeHolder: "e.g. prim_fifo_async",
    ignoreFocusOut: true,
  });

  if (!moduleName) {
    return;
  }

  const searchTarget = await resolveSearchTarget(searchPath);
  if (!searchTarget) {
    vscode.window.showErrorMessage(
      `SoCBuilder: Search path '${searchPath.trim() || "."}' does not exist or is not a Verilog/SystemVerilog file. Please check the path.`
    );
    return;
  }

  const result = await findModuleInWorkspace(moduleName.trim(), searchTarget);
  if (result.scannedFileCount === 0) {
    vscode.window.showErrorMessage(
      `SoCBuilder: Search path '${searchTarget.displayPath}' is valid, but no SystemVerilog/Verilog files were found under it.`
    );
    return;
  }

  if (result.modules.length === 0) {
    vscode.window.showErrorMessage(
      `SoCBuilder: Files were found under path '${searchTarget.displayPath}', but module '${moduleName}' was not found.`
    );
    return;
  }

  const selected = await pickModule(result.modules, moduleName.trim());
  if (!selected) {
    return;
  }

  const style = await pickDeclarationStyle();
  if (!style) {
    return;
  }

  const declared = findDeclaredSignals(editor.document.getText());
  const missingOutputs: MissingSignal[] = [];
  const seen = new Set<string>();

  for (const port of selected.ports) {
    if (port.direction !== "output") {
      continue;
    }

    if (seen.has(port.name) || declared.has(port.name)) {
      continue;
    }

    seen.add(port.name);
    missingOutputs.push({
      name: port.name,
      kind: "wire",
      ranges: getPortRanges(port.typePart),
    });
  }

  if (missingOutputs.length === 0) {
    vscode.window.showInformationMessage(
      `SoCBuilder: No undeclared output signal(s) found for module '${selected.moduleName}'.`
    );
    return;
  }

  const insertText =
    missingOutputs.map((sig) => makeDeclarationLine(sig, style)).join("\n") +
    "\n\n";
  const insertPos = findInsertPosition(editor.document);

  await editor.edit((editBuilder) => {
    editBuilder.insert(insertPos, insertText);
  });

  vscode.window.showInformationMessage(
    `SoCBuilder: Declared ${missingOutputs.length} output signal(s) for module '${selected.moduleName}'.`
  );
}
