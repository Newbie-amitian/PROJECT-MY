// ============================================================
// GREL (Google Refine Expression Language) Engine
// ============================================================
// Safe expression evaluator for data transformations.
// Inspired by OpenRefine's GREL but implemented as a custom
// tokenizer + recursive-descent parser + AST evaluator.
//
// Supports: method chains, if/else, cross-cell refs, string/number ops

import type { RawDataRow } from "./dashboard-types";

// ── Public Types ──────────────────────────────────

export interface GRELError {
  message: string;
  position?: number;
  row?: number;
}

export interface GRELRowResult {
  rowIndex: number;
  originalValue: unknown;
  transformedValue: unknown;
  error?: string;
}

export interface GRELPreviewResult {
  transformedData: RawDataRow[];
  results: GRELRowResult[];
  errors: GRELError[];
}

export type GRELValue = string | number | boolean | null;

// ── Token Types ──────────────────────────────────

const enum TT {
  STRING, NUMBER, IDENT,
  DOT, LPAREN, RPAREN, LBRACKET, RBRACKET,
  COMMA, PLUS, MINUS, STAR, SLASH, PERCENT,
  EQ, NEQ, GT, LT, GTE, LTE,
  QUESTION, COLON,
  EOF,
}

interface Token {
  type: TT;
  value: string;
  pos: number;
}

// ── Tokenizer ────────────────────────────────────

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Whitespace — skip
    if (/\s/.test(ch)) { i++; continue; }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let str = "";
      while (i < expr.length) {
        if (expr[i] === "\\") { i++; if (i < expr.length) str += expr[i]; i++; continue; }
        if (expr[i] === quote) { i++; break; }
        str += expr[i];
        i++;
      }
      tokens.push({ type: TT.STRING, value: str, pos: start });
      continue;
    }

    // Number (including negative when preceded by operator/start)
    if (/\d/.test(ch) || (ch === "." && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
      const start = i;
      let num = "";
      while (i < expr.length && /[\d.]/.test(expr[i])) { num += expr[i]; i++; }
      tokens.push({ type: TT.NUMBER, value: num, pos: start });
      continue;
    }

    // Two-char operators
    const two = expr.slice(i, i + 2);
    if (two === "==") { tokens.push({ type: TT.EQ, value: "==", pos: i }); i += 2; continue; }
    if (two === "!=") { tokens.push({ type: TT.NEQ, value: "!=", pos: i }); i += 2; continue; }
    if (two === ">=") { tokens.push({ type: TT.GTE, value: ">=", pos: i }); i += 2; continue; }
    if (two === "<=") { tokens.push({ type: TT.LTE, value: "<=", pos: i }); i += 2; continue; }

    // Single-char tokens
    const singles: Record<string, TT> = {
      ".": TT.DOT, "(": TT.LPAREN, ")": TT.RPAREN,
      "[": TT.LBRACKET, "]": TT.RBRACKET, ",": TT.COMMA,
      "+": TT.PLUS, "-": TT.MINUS, "*": TT.STAR, "/": TT.SLASH, "%": TT.PERCENT,
      ">": TT.GT, "<": TT.LT, "?": TT.QUESTION, ":": TT.COLON,
    };
    if (singles[ch] !== undefined) {
      tokens.push({ type: singles[ch], value: ch, pos: i }); i++; continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      let ident = "";
      while (i < expr.length && /[a-zA-Z0-9_$]/.test(expr[i])) { ident += expr[i]; i++; }
      tokens.push({ type: TT.IDENT, value: ident, pos: start });
      continue;
    }

    // Unknown char — skip
    i++;
  }

  tokens.push({ type: TT.EOF, value: "", pos: i });
  return tokens;
}

// ── AST Nodes ────────────────────────────────────

type AST =
  | { kind: "literal"; value: GRELValue }
  | { kind: "value" }
  | { kind: "cellRef"; column: string }
  | { kind: "method"; receiver: AST; name: string; args: AST[] }
  | { kind: "property"; receiver: AST; name: string }
  | { kind: "binary"; op: string; left: AST; right: AST }
  | { kind: "unary"; op: string; operand: AST }
  | { kind: "if"; condition: AST; then: AST; else: AST }
  | { kind: "func"; name: string; args: AST[] };

// ── Parser (Recursive Descent) ───────────────────

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek() { return this.tokens[this.pos]; }
  private advance() { return this.tokens[this.pos++]; }
  private expect(type: TT, value?: string) {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${TT[type]}${value ? ` "${value}"` : ""} but got "${t.value}" at position ${t.pos}`);
    }
    return this.advance();
  }

  parse(): AST {
    const ast = this.expression();
    if (this.peek().type !== TT.EOF) {
      throw new Error(`Unexpected token "${this.peek().value}" at position ${this.peek().pos}`);
    }
    return ast;
  }

  private expression(): AST {
    return this.ternary();
  }

  private ternary(): AST {
    const left = this.comparison();
    if (this.peek().type === TT.QUESTION) {
      this.advance();
      const then = this.expression();
      this.expect(TT.COLON);
      const else_ = this.expression();
      return { kind: "if", condition: left, then, else: else_ };
    }
    return left;
  }

  private comparison(): AST {
    let left = this.addition();
    const ops = [TT.EQ, TT.NEQ, TT.GT, TT.LT, TT.GTE, TT.LTE];
    while (ops.includes(this.peek().type)) {
      const op = this.advance().value;
      const right = this.addition();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private addition(): AST {
    let left = this.multiplication();
    while (this.peek().type === TT.PLUS || this.peek().type === TT.MINUS) {
      const op = this.advance().value;
      const right = this.multiplication();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private multiplication(): AST {
    let left = this.unary();
    while ([TT.STAR, TT.SLASH, TT.PERCENT].includes(this.peek().type)) {
      const op = this.advance().value;
      const right = this.unary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private unary(): AST {
    if (this.peek().type === TT.MINUS) {
      this.advance();
      const operand = this.unary();
      return { kind: "unary", op: "-", operand };
    }
    if (this.peek().type === TT.NOT) {
      this.advance();
      const operand = this.unary();
      return { kind: "unary", op: "!", operand };
    }
    return this.postfix();
  }

  private postfix(): AST {
    let node = this.primary();
    while (this.peek().type === TT.DOT) {
      this.advance();
      const name = this.expect(TT.IDENT).value;
      if (this.peek().type === TT.LPAREN) {
        this.advance(); // (
        const args = this.argList();
        this.expect(TT.RPAREN);
        node = { kind: "method", receiver: node, name, args };
      } else {
        node = { kind: "property", receiver: node, name };
      }
    }
    return node;
  }

  private argList(): AST[] {
    const args: AST[] = [];
    if (this.peek().type === TT.RPAREN) return args;
    args.push(this.expression());
    while (this.peek().type === TT.COMMA) {
      this.advance();
      args.push(this.expression());
    }
    return args;
  }

  private primary(): AST {
    const t = this.peek();

    // String literal
    if (t.type === TT.STRING) {
      this.advance();
      return { kind: "literal", value: t.value };
    }

    // Number literal
    if (t.type === TT.NUMBER) {
      this.advance();
      const n = parseFloat(t.value);
      return { kind: "literal", value: isNaN(n) ? 0 : n };
    }

    // Parenthesized expression
    if (t.type === TT.LPAREN) {
      this.advance();
      const expr = this.expression();
      this.expect(TT.RPAREN);
      return expr;
    }

    // Keywords and identifiers
    if (t.type === TT.IDENT) {
      const v = t.value.toLowerCase();

      // "value" — current cell value
      if (v === "value") {
        this.advance();
        return { kind: "value" };
      }

      // "cells" — cross-cell reference
      if (v === "cells") {
        this.advance();
        this.expect(TT.LBRACKET);
        const col = this.expect(TT.STRING).value;
        this.expect(TT.RBRACKET);
        // optional .value
        if (this.peek().type === TT.DOT) {
          this.advance();
          this.expect(TT.IDENT); // "value"
        }
        return { kind: "cellRef", column: col };
      }

      // "true" / "false" / "null"
      if (v === "true") { this.advance(); return { kind: "literal", value: true }; }
      if (v === "false") { this.advance(); return { kind: "literal", value: false }; }
      if (v === "null") { this.advance(); return { kind: "literal", value: null }; }

      // "if" — conditional
      if (v === "if" && this.tokens[this.pos + 1]?.type === TT.LPAREN) {
        this.advance(); // consume "if"
        this.expect(TT.LPAREN);
        const condition = this.expression();
        this.expect(TT.COMMA);
        const then = this.expression();
        this.expect(TT.COMMA);
        const else_ = this.expression();
        this.expect(TT.RPAREN);
        return { kind: "if", condition, then, else: else_ };
      }

      // Function call: identifier(args)
      if (this.tokens[this.pos + 1]?.type === TT.LPAREN) {
        this.advance();
        this.advance(); // (
        const args = this.argList();
        this.expect(TT.RPAREN);
        return { kind: "func", name: v, args };
      }

      // Bare identifier — treat as string literal
      this.advance();
      return { kind: "literal", value: t.value };
    }

    throw new Error(`Unexpected token "${t.value}" at position ${t.pos}`);
  }
}

// ── Evaluator ────────────────────────────────────

interface EvalContext {
  row: RawDataRow;
  columnName: string;
  rowIndex: number;
}

function toStr(v: GRELValue): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function toNum(v: GRELValue): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function titleCase(s: string): string {
  return s.trim().split(/\s+/).map(w =>
    w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w
  ).join(" ");
}

function evalAST(node: AST, ctx: EvalContext): GRELValue {
  switch (node.kind) {
    case "literal":
      return node.value;

    case "value":
      return ctx.row[ctx.column] as GRELValue ?? null;

    case "cellRef":
      return ctx.row[node.column] as GRELValue ?? null;

    case "property":
      if (node.name === "length") {
        const val = evalAST(node.receiver, ctx);
        if (val === null) return 0;
        return toStr(val).length;
      }
      return evalAST(node.receiver, ctx);

    case "method":
      return evalMethod(node, ctx);

    case "binary":
      return evalBinary(node, ctx);

    case "unary":
      if (node.op === "-") {
        const v = toNum(evalAST(node.operand, ctx));
        return v !== null ? -v : null;
      }
      if (node.op === "!") {
        return !evalAST(node.operand, ctx);
      }
      return null;

    case "if": {
      const cond = evalAST(node.condition, ctx);
      if (truthy(cond)) return evalAST(node.then, ctx);
      return evalAST(node.else, ctx);
    }

    case "func":
      return evalFunction(node, ctx);
  }
}

function truthy(v: GRELValue): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return true;
}

function evalBinary(node: AST & { kind: "binary" }, ctx: EvalContext): GRELValue {
  const left = evalAST(node.left, ctx);
  const right = evalAST(node.right, ctx);
  const op = node.op;

  // String concatenation
  if (op === "+") {
    if (typeof left === "string" || typeof right === "string") {
      return toStr(left) + toStr(right);
    }
    const ln = toNum(left), rn = toNum(right);
    if (ln !== null && rn !== null) return ln + rn;
    return toStr(left) + toStr(right);
  }

  // Comparison operators
  if (op === "==" || op === "!=") {
    const eq = left === right || toStr(left) === toStr(right);
    return op === "==" ? eq : !eq;
  }
  if (op === ">" || op === "<" || op === ">=" || op === "<=") {
    const ln = toNum(left), rn = toNum(right);
    if (ln !== null && rn !== null) {
      switch (op) {
        case ">": return ln > rn;
        case "<": return ln < rn;
        case ">=": return ln >= rn;
        case "<=": return ln <= rn;
      }
    }
    // String comparison fallback
    const ls = toStr(left).toLowerCase(), rs = toStr(right).toLowerCase();
    switch (op) {
      case ">": return ls > rs;
      case "<": return ls < rs;
      case ">=": return ls >= rs;
      case "<=": return ls <= rs;
    }
  }

  // Arithmetic
  const ln = toNum(left), rn = toNum(right);
  if (ln !== null && rn !== null) {
    switch (op) {
      case "-": return ln - rn;
      case "*": return ln * rn;
      case "/": return rn !== 0 ? ln / rn : null;
      case "%": return rn !== 0 ? ln % rn : null;
    }
  }

  return null;
}

function evalMethod(node: AST & { kind: "method" }, ctx: EvalContext): GRELValue {
  const receiver = evalAST(node.receiver, ctx);
  const name = node.name.toLowerCase();
  const args = node.args.map(a => evalAST(a, ctx));

  // Null-safe: most methods on null return null
  if (receiver === null || receiver === undefined) {
    if (name === "ifblank" && args.length > 0) return args[0];
    if (name === "tostring") return "";
    return null;
  }

  const s = typeof receiver === "string" ? receiver : String(receiver);
  const n = typeof receiver === "number" ? receiver : parseFloat(String(receiver));

  // ── String Methods ──
  if (name === "trim") return s.trim();
  if (name === "tolowercase") return s.toLowerCase();
  if (name === "touppercase") return s.toUpperCase();
  if (name === "titlecase") return titleCase(s);
  if (name === "capitalize") return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  if (name === "strip") return s.trim();

  if (name === "replace" || name === "replaceall") {
    const old = args[0] !== undefined ? toStr(args[0]) : "";
    const rep = args[1] !== undefined ? toStr(args[1]) : "";
    if (name === "replace") return s.replace(old, rep);
    return s.split(old).join(rep);
  }

  if (name === "substring" || name === "slice") {
    const start = args[0] !== undefined ? Number(args[0]) : 0;
    const end = args[1] !== undefined ? Number(args[1]) : undefined;
    if (isNaN(start)) return s;
    return end !== undefined ? s.slice(start, end) : s.slice(start);
  }

  if (name === "split") {
    const delim = args[0] !== undefined ? toStr(args[0]) : ",";
    return s.split(delim).join(","); // Return comma-joined for display
  }

  if (name === "contains") {
    return s.toLowerCase().includes((args[0] !== undefined ? toStr(args[0]) : "").toLowerCase());
  }

  if (name === "startswith") {
    return s.toLowerCase().startsWith((args[0] !== undefined ? toStr(args[0]) : "").toLowerCase());
  }

  if (name === "endswith") {
    return s.toLowerCase().endsWith((args[0] !== undefined ? toStr(args[0]) : "").toLowerCase());
  }

  if (name === "indexof") {
    return s.indexOf(toStr(args[0] ?? ""));
  }

  if (name === "lastindexof") {
    return s.lastIndexOf(toStr(args[0] ?? ""));
  }

  if (name === "reverse") return s.split("").reverse().join("");
  if (name === "repeat") return s.repeat(Math.max(0, Number(args[0]) || 0));
  if (name === "padstart") return s.padStart(Number(args[0]) || 0, toStr(args[1] ?? " "));
  if (name === "padend") return s.padEnd(Number(args[0]) || 0, toStr(args[1] ?? " "));

  if (name === "matches") {
    const pattern = args[0] !== undefined ? toStr(args[0]) : "";
    try { return new RegExp(pattern, "i").test(s); } catch { return false; }
  }

  if (name === "test" || name === "isequal" || name === "equals") {
    return s === (args[0] !== undefined ? toStr(args[0]) : "");
  }

  // ── Type Conversion ──
  if (name === "tostring") return String(receiver);
  if (name === "tonumber") {
    const cleaned = s.replace(/,/g, "").trim();
    const num = Number(cleaned);
    return isNaN(num) ? null : num;
  }
  if (name === "toboolean") return truthy(receiver);

  // ── Number Methods ──
  if (name === "round") {
    if (isNaN(n)) return receiver;
    const decimals = args[0] !== undefined ? Number(args[0]) : 0;
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  }
  if (name === "floor") return isNaN(n) ? receiver : Math.floor(n);
  if (name === "ceil") return isNaN(n) ? receiver : Math.ceil(n);
  if (name === "abs") return isNaN(n) ? receiver : Math.abs(n);
  if (name === "sqrt") return isNaN(n) || n < 0 ? null : Math.sqrt(n);
  if (name === "pow") {
    const exp = toNum(args[0]);
    return isNaN(n) || exp === null ? null : Math.pow(n, exp);
  }
  if (name === "mod") {
    const mod = toNum(args[0]);
    return isNaN(n) || mod === null || mod === 0 ? null : n % mod;
  }
  if (name === "min") {
    const other = toNum(args[0]);
    return isNaN(n) || other === null ? receiver : Math.min(n, other);
  }
  if (name === "max") {
    const other = toNum(args[0]);
    return isNaN(n) || other === null ? receiver : Math.max(n, other);
  }
  if (name === "tofixed") {
    if (isNaN(n)) return receiver;
    return n.toFixed(Math.max(0, Number(args[0]) || 0));
  }
  if (name === "format") {
    if (isNaN(n)) return receiver;
    return n.toLocaleString();
  }

  // ── Null-safe defaults ──
  if (name === "ifblank") return s.length > 0 ? s : (args[0] ?? "");
  if (name === "or" || name === "defaultvalue" || name === "default") {
    return (receiver === null || receiver === undefined || s === "") ? (args[0] ?? null) : receiver;
  }

  // Date methods
  if (name === "todate") {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
  }

  return receiver; // Unknown method — return original
}

function evalFunction(node: AST & { kind: "func" }, ctx: EvalContext): GRELValue {
  const name = node.name.toLowerCase();
  const args = node.args.map(a => evalAST(a, ctx));

  // ── Conditional ──
  if (name === "if") {
    return truthy(args[0]) ? (args[1] ?? null) : (args[2] ?? null);
  }

  // ── Type checks ──
  if (name === "isblank" || name === "isempty") return args[0] === null || args[0] === undefined || toStr(args[0]).trim() === "";
  if (name === "isnotblank" || name === "isnotnull" || name === "isnotempty") return !(args[0] === null || args[0] === undefined || toStr(args[0]).trim() === "");
  if (name === "isnull") return args[0] === null || args[0] === undefined;
  if (name === "isnumeric") return !isNaN(Number(args[0]));
  if (name === "isstring") return typeof args[0] === "string";
  if (name === "isnumber") return typeof args[0] === "number";
  if (name === "isboolean") return typeof args[0] === "boolean";
  if (name === "typeof" || name === "type") {
    if (args[0] === null || args[0] === undefined) return "null";
    if (typeof args[0] === "number") return "number";
    if (typeof args[0] === "boolean") return "boolean";
    if (typeof args[0] === "string") return "string";
    return "unknown";
  }

  // ── Coalesce ──
  if (name === "coalesce" || name === "nvl" || name === "ifnull") {
    for (const a of args) {
      if (a !== null && a !== undefined && toStr(a).trim() !== "") return a;
    }
    return null;
  }

  // ── String utility ──
  if (name === "len" || name === "length") return toStr(args[0]).length;
  if (name === "tostring") return args[0] !== null ? toStr(args[0]) : "";
  if (name === "tonumber") {
    const s = toStr(args[0]).replace(/,/g, "").trim();
    const n = Number(s);
    return isNaN(n) ? null : n;
  }
  if (name === "tolowercase") return toStr(args[0]).toLowerCase();
  if (name === "touppercase") return toStr(args[0]).toUpperCase();
  if (name === "titlecase") return titleCase(toStr(args[0]));
  if (name === "trim") return toStr(args[0]).trim();
  if (name === "capitalize") {
    const s = toStr(args[0]);
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  }
  if (name === "replace" || name === "replaceall") {
    const s = toStr(args[0]);
    const old = toStr(args[1]);
    const rep = toStr(args[2]);
    if (name === "replace") return s.replace(old, rep);
    return s.split(old).join(rep);
  }
  if (name === "contains") {
    return toStr(args[0]).toLowerCase().includes(toStr(args[1]).toLowerCase());
  }
  if (name === "startswith") {
    return toStr(args[0]).toLowerCase().startsWith(toStr(args[1]).toLowerCase());
  }
  if (name === "endswith") {
    return toStr(args[0]).toLowerCase().endsWith(toStr(args[1]).toLowerCase());
  }
  if (name === "substring" || name === "slice") {
    const s = toStr(args[0]);
    const start = Number(args[1]) || 0;
    const end = args[2] !== undefined ? Number(args[2]) : undefined;
    return end !== undefined ? s.slice(start, end) : s.slice(start);
  }
  if (name === "split") return toStr(args[0]).split(toStr(args[1] ?? ",")).join(",");
  if (name === "join") {
    const arr = args[0];
    if (Array.isArray(arr)) return arr.join(toStr(args[1] ?? ","));
    return toStr(arr);
  }
  if (name === "reverse") return toStr(args[0]).split("").reverse().join("");
  if (name === "repeat") return toStr(args[0]).repeat(Math.max(0, Number(args[1]) || 0));
  if (name === "padstart") return toStr(args[0]).padStart(Number(args[1]) || 0, toStr(args[2] ?? " "));
  if (name === "padend") return toStr(args[0]).padEnd(Number(args[1]) || 0, toStr(args[2] ?? " "));
  if (name === "matches") {
    try { return new RegExp(toStr(args[1] ?? ""), "i").test(toStr(args[0])); } catch { return false; }
  }
  if (name === "indexof") return toStr(args[0]).indexOf(toStr(args[1] ?? ""));
  if (name === "escape") {
    const mode = toStr(args[1] ?? "").toLowerCase();
    const s = toStr(args[0]);
    if (mode === "html") return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    if (mode === "url") return encodeURIComponent(s);
    if (mode === "xml") return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return s;
  }

  // ── Number utility ──
  if (name === "abs") { const n = toNum(args[0]); return n !== null ? Math.abs(n) : null; }
  if (name === "round") {
    const n = toNum(args[0]);
    if (n === null) return null;
    const decimals = Number(args[1]) || 0;
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  }
  if (name === "floor") { const n = toNum(args[0]); return n !== null ? Math.floor(n) : null; }
  if (name === "ceil") { const n = toNum(args[0]); return n !== null ? Math.ceil(n) : null; }
  if (name === "sqrt") { const n = toNum(args[0]); return n !== null && n >= 0 ? Math.sqrt(n) : null; }
  if (name === "pow" || name === "power") {
    const base = toNum(args[0]), exp = toNum(args[1]);
    return base !== null && exp !== null ? Math.pow(base, exp) : null;
  }
  if (name === "mod") { const a = toNum(args[0]), b = toNum(args[1]); return a !== null && b !== null && b !== 0 ? a % b : null; }
  if (name === "min") { const a = toNum(args[0]), b = toNum(args[1]); return a !== null && b !== null ? Math.min(a, b) : null; }
  if (name === "max") { const a = toNum(args[0]), b = toNum(args[1]); return a !== null && b !== null ? Math.max(a, b) : null; }
  if (name === "sum" || name === "add") { const a = toNum(args[0]), b = toNum(args[1]); return a !== null && b !== null ? a + b : null; }
  if (name === "product" || name === "multiply") { const a = toNum(args[0]), b = toNum(args[1]); return a !== null && b !== null ? a * b : null; }
  if (name === "random" || name === "rand" || name === "randomnumber") return Math.random();
  if (name === "range" || name === "sequence") {
    const start = Number(args[0]) || 0, end = Number(args[1]) || 10;
    return Array.from({ length: Math.abs(end - start) }, (_, i) => start + i).join(",");
  }

  // ── Date functions ──
  if (name === "now" || name === "date") return new Date().toISOString().split("T")[0];
  if (name === "todate") {
    const s = toStr(args[0]);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
  }
  if (name === "year" || name === "getyear") {
    const d = new Date(toStr(args[0]));
    return isNaN(d.getTime()) ? null : d.getFullYear();
  }
  if (name === "month" || name === "getmonth") {
    const d = new Date(toStr(args[0]));
    return isNaN(d.getTime()) ? null : d.getMonth() + 1;
  }
  if (name === "day" || name === "getday") {
    const d = new Date(toStr(args[0]));
    return isNaN(d.getTime()) ? null : d.getDate();
  }

  // ── Misc ──
  if (name === "fingerprint" || name === "normalize") {
    return toStr(args[0]).trim().toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9]/g, "");
  }
  if (name === "with") {
    const s = toStr(args[0]);
    const old = toStr(args[1]);
    const rep = toStr(args[2]);
    return s.split(old).join(rep);
  }
  if (name === "chomp") return toStr(args[0]).replace(/^\s+|\s+$/g, "");
  if (name === "unescape") {
    const s = toStr(args[0]);
    try { return decodeURIComponent(s); } catch { return s; }
  }
  if (name === "inc" || name === "increment") { const n = toNum(args[0]); return n !== null ? n + 1 : null; }
  if (name === "dec" || name === "decrement") { const n = toNum(args[0]); return n !== null ? n - 1 : null; }
  if (name === "gcd") { const a = toNum(args[0]), b = toNum(args[1]); return a !== null && b !== null ? gcd(a, b) : null; }

  return null; // Unknown function
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// ── Public API ───────────────────────────────────

/**
 * Parse and validate a GREL expression. Returns null if valid, error string if invalid.
 */
export function validateGREL(expression: string): string | null {
  try {
    const tokens = tokenize(expression.trim());
    const parser = new Parser(tokens);
    parser.parse();
    return null; // Valid
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid expression";
  }
}

/**
 * Apply a GREL expression to a column across all rows.
 * Returns transformed data copy + per-row results.
 */
export function grelTransform(
  expression: string,
  data: RawDataRow[],
  columnName: string,
  previewCount: number = 10,
): GRELPreviewResult {
  const trimmed = expression.trim();
  const errors: GRELError[] = [];

  // Parse expression once
  let ast: AST;
  try {
    const tokens = tokenize(trimmed);
    const parser = new Parser(tokens);
    ast = parser.parse();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid expression";
    errors.push({ message: msg });
    return { transformedData: data, results: [], errors };
  }

  // Evaluate for each row
  const transformedData = data.map((row, idx) => ({ ...row }));
  const results: GRELRowResult[] = [];

  for (let i = 0; i < data.length; i++) {
    const originalValue = data[i][columnName];
    try {
      const result = evalAST(ast, { row: data[i], columnName, rowIndex: i });
      transformedData[i] = { ...transformedData[i], [columnName]: result };
      results.push({ rowIndex: i, originalValue, transformedValue: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Evaluation error";
      errors.push({ message: msg, row: i });
      results.push({ rowIndex: i, originalValue, transformedValue: originalValue, error: msg });
    }
  }

  return { transformedData, results, errors };
}

// ── GREL Function Reference (for UI help panel) ──

export interface GRELFuncRef {
  category: string;
  syntax: string;
  description: string;
  example: string;
}

export const GREL_REFERENCE: GRELFuncRef[] = [
  // String Methods
  { category: "String", syntax: "value.trim()", description: "Remove leading/trailing whitespace", example: "value.trim()" },
  { category: "String", syntax: "value.toLowercase()", description: "Convert to lowercase", example: 'value.toLowercase()' },
  { category: "String", syntax: "value.toUppercase()", description: "Convert to uppercase", example: "value.toUppercase()" },
  { category: "String", syntax: "value.titlecase()", description: "Convert to Title Case", example: "value.titlecase()" },
  { category: "String", syntax: 'value.replace("old", "new")', description: "Replace first occurrence", example: 'value.replace(" ", "_")' },
  { category: "String", syntax: 'value.replaceAll("old", "new")', description: "Replace all occurrences", example: 'value.replaceAll("a", "b")' },
  { category: "String", syntax: "value.substring(start, end)", description: "Extract substring", example: "value.substring(0, 3)" },
  { category: "String", syntax: 'value.contains("text")', description: "Check if string contains text", example: 'value.contains("test")' },
  { category: "String", syntax: 'value.startsWith("text")', description: "Check if starts with text", example: 'value.startsWith("http")' },
  { category: "String", syntax: 'value.endsWith("text")', description: "Check if ends with text", example: 'value.endsWith(".com")' },
  { category: "String", syntax: "value.length", description: "Get string length", example: "value.length" },
  { category: "String", syntax: 'value.split(",")', description: "Split string by delimiter", example: 'value.split(",")' },
  { category: "String", syntax: "value.reverse()", description: "Reverse string", example: "value.reverse()" },
  { category: "String", syntax: "value.repeat(n)", description: "Repeat string n times", example: "value.repeat(3)" },
  { category: "String", syntax: "value.capitalize()", description: "Capitalize first letter", example: "value.capitalize()" },
  { category: "String", syntax: 'value.matches("regex")', description: "Test against regex", example: 'value.matches("\\d+")' },

  // Number Methods
  { category: "Number", syntax: "value.toNumber()", description: "Convert string to number", example: "value.toNumber()" },
  { category: "Number", syntax: "value.round(n)", description: "Round to n decimals", example: "value.round(2)" },
  { category: "Number", syntax: "value.floor()", description: "Round down to integer", example: "value.floor()" },
  { category: "Number", syntax: "value.ceil()", description: "Round up to integer", example: "value.ceil()" },
  { category: "Number", syntax: "value.abs()", description: "Absolute value", example: "value.abs()" },
  { category: "Number", syntax: "value.mod(n)", description: "Modulo operation", example: "value.mod(10)" },
  { category: "Number", syntax: "value.pow(n)", description: "Power of n", example: "value.pow(2)" },
  { category: "Number", syntax: "value.toString()", description: "Convert number to string", example: "value.toString()" },
  { category: "Number", syntax: "value.toFixed(n)", description: "Format with n decimals", example: "value.toFixed(2)" },
  { category: "Number", syntax: "value.format()", description: "Locale-formatted number", example: "value.format()" },

  // Control Flow
  { category: "Control", syntax: 'if(value == "x", "y", "z")', description: "Conditional expression", example: 'if(value == "yes", 1, 0)' },
  { category: "Control", syntax: "value ? a : b", description: "Ternary shorthand", example: 'value > 10 ? "high" : "low"' },
  { category: "Control", syntax: "coalesce(a, b, c)", description: "First non-null value", example: "coalesce(value, \"N/A\")" },

  // Type Checks
  { category: "Check", syntax: "isBlank(value)", description: "Is null, empty, or blank", example: "isBlank(value)" },
  { category: "Check", syntax: "isNumeric(value)", description: "Is a valid number", example: "isNumeric(value)" },
  { category: "Check", syntax: "isString(value)", description: "Is a string type", example: "isString(value)" },
  { category: "Check", syntax: "typeOf(value)", description: "Get value type name", example: "typeOf(value)" },

  // Cross-cell
  { category: "Cross-cell", syntax: 'cells["ColName"].value', description: "Reference another column", example: 'cells["FullName"].value' },
  { category: "Cross-cell", syntax: 'cells["ColName"].value.trim()', description: "Method on another column", example: 'cells["Dept"].value.toUppercase()' },

  // Operators
  { category: "Operator", syntax: "value + \"text\"", description: "Concatenate / Add", example: 'value + " years"' },
  { category: "Operator", syntax: "value * 100", description: "Multiply", example: "value * 100" },
  { category: "Operator", syntax: 'value == "text"', description: "Equality check", example: 'value == "Active"' },
  { category: "Operator", syntax: "value != \"text\"", description: "Inequality check", example: 'value != "null"' },
  { category: "Operator", syntax: "value > 10", description: "Greater than", example: "value > 50" },
  { category: "Operator", syntax: "value < 10", description: "Less than", example: "value < 10" },
];
