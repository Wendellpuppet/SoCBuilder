import * as vscode from "vscode";
import { alignDeclarationsCommand } from "./commands/alignDeclarations";

export function activate(context: vscode.ExtensionContext) {
  const alignDeclarationsDisposable = vscode.commands.registerTextEditorCommand(
    "socBuilder.alignDeclarations",
    alignDeclarationsCommand
  );

  context.subscriptions.push(alignDeclarationsDisposable);
}

export function deactivate() {}