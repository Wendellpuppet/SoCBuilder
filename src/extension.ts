import * as vscode from "vscode";
import { alignDeclarationsCommand } from "./commands/alignDeclarations";
import { instantiateModuleByNameCommand } from "./commands/instantiateModuleByName";

export function activate(context: vscode.ExtensionContext) {
  const alignDeclarationsDisposable = vscode.commands.registerTextEditorCommand(
    "socBuilder.alignDeclarations",
    alignDeclarationsCommand
  );

  const instantiateModuleByNameDisposable =
    vscode.commands.registerTextEditorCommand(
      "socBuilder.instantiateModuleByName",
      instantiateModuleByNameCommand
    );

  context.subscriptions.push(
    alignDeclarationsDisposable,
    instantiateModuleByNameDisposable
  );
}

export function deactivate() {}