import * as vscode from "vscode";
import { alignDeclarationsCommand } from "./commands/alignDeclarations";
import { instantiateModuleByNameCommand } from "./commands/instantiateModuleByName";
import { updateInstantiationCommand } from "./commands/updateInstantiation";
import { declareSignalsCommand } from "./commands/declareSignals";

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

  const updateInstantiationDisposable =
    vscode.commands.registerTextEditorCommand(
      "socBuilder.updateInstantiation",
      updateInstantiationCommand
    );

  const declareSignalsDisposable =
    vscode.commands.registerTextEditorCommand(
      "socBuilder.declareSignals",
      declareSignalsCommand
    );

  context.subscriptions.push(
    alignDeclarationsDisposable,
    instantiateModuleByNameDisposable,
    updateInstantiationDisposable,
    declareSignalsDisposable
  );
}

export function deactivate() {}