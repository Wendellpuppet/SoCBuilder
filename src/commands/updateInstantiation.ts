import * as vscode from "vscode";
import { padRight } from "../utils/text";

type NamedConnection = {
  name: string;
  expr: string;
};

type ParsedInstantiation = {
  moduleName: string;
  instanceName: string;
  params: NamedConnection[];
  ports: NamedConnection[];
};

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

function parseNamedConnections(block: string): NamedConnection[] {
  const results: NamedConnection[] = [];
  const regex = /\.(\w+)\s*\(\s*([\s\S]*?)\s*\)\s*,?/g;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(block)) !== null) {
    results.push({
      name: m[1],
      expr: m[2].trim(),
    });
  }

  return results;
}

function parseInstantiation(text: string): ParsedInstantiation | null {
  const trimmed = text.trim();

  // 带参数:
  // foo #( ... ) u_foo ( ... );
  let m = trimmed.match(
    /^([A-Za-z_]\w*)\s*#\s*\(([\s\S]*?)\)\s*([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*;?$/
  );
  if (m) {
    return {
      moduleName: m[1],
      params: parseNamedConnections(m[2]),
      instanceName: m[3],
      ports: parseNamedConnections(m[4]),
    };
  }

  // 无参数:
  // foo u_foo ( ... );
  m = trimmed.match(
    /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*;?$/
  );
  if (m) {
    return {
      moduleName: m[1],
      instanceName: m[2],
      params: [],
      ports: parseNamedConnections(m[3]),
    };
  }

  return null;
}

function parsePortNamesFromHeader(headerPortBlock: string): string[] {
  const names: string[] = [];

  for (const rawLine of headerPortBlock.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/\/\/.*$/, "").trim();
    line = line.replace(/,$/, "").trim();
    if (!line) continue;

    if (/^(input|output|inout)\b/.test(line)) {
      continue;
    }

    const parts = line.split(",");
    for (const part of parts) {
      const name = part.trim();
      if (/^[A-Za-z_]\w*$/.test(name)) {
        names.push(name);
      }
    }
  }

  return names;
}

function parseAnsiPorts(portBlock: string): PortInfo[] {
  const ports: PortInfo[] = [];

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

  return ports;
}

function parseNonAnsiPorts(text: string, headerPortNames: string[]): PortInfo[] {
  const headerNameSet = new Set(headerPortNames);
  const portMap = new Map<string, PortInfo>();

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    const declMatch = line.match(/^(input|output|inout)\s+(.+?)\s*;\s*$/);
    if (!declMatch) continue;

    const direction = declMatch[1];
    const rest = declMatch[2].trim();

    if (/^[A-Za-z_]\w*(\s*,\s*[A-Za-z_]\w*)*$/.test(rest)) {
      const names = rest.split(",").map((x) => x.trim());

      for (const name of names) {
        if (!headerNameSet.has(name)) continue;
        portMap.set(name, {
          direction,
          typePart: "",
          name,
        });
      }
      continue;
    }

    const typedMatch = rest.match(
      /^(.+?)\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)$/
    );
    if (!typedMatch) continue;

    const typePart = typedMatch[1].trim();
    const namesPart = typedMatch[2].trim();
    const names = namesPart.split(",").map((x) => x.trim());

    for (const name of names) {
      if (!headerNameSet.has(name)) continue;
      portMap.set(name, {
        direction,
        typePart,
        name,
      });
    }
  }

  return headerPortNames
    .map((name) => portMap.get(name))
    .filter((x): x is PortInfo => x !== undefined);
}

function parseBodyParams(text: string): ParamInfo[] {
  const params: ParamInfo[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    if (!line.startsWith("parameter ")) {
      continue;
    }

    line = line.replace(/;\s*$/, "").trim();
    const afterKeyword = line.slice("parameter".length).trim();

    const noTypeMatch = afterKeyword.match(/^([A-Za-z_]\w*)\s*(=\s*.+)?$/);
    if (noTypeMatch) {
      params.push({ name: noTypeMatch[1] });
      continue;
    }

    const typedMatch = afterKeyword.match(
      /^(.+?)\s+([A-Za-z_]\w*)\s*(=\s*.+)?$/
    );
    if (typedMatch) {
      params.push({ name: typedMatch[2] });
    }
  }

  return params;
}

function parseModuleFromText(text: string, filePath: string): ModuleInfo | null {
  const moduleMatch = text.match(/^\s*module\s+([A-Za-z_]\w*)\b/m);
  if (!moduleMatch) {
    return null;
  }

  const moduleName = moduleMatch[1];

  const fullMatch = text.match(
    /^\s*module\s+[A-Za-z_]\w*\s*(?:#\s*\(([\s\S]*?)\))?\s*\(([\s\S]*?)\)\s*;/m
  );
  if (!fullMatch) {
    return null;
  }

  const paramBlock = fullMatch[1] ?? "";
  const portBlock = fullMatch[2] ?? "";

  const headerParams: ParamInfo[] = [];
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

    headerParams.push({ name: pm[1] });
  }

  const bodyParams = parseBodyParams(text);
  const paramMap = new Map<string, ParamInfo>();

  for (const p of headerParams) {
    paramMap.set(p.name, p);
  }
  for (const p of bodyParams) {
    paramMap.set(p.name, p);
  }

  const params = Array.from(paramMap.values());

  let ports = parseAnsiPorts(portBlock);
  if (ports.length === 0) {
    const headerPortNames = parsePortNamesFromHeader(portBlock);
    ports = parseNonAnsiPorts(text, headerPortNames);
  }

  return {
    moduleName,
    params,
    ports,
    filePath,
  };
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

function buildUpdatedInstantiation(
  oldInst: ParsedInstantiation,
  mod: ModuleInfo
): string {
  const paramMap = new Map(oldInst.params.map((x) => [x.name, x.expr]));
  const portMap = new Map(oldInst.ports.map((x) => [x.name, x.expr]));

  const lines: string[] = [];

  if (mod.params.length > 0) {
    const paramWidth = Math.max(...mod.params.map((p) => p.name.length));

    lines.push(`${mod.moduleName} #(`);
    mod.params.forEach((p, idx) => {
      const comma = idx === mod.params.length - 1 ? "" : ",";
      const expr = paramMap.get(p.name) ?? p.name;
      lines.push(`  .${padRight(p.name, paramWidth)} (${expr})${comma}`);
    });
    lines.push(`) ${oldInst.instanceName} (`);
  } else {
    lines.push(`${mod.moduleName} ${oldInst.instanceName} (`);
  }

  if (mod.ports.length > 0) {
    const portWidth = Math.max(...mod.ports.map((p) => p.name.length));

    mod.ports.forEach((p, idx) => {
      const comma = idx === mod.ports.length - 1 ? "" : ",";
      const expr = portMap.get(p.name) ?? p.name;
      lines.push(`  .${padRight(p.name, portWidth)} (${expr})${comma}`);
    });
  }

  lines.push(`);`);
  return lines.join("\n");
}

export async function updateInstantiationCommand(
  editor: vscode.TextEditor
): Promise<void> {
  const document = editor.document;
  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showInformationMessage(
      "SoCBuilder: Please select an instantiation block first."
    );
    return;
  }

  const selectedText = document.getText(selection);
  const parsedInst = parseInstantiation(selectedText);

  if (!parsedInst) {
    vscode.window.showErrorMessage(
      "SoCBuilder: Failed to parse the selected instantiation."
    );
    return;
  }

  const searchPath = await vscode.window.showInputBox({
    prompt: "Enter search path (workspace-relative)",
    placeHolder: "e.g. hw/share/rtl/fifo",
    ignoreFocusOut: true,
  });

  if (searchPath === undefined) {
    return;
  }

  const matches = await findModuleInWorkspace(parsedInst.moduleName, searchPath);

  if (matches.length === 0) {
    vscode.window.showErrorMessage(
      `SoCBuilder: Module '${parsedInst.moduleName}' not found under path '${searchPath || "."}'.`
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
        placeHolder: `Multiple modules named '${parsedInst.moduleName}' found. Select one.`,
      }
    );

    if (!picked) {
      return;
    }

    selected = picked.mod;
  }

  const updatedText = buildUpdatedInstantiation(parsedInst, selected);

  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, updatedText);
  });

  vscode.window.showInformationMessage(
    `SoCBuilder: Updated instantiation '${parsedInst.instanceName}'.`
  );
}