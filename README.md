# SoCBuilder

**SoCBuilder** is a lightweight Visual Studio Code extension designed for SystemVerilog / Verilog development, focusing on improving productivity in RTL coding.

---

## ✨ Features

### 1. Align Declarations

Automatically aligns signal declarations to improve readability.

#### Supported patterns:

```sv
logic a;
logic [7:0] b;
logic [7:0] [3:0] c;
```

#### Before:

```sv
logic a;
logic [8:0] b;
logic [7:0] [8:0] c;
logic [66:0] [4:0] [5:0] d;
```

#### After:

```sv
logic         a;
logic [8:0]   b;
logic [7:0]   [8:0]   c;
logic [66:0]  [4:0]   [5:0] d;
```

✔ Multi-dimension ranges aligned independently
✔ Clean column-based formatting

---

### 2. Instantiate Module by Name

Automatically generates module instantiation by searching the workspace.

#### Usage:

1. Trigger command:

   ```
   SoCBuilder: Instantiate Module By Name
   ```
2. Enter module name:

   ```
   prim_fifo_async
   ```

#### Example:

Given module:

```sv
module a #(
  parameter int A
) (
  input a,
  output logic b
);
```

Generated:

```sv
a #(
  .A (A)
) u_a (
  .a (),
  .b ()
);
```

✔ Supports parameterized modules
✔ Supports multi-file workspace search
✔ Handles duplicate module names via selection

---

## ⌨️ Keybindings

| Command            | Shortcut         |
| ------------------ | ---------------- |
| Align Declarations | `Ctrl + Alt + A` |
| Instantiate Module | `Ctrl + Alt + I` |

---

## 📂 Supported Files

* `.sv`
* `.v`
* `.svh`
* `.vh`

---

## 🚀 Development

```bash
npm install
npm run compile
```

Press `F5` to launch Extension Development Host.

---

## 📌 Notes

* Only simple single-variable declarations are supported (no multi-declaration lines yet)
* Module parsing is based on common RTL coding styles
* Complex syntax (interfaces, generate, macros) may not be fully supported yet

---

## 🔮 Roadmap

* Auto port signal declaration
* Smart connection suggestions
* Multi-module batch instantiation
* Interface support
* Better SystemVerilog parsing (AST-based)

---

## 👨‍💻 Author

Wendell Zhao

---

## 💬 Feedback

Issues and suggestions are welcome.
