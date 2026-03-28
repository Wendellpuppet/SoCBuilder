import * as vscode from "vscode";
import { padRight } from "../utils/text";

type PortInfo = {
  direction: string;
  typePart: string;
  name: string;
};

type ParamInfo = {
  name: string;
};

type ModuleInfo = {
  moduleName: string;
  params: ParamInfo[];
  ports: PortInfo[];
  filePath: string;
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

function parseModuleFromText(text: string, filePath: string): ModuleInfo | null {
  // 只匹配真正的 module 定义行
  const moduleMatch = text.match(/^\s*module\s+([A-Za-z_]\w*)\b/m);
  if (!moduleMatch) {
    return null;
  }

  const moduleName = moduleMatch[1];

  // 支持 parameter block + port block
  const fullMatch = text.match(
    /^\s*module\s+[A-Za-z_]\w*\s*(?:#\s*\(([\s\S]*?)\))?\s*\(([\s\S]*?)\)\s*;/m
  );
  if (!fullMatch) {
    return null;
  }

  const paramBlock = fullMatch[1] ?? "";
  const portBlock = fullMatch[2] ?? "";

  const params: ParamInfo[] = [];
  const ports: PortInfo[] = [];

  // parse parameters
  for (const rawLine of paramBlock.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/\/\/.*$/, "").trim();
    line = line.replace(/,$/, "").trim();
    if (!line) continue;

    const pm = line.match(
      /^parameter\s+(?:.+\s+)?([A-Za-z_]\w*)(?:\s*=\s*.+)?$/
    );

    if (!pm) continue;

    params.push({ name: pm[1] });
  }

  // parse ports
  for (const rawLine of portBlock.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/\/\/.*$/, "").trim();
    line = line.replace(/,$/, "").trim();
    if (!line) continue;

    const m = line.match(
      /^(input|output|inout)\s+(.+?)\s+([A-Za-z_]\w*)$/
    );

    if (!m) {
      const simple = line.match(/^(input|output|inout)\s+([A-Za-z_]\w*)$/);
      if (!simple) continue;

      ports.push({
        direction: simple[1],
        typePart: "",
        name: simple[2],
      });
      continue;
    }

    ports.push({
      direction: m[1],
      typePart: m[2].trim(),
      name: m[3],
    });
  }

  return {
    moduleName,
    params,
    ports,
    filePath,
  };
}

function buildInstantiation(mod: ModuleInfo): string {
  const instName = `u_${mod.moduleName}`;
  const lines: string[] = [];

  if (mod.params.length > 0) {
    const paramWidth = Math.max(...mod.params.map((p) => p.name.length));

    lines.push(`${mod.moduleName} #(`);

    mod.params.forEach((p, idx) => {
      const comma = idx === mod.params.length - 1 ? "" : ",";
      lines.push(`  .${padRight(p.name, paramWidth)} (${p.name})${comma}`);
    });

    lines.push(`) ${instName} (`);
  } else {
    lines.push(`${mod.moduleName} ${instName} (`);
  }

  const portWidth =
    mod.ports.length > 0 ? Math.max(...mod.ports.map((p) => p.name.length)) : 0;

  mod.ports.forEach((p, idx) => {
    const comma = idx === mod.ports.length - 1 ? "" : ",";
    lines.push(`  .${padRight(p.name, portWidth)} ()${comma}`);
  });

  lines.push(`);`);
  return lines.join("\n");
}

async function findModuleInWorkspace(
  moduleName: string,
  searchPath: string
): Promise<ModuleInfo[]> {
  const normalizedPath = normalizeSearchPath(searchPath);

  const includePattern = normalizedPath
    ? `${normalizedPath}/**/*.{sv,v,svh,vh}`
    : "**/*.{sv,v,svh,vh}";

  const files = await vscode.workspace.findFiles(
    includePattern,
    "**/{node_modules,.git,out,dist}/**"
  );

  const results: ModuleInfo[] = [];
  const escapedName = escapeRegExp(moduleName);
  const moduleRegex = new RegExp(`^\\s*module\\s+${escapedName}\\b`, "m");

  for (const file of files) {
    try {
      const openedDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === file.fsPath
      );

      const doc = openedDoc ?? (await vscode.workspace.openTextDocument(file));
      const text = doc.getText();

      if (!moduleRegex.test(text)) {
        continue;
      }

      const mod = parseModuleFromText(text, file.fsPath);
      if (mod && mod.moduleName === moduleName) {
        results.push(mod);
      }
    } catch (err) {
      console.error("SoCBuilder findModuleInWorkspace error:", err);
    }
  }

  return results;
}

export async function instantiateModuleByNameCommand(
  editor: vscode.TextEditor
): Promise<void> {
  const searchPath = await vscode.window.showInputBox({
    prompt: "Enter search path first (workspace-relative)",
    placeHolder: "e.g. hw/share/rtl/fifo",
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

  console.log("SoCBuilder searchPath:", searchPath);
  console.log("SoCBuilder search module:", moduleName);

  const matches = await findModuleInWorkspace(moduleName.trim(), searchPath);

  console.log("SoCBuilder matches:", matches);

  if (matches.length === 0) {
    vscode.window.showErrorMessage(
      `SoCBuilder: Module '${moduleName}' not found under path '${searchPath || "."}'.`
    );
    return;
  }

  let selected: ModuleInfo;

  if (matches.length === 1) {
    selected = matches[0];
  } else {
    const picked = await vscode.window.showQuickPick(
      matches.map((m) => ({
        label: m.moduleName,
        description: m.filePath,
        detail: `params: ${m.params.length}, ports: ${m.ports.length}`,
        mod: m,
      })),
      {
        placeHolder: `Multiple modules named '${moduleName}' found. Select one.`,
      }
    );

    if (!picked) {
      return;
    }

    selected = picked.mod;
  }

  const instText = buildInstantiation(selected);

  await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, instText);
  });

  vscode.window.showInformationMessage(
    `SoCBuilder: Instantiated '${selected.moduleName}'.`
  );
}