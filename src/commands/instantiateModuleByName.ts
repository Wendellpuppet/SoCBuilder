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

function parsePortNamesFromHeader(headerPortBlock: string): string[] {
  const names: string[] = [];

  for (const rawLine of headerPortBlock.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/\/\/.*$/, "").trim();
    line = line.replace(/,$/, "").trim();
    if (!line) continue;

    // ANSI 风格端口留给别的逻辑处理
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
      if (!simple) {
        continue;
      }

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

function parseBodyParams(text: string): ParamInfo[] {
  const params: ParamInfo[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    // 只处理 module body 里的 parameter 声明
    if (!line.startsWith("parameter ")) {
      continue;
    }

    // 去掉结尾分号
    line = line.replace(/;\s*$/, "").trim();

    const afterKeyword = line.slice("parameter".length).trim();

    // 先匹配“无类型” parameter
    // 例如:
    // parameter A = b
    // parameter WIDTH = 8
    let noTypeMatch = afterKeyword.match(
      /^([A-Za-z_]\w*)\s*(=\s*.+)?$/
    );

    if (noTypeMatch) {
      params.push({ name: noTypeMatch[1] });
      continue;
    }

    // 再匹配“有类型” parameter
    // 例如:
    // parameter int A = 1
    // parameter logic [7:0] WIDTH = 8
    let typedMatch = afterKeyword.match(
      /^(.+?)\s+([A-Za-z_]\w*)\s*(=\s*.+)?$/
    );

    if (typedMatch) {
      params.push({ name: typedMatch[2] });
    }
  }

  return params;
}

function parseNonAnsiPorts(text: string, headerPortNames: string[]): PortInfo[] {
  const headerNameSet = new Set(headerPortNames);
  const portMap = new Map<string, PortInfo>();

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    // 支持:
    // input a;
    // input a, b;
    // output logic [A-1:0] b;
    // output logic [7:0] b, c;
    const declMatch = line.match(/^(input|output|inout)\s+(.+?)\s*;\s*$/);
    if (!declMatch) {
      continue;
    }

    const direction = declMatch[1];
    const rest = declMatch[2].trim();

    // 无类型:
    // input a
    // input a, b
    if (/^[A-Za-z_]\w*(\s*,\s*[A-Za-z_]\w*)*$/.test(rest)) {
      const names = rest.split(",").map((x) => x.trim());

      for (const name of names) {
        if (!headerNameSet.has(name)) {
          continue;
        }

        portMap.set(name, {
          direction,
          typePart: "",
          name,
        });
      }

      continue;
    }

    // 有类型:
    // output logic [A-1:0] b
    // output logic [7:0] b, c
    const typedMatch = rest.match(
      /^(.+?)\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)$/
    );
    if (!typedMatch) {
      continue;
    }

    const typePart = typedMatch[1].trim();
    const namesPart = typedMatch[2].trim();
    const names = namesPart.split(",").map((x) => x.trim());

    for (const name of names) {
      if (!headerNameSet.has(name)) {
        continue;
      }

      portMap.set(name, {
        direction,
        typePart,
        name,
      });
    }
  }

  // 按 module header 里的顺序输出
  return headerPortNames
    .map((name) => portMap.get(name))
    .filter((x): x is PortInfo => x !== undefined);
}

function parseModuleFromText(text: string, filePath: string): ModuleInfo | null {
  // 只匹配真正的 module 定义行
  const moduleMatch = text.match(/^\s*module\s+([A-Za-z_]\w*)\b/m);
  if (!moduleMatch) {
    return null;
  }

  const moduleName = moduleMatch[1];

  // 匹配 module 头，支持可选的 #(...) 和端口列表 (...)
  const fullMatch = text.match(
    /^\s*module\s+[A-Za-z_]\w*\s*(?:#\s*\(([\s\S]*?)\))?\s*\(([\s\S]*?)\)\s*;/m
  );
  if (!fullMatch) {
    return null;
  }

  const paramBlock = fullMatch[1] ?? "";
  const portBlock = fullMatch[2] ?? "";

  // 1) 解析 module header 里的 #(...) 参数
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

  // 2) 解析 module body 里的 parameter ...;
  const bodyParams = parseBodyParams(text);

  // 3) 合并参数并去重
  const paramMap = new Map<string, ParamInfo>();
  for (const p of headerParams) {
    paramMap.set(p.name, p);
  }
  for (const p of bodyParams) {
    paramMap.set(p.name, p);
  }

  const params = Array.from(paramMap.values());

  // 4) 先尝试 ANSI 风格端口
  let ports = parseAnsiPorts(portBlock);

  // 5) 如果 module header 里没有 input/output/inout，则按非 ANSI 风格解析
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

  if (mod.ports.length > 0) {
    const portWidth = Math.max(...mod.ports.map((p) => p.name.length));

    mod.ports.forEach((p, idx) => {
      const comma = idx === mod.ports.length - 1 ? "" : ",";
      lines.push(`  .${padRight(p.name, portWidth)} (${p.name})${comma}`);
    });
  }

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