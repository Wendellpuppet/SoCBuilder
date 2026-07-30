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

module demo #(
  parameter int Width = 8,
  parameter bit Enable = 1
) (
  input clk_i,
  input logic [Width-1:0] data_i,
  output logic ready_o
);
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
logic                    a;
logic [8:0]              b;
logic [7:0]  [8:0]       c;
logic [66:0] [4:0] [5:0] d;
```

✔ Multi-dimension ranges aligned independently
✔ Module parameter and port lists are supported
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

### 3. Declare Signals

Automatically declares missing internal signals based on variable usage in
assignments, procedural blocks, and module instantiations.

#### Example:

```sv
assign out_data[3:0] = in_data;

sub u_sub (
  .data_i(inst_data),
  .valid_i
);

always_ff @(posedge clk_i) begin
  done_q <= calc_done(in_data);
end
```

Generated declarations:

```sv
wire out_data;
wire in_data;
wire inst_data;
wire valid_i;
reg done_q;
```

✔ Detects missing assignment targets and expression inputs
✔ Detects named and shorthand module port connections
✔ Filters constants, function calls, package references, and hierarchical names

---

## ⌨️ Keybindings

| Command            | Shortcut         |
| ------------------ | ---------------- |
| Align Declarations | `Ctrl + Alt + A` |
| Instantiate Module | `Ctrl + Alt + I` |
| Update Instantiation | `Ctrl + Alt + U` |
| Declare Signals | `Ctrl + Alt + D` |

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
