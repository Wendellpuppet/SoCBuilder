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
  .A(A)
) u_a (
  .a(), // I
  .b()  // O
);
```

✔ Supports parameterized modules
✔ Supports multi-file workspace search
✔ Handles duplicate module names via selection
✔ Adds port direction and width comments for generated instantiations

---

### 3. Declare Signals

Automatically declares missing internal signals based on variable usage in
assignments, procedural blocks, and module instantiations.

#### Example:

```sv
assign out_data[3:0] = in_data;

sub u_sub (
  .data_i(inst_data),       // I [31:0]
  .data_o(data_from_sub),   // O [31:0]
  .ready_o(ready_from_sub)  // O
);

always_ff @(posedge clk_i) begin
  done_q <= calc_done(in_data);
end
```

Generated declarations:

```sv
wire out_data;
wire in_data;
wire [31:0] data_from_sub;
wire ready_from_sub;
reg done_q;
```

SystemVerilog mode:

```sv
logic out_data;
logic in_data;
logic [31:0] data_from_sub;
logic ready_from_sub;
logic done_q;
```

✔ Detects missing assignment targets and expression inputs
✔ Detects named and shorthand output module port connections
✔ Uses instantiation comments like `// O [31:0]` to identify output connections and widths
✔ Supports Verilog `wire`/`reg` declarations and SystemVerilog `logic` declarations
✔ Filters constants, function calls, package references, and hierarchical names

---

### 4. Declare Instance Outputs By Name

Declares output signals by searching an existing instantiation in the current
file from an instance name.

#### Example:

Given instantiation:

```sv
sub u_sub (
  .clk_i(clk_i),   // I
  .data_o(data_o), // O [7:0]
  .valid_o(valid_o)  // O
);
```

Generated declarations:

```sv
logic [7:0] data_o;
logic valid_o;
```

✔ Searches the current file by instance name
✔ Declares output connections only
✔ Preserves widths from instantiation comments like `// O [7:0]`
✔ Supports Verilog `wire` declarations and SystemVerilog `logic` declarations

---

### 5. Align Instantiation

Aligns named parameter and port connections inside module instantiations.

#### Before:

```sv
prim_fifo_sync_cnt #(
  .Depth(Depth),
  .Secure(Secure),
  .NeverClears(NeverClears)
) u_fifo_cnt (
  .clk_i,
  .rst_ni,
  .incr_wptr_i(fifo_incr_wptr),
  .empty_o(fifo_empty)
);
```

#### After:

```sv
prim_fifo_sync_cnt #(
  .Depth      (Depth      ),
  .Secure     (Secure     ),
  .NeverClears(NeverClears)
) u_fifo_cnt (
  .clk_i      (clk_i         ),
  .rst_ni     (rst_ni        ),
  .incr_wptr_i(fifo_incr_wptr),
  .empty_o    (fifo_empty    )
);
```

✔ Aligns opening parentheses while keeping the longest name tight
✔ Aligns closing parentheses and comments
✔ Supports parameter and port connection blocks
✔ Expands shorthand connections to explicit `.port(port)` form

---

## ⌨️ Keybindings

| Command            | Shortcut         |
| ------------------ | ---------------- |
| Align Declarations | `Ctrl + Alt + A` |
| Instantiate Module | `Ctrl + Alt + I` |
| Update Instantiation | `Ctrl + Alt + U` |
| Declare Signals | `Ctrl + Alt + D` |
| Align Instantiation | `Ctrl + Alt + L` |
| Declare Instance Outputs | `Ctrl + Alt + O` |

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
