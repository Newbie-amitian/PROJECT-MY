// ============================================================
// Pure JavaScript SQL Executor
// Handles SELECT queries with GROUP BY, WHERE, ORDER BY, LIMIT,
// aggregate functions, arithmetic expressions, and more.
// No external dependencies.
// ============================================================

import type { RawDataRow } from "./dashboard-types";

// ---- Tokenizer ----

interface Token {
  type: "keyword" | "ident" | "number" | "string" | "op" | "comma" | "lparen" | "rparen" | "star" | "dot" | "semicolon";
  value: string;
}

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "ORDER", "HAVING",
  "LIMIT", "AS", "AND", "OR", "NOT", "IN", "LIKE", "IS", "NULL",
  "BETWEEN", "CASE", "WHEN", "THEN", "ELSE", "END", "DISTINCT",
  "ASC", "DESC", "COALESCE", "CAST", "COUNT", "SUM", "AVG", "MIN", "MAX",
  "TRUE", "FALSE", "JOIN", "LEFT", "RIGHT", "INNER", "ON", "TOP",
  "OVER", "PARTITION", "ROW_NUMBER", "RANK", "DENSE_RANK",
  "ROUND", "FLOOR", "CEIL", "ABS", "UPPER", "LOWER", "LENGTH", "TRIM",
  "SUBSTR", "SUBSTRING", "CONCAT", "IF", "IIF", "NULLIF",
  "EXISTS", "UNION", "ALL", "OFFSET",
]);

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Skip line comments
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // Numbers
    if (/\d/.test(ch) || (ch === "." && /\d/.test(sql[i + 1] || ""))) {
      let num = "";
      while (i < sql.length && /[\d.]/.test(sql[i])) {
        num += sql[i++];
      }
      tokens.push({ type: "number", value: num });
      continue;
    }

    // Strings (single quotes)
    if (ch === "'") {
      i++;
      let str = "";
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          str += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          str += sql[i++];
        }
      }
      tokens.push({ type: "string", value: str });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
        ident += sql[i++];
      }
      const upper = ident.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", value: upper });
      } else {
        tokens.push({ type: "ident", value: ident });
      }
      continue;
    }

    // Double-quoted identifiers
    if (ch === '"') {
      i++;
      let ident = "";
      while (i < sql.length && sql[i] !== '"') {
        ident += sql[i++];
      }
      if (i < sql.length) i++; // skip closing quote
      tokens.push({ type: "ident", value: ident });
      continue;
    }

    // Backtick-quoted identifiers
    if (ch === "`") {
      i++;
      let ident = "";
      while (i < sql.length && sql[i] !== "`") {
        ident += sql[i++];
      }
      if (i < sql.length) i++; // skip closing quote
      tokens.push({ type: "ident", value: ident });
      continue;
    }

    // Operators
    if (ch === "(") { tokens.push({ type: "lparen", value: "(" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen", value: ")" }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "comma", value: "," }); i++; continue; }
    if (ch === "*") { tokens.push({ type: "star", value: "*" }); i++; continue; }
    if (ch === ".") { tokens.push({ type: "dot", value: "." }); i++; continue; }
    if (ch === ";") { tokens.push({ type: "semicolon", value: ";" }); i++; continue; }

    // Multi-char operators
    if (ch === "<" && sql[i + 1] === ">") { tokens.push({ type: "op", value: "<>" }); i += 2; continue; }
    if (ch === "!" && sql[i + 1] === "=") { tokens.push({ type: "op", value: "!=" }); i += 2; continue; }
    if (ch === "<" && sql[i + 1] === "=") { tokens.push({ type: "op", value: "<=" }); i += 2; continue; }
    if (ch === ">" && sql[i + 1] === "=") { tokens.push({ type: "op", value: ">=" }); i += 2; continue; }
    if (ch === "=") { tokens.push({ type: "op", value: "=" }); i++; continue; }
    if (ch === "<") { tokens.push({ type: "op", value: "<" }); i++; continue; }
    if (ch === ">") { tokens.push({ type: "op", value: ">" }); i++; continue; }
    if (ch === "+") { tokens.push({ type: "op", value: "+" }); i++; continue; }
    if (ch === "-") { tokens.push({ type: "op", value: "-" }); i++; continue; }
    if (ch === "/") { tokens.push({ type: "op", value: "/" }); i++; continue; }
    if (ch === "%") { tokens.push({ type: "op", value: "%" }); i++; continue; }

    // Skip unknown
    i++;
  }

  return tokens;
}

// ---- Expression Parser ----

type ExprVal = string | number | boolean | null;
type ExprNode =
  | { type: "column"; name: string }
  | { type: "literal"; value: ExprVal }
  | { type: "star" }
  | { type: "function"; name: string; args: ExprNode[]; distinct?: boolean }
  | { type: "binary"; op: string; left: ExprNode; right: ExprNode }
  | { type: "unary"; op: string; operand: ExprNode }
  | { type: "case"; whens: { condition: ExprNode; result: ExprNode }[]; elseExpr?: ExprNode }
  | { type: "in"; expr: ExprNode; values: ExprNode[]; not?: boolean }
  | { type: "isnull"; expr: ExprNode; not?: boolean }
  | { type: "like"; expr: ExprNode; pattern: string; not?: boolean }
  | { type: "between"; expr: ExprNode; low: ExprNode; high: ExprNode; not?: boolean }
  | { type: "coalesce"; args: ExprNode[] };

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  advance(): Token | null {
    return this.tokens[this.pos++] ?? null;
  }

  expect(type: Token["type"], value?: string): Token {
    const tok = this.advance();
    if (!tok || tok.type !== type || (value !== undefined && tok.value.toUpperCase() !== value.toUpperCase())) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ""} but got ${tok ? `${tok.type} '${tok.value}'` : "EOF"}`);
    }
    return tok;
  }

  match(type: Token["type"], value?: string): Token | null {
    const tok = this.peek();
    if (!tok || tok.type !== type) return null;
    if (value !== undefined && tok.value.toUpperCase() !== value.toUpperCase()) return null;
    return this.advance();
  }

  matchKeyword(...values: string[]): Token | null {
    const tok = this.peek();
    if (!tok || tok.type !== "keyword") return null;
    if (values.length > 0 && !values.includes(tok.value.toUpperCase())) return null;
    return this.advance();
  }

  atKeyword(...values: string[]): boolean {
    const tok = this.peek();
    return tok !== null && tok.type === "keyword" && values.includes(tok.value.toUpperCase());
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  // ---- Main query parsing ----

  parseSelect(): {
    distinct: boolean;
    columns: { expr: ExprNode; alias?: string }[];
    from: string;
    where?: ExprNode;
    groupBy?: string[];
    having?: ExprNode;
    orderBy?: { expr: ExprNode; dir: "ASC" | "DESC" }[];
    limit?: number;
    offset?: number;
  } {
    this.expect("keyword", "SELECT");

    const distinct = !!this.matchKeyword("DISTINCT");

    // Parse select columns
    const columns: { expr: ExprNode; alias?: string }[] = [];
    columns.push(this.parseSelectColumn());
    while (this.match("comma")) {
      columns.push(this.parseSelectColumn());
    }

    // FROM
    this.expect("keyword", "FROM");
    const fromToken = this.advance();
    if (!fromToken) throw new Error("Expected table name after FROM");
    const from = fromToken.value;

    // WHERE
    let where: ExprNode | undefined;
    if (this.matchKeyword("WHERE")) {
      where = this.parseExpression();
    }

    // GROUP BY
    let groupBy: string[] | undefined;
    if (this.atKeyword("GROUP")) {
      this.advance();
      this.expect("keyword", "BY");
      groupBy = [this.parseIdentName()];
      while (this.match("comma")) {
        groupBy.push(this.parseIdentName());
      }
    }

    // HAVING
    let having: ExprNode | undefined;
    if (this.matchKeyword("HAVING")) {
      having = this.parseExpression();
    }

    // ORDER BY
    let orderBy: { expr: ExprNode; dir: "ASC" | "DESC" }[] | undefined;
    if (this.atKeyword("ORDER")) {
      this.advance();
      this.expect("keyword", "BY");
      orderBy = [this.parseOrderByItem()];
      while (this.match("comma")) {
        orderBy.push(this.parseOrderByItem());
      }
    }

    // LIMIT
    let limit: number | undefined;
    if (this.matchKeyword("LIMIT")) {
      const numTok = this.advance();
      limit = numTok ? parseInt(numTok.value, 10) : undefined;
    }

    // OFFSET
    let offset: number | undefined;
    if (this.matchKeyword("OFFSET")) {
      const numTok = this.advance();
      offset = numTok ? parseInt(numTok.value, 10) : undefined;
    }

    return { distinct, columns, from, where, groupBy, having, orderBy, limit, offset };
  }

  parseSelectColumn(): { expr: ExprNode; alias?: string } {
    const expr = this.parseExpression();
    let alias: string | undefined;
    if (this.matchKeyword("AS")) {
      alias = this.parseIdentName();
    } else {
      // Check for implicit alias (identifier after expression, not a keyword)
      const next = this.peek();
      if (
        next && next.type === "ident" &&
        !this.atKeyword("FROM", "WHERE", "GROUP", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION", "JOIN")
      ) {
        alias = this.advance()!.value;
      }
    }
    return { expr, alias };
  }

  parseOrderByItem(): { expr: ExprNode; dir: "ASC" | "DESC" } {
    const expr = this.parseExpression();
    let dir: "ASC" | "DESC" = "ASC";
    if (this.matchKeyword("DESC")) {
      dir = "DESC";
    } else {
      this.matchKeyword("ASC");
    }
    return { expr, dir };
  }

  parseIdentName(): string {
    const tok = this.peek();
    if (tok && tok.type === "ident") return this.advance()!.value;
    if (tok && tok.type === "string") return this.advance()!.value;
    if (tok && tok.type === "keyword") return this.advance()!.value;
    throw new Error(`Expected identifier but got ${tok ? `${tok.type} '${tok.value}'` : "EOF"}`);
  }

  // ---- Expression parsing (precedence climbing) ----

  parseExpression(): ExprNode {
    return this.parseOrExpr();
  }

  parseOrExpr(): ExprNode {
    let left = this.parseAndExpr();
    while (this.matchKeyword("OR")) {
      const right = this.parseAndExpr();
      left = { type: "binary", op: "OR", left, right };
    }
    return left;
  }

  parseAndExpr(): ExprNode {
    let left = this.parseNotExpr();
    while (this.matchKeyword("AND")) {
      const right = this.parseNotExpr();
      left = { type: "binary", op: "AND", left, right };
    }
    return left;
  }

  parseNotExpr(): ExprNode {
    if (this.matchKeyword("NOT")) {
      const operand = this.parseNotExpr();
      return { type: "unary", op: "NOT", operand };
    }
    return this.parseComparisonExpr();
  }

  parseComparisonExpr(): ExprNode {
    let left = this.parseAddExpr();

    // IS [NOT] NULL
    if (this.atKeyword("IS")) {
      this.advance();
      const not = !!this.matchKeyword("NOT");
      this.expect("keyword", "NULL");
      return { type: "isnull", expr: left, not };
    }

    // [NOT] IN (...)
    const notIn = this.atKeyword("NOT") ? (this.peek()!.value.toUpperCase() === "NOT" && this.tokens[this.pos + 1]?.value.toUpperCase() === "IN") : false;
    if (notIn) {
      this.advance(); // NOT
      this.expect("keyword", "IN");
      return this.parseInExpr(left, true);
    }
    if (this.matchKeyword("IN")) {
      return this.parseInExpr(left, false);
    }

    // [NOT] LIKE
    const notLike = this.atKeyword("NOT") ? (this.tokens[this.pos + 1]?.value.toUpperCase() === "LIKE") : false;
    if (notLike) {
      this.advance(); // NOT
      this.expect("keyword", "LIKE");
      return this.parseLikeExpr(left, true);
    }
    if (this.matchKeyword("LIKE")) {
      return this.parseLikeExpr(left, false);
    }

    // [NOT] BETWEEN
    const notBetween = this.atKeyword("NOT") ? (this.tokens[this.pos + 1]?.value.toUpperCase() === "BETWEEN") : false;
    if (notBetween) {
      this.advance(); // NOT
      this.expect("keyword", "BETWEEN");
      return this.parseBetweenExpr(left, true);
    }
    if (this.matchKeyword("BETWEEN")) {
      return this.parseBetweenExpr(left, false);
    }

    // Comparison operators
    const compOps = ["=", "!=", "<>", "<", ">", "<=", ">="];
    const tok = this.peek();
    if (tok && tok.type === "op" && compOps.includes(tok.value)) {
      this.advance();
      const right = this.parseAddExpr();
      return { type: "binary", op: tok.value, left, right };
    }

    return left;
  }

  parseInExpr(expr: ExprNode, not: boolean): ExprNode {
    this.expect("lparen");
    const values: ExprNode[] = [];
    values.push(this.parseExpression());
    while (this.match("comma")) {
      values.push(this.parseExpression());
    }
    this.expect("rparen");
    return { type: "in", expr, values, not };
  }

  parseLikeExpr(expr: ExprNode, not: boolean): ExprNode {
    const patternTok = this.advance();
    const pattern = patternTok?.type === "string" ? patternTok.value : "";
    return { type: "like", expr, pattern, not };
  }

  parseBetweenExpr(expr: ExprNode, not: boolean): ExprNode {
    const low = this.parseAddExpr();
    this.expect("keyword", "AND");
    const high = this.parseAddExpr();
    return { type: "between", expr, low, high, not };
  }

  parseAddExpr(): ExprNode {
    let left = this.parseMulExpr();
    while (this.peek() && this.peek()!.type === "op" && ["+", "-"].includes(this.peek()!.value)) {
      const op = this.advance()!.value;
      const right = this.parseMulExpr();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  parseMulExpr(): ExprNode {
    let left = this.parseUnaryExpr();
    while (this.peek() && ((this.peek()!.type === "op" && ["*", "/", "%"].includes(this.peek()!.value)) || (this.peek()!.type === "star" && !this._isStarContext()))) {
      const op = this.advance()!.value;
      const right = this.parseUnaryExpr();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  /** Check if * should be treated as SELECT-star rather than multiply */
  private _isStarContext(): boolean {
    // star after . is table.* syntax — not multiplication
    return false;
  }

  parseUnaryExpr(): ExprNode {
    const tok = this.peek();
    if (tok && tok.type === "op" && tok.value === "-") {
      this.advance();
      const operand = this.parsePrimaryExpr();
      return { type: "unary", op: "-", operand };
    }
    return this.parsePrimaryExpr();
  }

  parsePrimaryExpr(): ExprNode {
    const tok = this.peek();

    if (!tok) throw new Error("Unexpected end of input");

    // NULL literal
    if (tok.type === "keyword" && tok.value === "NULL") {
      this.advance();
      return { type: "literal", value: null };
    }

    // TRUE/FALSE literals
    if (tok.type === "keyword" && tok.value === "TRUE") {
      this.advance();
      return { type: "literal", value: true };
    }
    if (tok.type === "keyword" && tok.value === "FALSE") {
      this.advance();
      return { type: "literal", value: false };
    }

    // CASE expression
    if (tok.type === "keyword" && tok.value === "CASE") {
      return this.parseCaseExpr();
    }

    // CAST expression
    if (tok.type === "keyword" && tok.value === "CAST") {
      return this.parseCastExpr();
    }

    // Number literal
    if (tok.type === "number") {
      this.advance();
      return { type: "literal", value: parseFloat(tok.value) };
    }

    // String literal
    if (tok.type === "string") {
      this.advance();
      return { type: "literal", value: tok.value };
    }

    // Star (SELECT * or table.*)
    if (tok.type === "star") {
      this.advance();
      return { type: "star" };
    }

    // Parenthesized expression
    if (tok.type === "lparen") {
      this.advance();
      const expr = this.parseExpression();
      this.expect("rparen");
      return expr;
    }

    // Function call or column name
    if (tok.type === "keyword" || tok.type === "ident") {
      const funcNames = [
        "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST",
        "ROUND", "FLOOR", "CEIL", "ABS", "UPPER", "LOWER", "LENGTH",
        "TRIM", "SUBSTR", "SUBSTRING", "CONCAT", "IF", "IIF", "NULLIF",
        "ROW_NUMBER", "RANK", "DENSE_RANK", "YEAR", "MONTH", "DAY",
        "DATE", "DATETIME", "LEFT", "RIGHT", "REPLACE", "LPAD", "RPAD",
        "REPEAT", "REVERSE", "SPACE", "STRFTIME", "PRINTF",
      ];

      const isFunc = funcNames.includes(tok.value.toUpperCase()) && this.tokens[this.pos + 1]?.type === "lparen";

      if (isFunc) {
        const funcName = this.advance()!.value.toUpperCase();
        this.expect("lparen");

        // Handle DISTINCT inside function
        let distinct = false;
        if (funcName === "COUNT" && this.matchKeyword("DISTINCT")) {
          distinct = true;
        }

        const args: ExprNode[] = [];
        if (this.peek()?.type !== "rparen") {
          args.push(this.parseExpression());
          while (this.match("comma")) {
            args.push(this.parseExpression());
          }
        }
        this.expect("rparen");

        // Special handling for COALESCE
        if (funcName === "COALESCE") {
          return { type: "coalesce", args };
        }

        return { type: "function", name: funcName, args, distinct };
      }

      // Column name - could be qualified (table.column)
      const name = this.advance()!.value;
      if (this.peek()?.type === "dot") {
        this.advance(); // skip dot
        const next = this.advance();
        if (next && next.type === "star") {
          return { type: "star" };
        }
        return { type: "column", name: next ? next.value : name };
      }

      return { type: "column", name };
    }

    throw new Error(`Unexpected token: ${tok.type} '${tok.value}'`);
  }

  parseCaseExpr(): ExprNode {
    this.expect("keyword", "CASE");

    const whens: { condition: ExprNode; result: ExprNode }[] = [];

    // Check if there's a CASE <expr> WHEN pattern
    if (!this.atKeyword("WHEN")) {
      // Simple CASE - we just consume the operand and treat it like searched CASE
      this.parseExpression();
    }

    while (this.matchKeyword("WHEN")) {
      const condition = this.parseExpression();
      this.expect("keyword", "THEN");
      const result = this.parseExpression();
      whens.push({ condition, result });
    }

    let elseExpr: ExprNode | undefined;
    if (this.matchKeyword("ELSE")) {
      elseExpr = this.parseExpression();
    }

    this.expect("keyword", "END");
    return { type: "case", whens, elseExpr };
  }

  parseCastExpr(): ExprNode {
    this.expect("keyword", "CAST");
    this.expect("lparen");
    const expr = this.parseExpression();
    this.expect("keyword", "AS");
    // Skip the type (just consume tokens until rparen)
    while (this.peek()?.type !== "rparen" && !this.atEnd()) {
      this.advance();
    }
    this.expect("rparen");
    return expr; // Simplified: just return the expression
  }
}

// ---- Expression Evaluator ----

interface RowContext {
  row: RawDataRow;
  groupRows?: RawDataRow[];
  groupKey?: string;
  rowIndex?: number;
}

function evaluateExpr(expr: ExprNode, ctx: RowContext): ExprVal {
  switch (expr.type) {
    case "literal":
      return expr.value;

    case "column":
      return ctx.row[expr.name] ?? null;

    case "star":
      return "*";

    case "binary": {
      const left = evaluateExpr(expr.left, ctx);
      const right = evaluateExpr(expr.right, ctx);

      if (expr.op === "AND") return Boolean(left) && Boolean(right);
      if (expr.op === "OR") return Boolean(left) || Boolean(right);

      // Arithmetic
      if (expr.op === "+") return toNum(left) + toNum(right);
      if (expr.op === "-") return toNum(left) - toNum(right);
      if (expr.op === "*") return toNum(left) * toNum(right);
      if (expr.op === "/") return toNum(right) !== 0 ? toNum(left) / toNum(right) : null;
      if (expr.op === "%") return toNum(right) !== 0 ? toNum(left) % toNum(right) : null;

      // Comparison
      if (expr.op === "=") return left === right;
      if (expr.op === "!=" || expr.op === "<>") return left !== right;
      if (expr.op === "<") return compare(left, right) < 0;
      if (expr.op === ">") return compare(left, right) > 0;
      if (expr.op === "<=") return compare(left, right) <= 0;
      if (expr.op === ">=") return compare(left, right) >= 0;

      return null;
    }

    case "unary": {
      const val = evaluateExpr(expr.operand, ctx);
      if (expr.op === "-") return val === null ? null : -toNum(val);
      if (expr.op === "NOT") return !val;
      return val;
    }

    case "function": {
      const fname = expr.name;
      const args = expr.args;

      switch (fname) {
        case "COUNT": {
          if (expr.distinct && ctx.groupRows) {
            const values = ctx.groupRows.map(r => evaluateExpr(args[0], { ...ctx, row: r }));
            return new Set(values.filter(v => v !== null && v !== undefined)).size;
          }
          if (ctx.groupRows) {
            if (args.length === 0 || (args[0].type === "star")) return ctx.groupRows.length;
            return ctx.groupRows.filter(r => {
              const v = evaluateExpr(args[0], { ...ctx, row: r });
              return v !== null && v !== undefined;
            }).length;
          }
          return 1;
        }

        case "SUM": {
          if (!ctx.groupRows) return toNum(evaluateExpr(args[0], ctx));
          const vals = ctx.groupRows
            .map(r => toNum(evaluateExpr(args[0], { ...ctx, row: r })))
            .filter(v => !isNaN(v));
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
        }

        case "AVG": {
          if (!ctx.groupRows) return toNum(evaluateExpr(args[0], ctx));
          const vals = ctx.groupRows
            .map(r => toNum(evaluateExpr(args[0], { ...ctx, row: r })))
            .filter(v => !isNaN(v));
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        }

        case "MIN": {
          if (!ctx.groupRows) return evaluateExpr(args[0], ctx);
          const vals = ctx.groupRows
            .map(r => evaluateExpr(args[0], { ...ctx, row: r }))
            .filter(v => v !== null && v !== undefined);
          if (vals.length === 0) return null;
          return vals.sort((a, b) => compare(a as ExprVal, b as ExprVal))[0];
        }

        case "MAX": {
          if (!ctx.groupRows) return evaluateExpr(args[0], ctx);
          const vals = ctx.groupRows
            .map(r => evaluateExpr(args[0], { ...ctx, row: r }))
            .filter(v => v !== null && v !== undefined);
          if (vals.length === 0) return null;
          const sorted = vals.sort((a, b) => compare(a as ExprVal, b as ExprVal));
          return sorted[sorted.length - 1];
        }

        case "COALESCE":
          for (const arg of args) {
            const v = evaluateExpr(arg, ctx);
            if (v !== null && v !== undefined) return v;
          }
          return null;

        case "ROUND":
          if (args.length >= 2) {
            return roundNum(toNum(evaluateExpr(args[0], ctx)), toNum(evaluateExpr(args[1], ctx)));
          }
          return roundNum(toNum(evaluateExpr(args[0], ctx)), 0);

        case "FLOOR":
          return Math.floor(toNum(evaluateExpr(args[0], ctx)));

        case "CEIL":
          return Math.ceil(toNum(evaluateExpr(args[0], ctx)));

        case "ABS":
          return Math.abs(toNum(evaluateExpr(args[0], ctx)));

        case "UPPER":
          return String(evaluateExpr(args[0], ctx) ?? "").toUpperCase();

        case "LOWER":
          return String(evaluateExpr(args[0], ctx) ?? "").toLowerCase();

        case "LENGTH":
          return String(evaluateExpr(args[0], ctx) ?? "").length;

        case "TRIM":
          return String(evaluateExpr(args[0], ctx) ?? "").trim();

        case "LEFT":
          return String(evaluateExpr(args[0], ctx) ?? "").slice(0, toNum(evaluateExpr(args[1], ctx)));

        case "RIGHT": {
          const s = String(evaluateExpr(args[0], ctx) ?? "");
          const n = toNum(evaluateExpr(args[1], ctx));
          return s.slice(-n);
        }

        case "SUBSTR":
        case "SUBSTRING":
          return String(evaluateExpr(args[0], ctx) ?? "").slice(
            toNum(evaluateExpr(args[1], ctx)) - 1,
            args.length >= 3 ? toNum(evaluateExpr(args[1], ctx)) - 1 + toNum(evaluateExpr(args[2], ctx)) : undefined
          );

        case "CONCAT":
          return args.map(a => String(evaluateExpr(a, ctx) ?? "")).join("");

        case "REPLACE": {
          const str = String(evaluateExpr(args[0], ctx) ?? "");
          const from = String(evaluateExpr(args[1], ctx) ?? "");
          const to = String(evaluateExpr(args[2], ctx) ?? "");
          return str.split(from).join(to);
        }

        case "IF":
        case "IIF": {
          const cond = evaluateExpr(args[0], ctx);
          return Boolean(cond) ? evaluateExpr(args[1], ctx) : (args[2] ? evaluateExpr(args[2], ctx) : null);
        }

        case "NULLIF": {
          const a = evaluateExpr(args[0], ctx);
          const b = evaluateExpr(args[1], ctx);
          return a === b ? null : a;
        }

        case "YEAR":
        case "MONTH":
        case "DAY": {
          const dateStr = String(evaluateExpr(args[0], ctx) ?? "");
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) return null;
          if (fname === "YEAR") return d.getFullYear();
          if (fname === "MONTH") return d.getMonth() + 1;
          return d.getDate();
        }

        case "ROW_NUMBER":
          return (ctx.rowIndex ?? 0) + 1;

        default:
          // Unknown function - try to evaluate first arg
          return args.length > 0 ? evaluateExpr(args[0], ctx) : null;
      }
    }

    case "case": {
      for (const when of expr.whens) {
        if (Boolean(evaluateExpr(when.condition, ctx))) {
          return evaluateExpr(when.result, ctx);
        }
      }
      return expr.elseExpr ? evaluateExpr(expr.elseExpr, ctx) : null;
    }

    case "in": {
      const val = evaluateExpr(expr.expr, ctx);
      const values = expr.values.map(v => evaluateExpr(v, ctx));
      const match = values.includes(val);
      return expr.not ? !match : match;
    }

    case "isnull": {
      const val = evaluateExpr(expr.expr, ctx);
      const isNull = val === null || val === undefined;
      return expr.not ? !isNull : isNull;
    }

    case "like": {
      const val = String(evaluateExpr(expr.expr, ctx) ?? "");
      // Convert SQL LIKE pattern to regex
      const regex = new RegExp(
        "^" + expr.pattern.replace(/%/g, ".*").replace(/_/g, ".") + "$",
        "i"
      );
      const match = regex.test(val);
      return expr.not ? !match : match;
    }

    case "between": {
      const val = evaluateExpr(expr.expr, ctx);
      const low = evaluateExpr(expr.low, ctx);
      const high = evaluateExpr(expr.high, ctx);
      const result = compare(val as ExprVal, low as ExprVal) >= 0 && compare(val as ExprVal, high as ExprVal) <= 0;
      return expr.not ? !result : result;
    }

    case "coalesce":
      for (const arg of expr.args) {
        const v = evaluateExpr(arg, ctx);
        if (v !== null && v !== undefined) return v;
      }
      return null;

    default:
      return null;
  }
}

// ---- Helpers ----

function toNum(val: ExprVal): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "boolean") return val ? 1 : 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function roundNum(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function compare(a: ExprVal, b: ExprVal): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;

  // If both are numbers, compare numerically
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;

  // Otherwise string comparison
  return String(a).localeCompare(String(b));
}

function exprToColumnName(expr: ExprNode, alias?: string): string {
  if (alias) return alias;
  switch (expr.type) {
    case "column": return expr.name;
    case "star": return "*";
    case "literal": return String(expr.value ?? "NULL");
    case "function": {
      const argsStr = expr.args.map(a => exprToColumnName(a)).join(", ");
      return `${expr.name}(${expr.distinct ? "DISTINCT " : ""}${argsStr})`;
    }
    case "binary": {
      const left = exprToColumnName(expr.left);
      const right = exprToColumnName(expr.right);
      return `${left} ${expr.op} ${right}`;
    }
    case "unary": return `${expr.op}${exprToColumnName(expr.operand)}`;
    case "case": return "CASE";
    case "coalesce": return `COALESCE(${expr.args.map(a => exprToColumnName(a)).join(", ")})`;
    default: return "?";
  }
}

function hasAggregateFunction(expr: ExprNode): boolean {
  switch (expr.type) {
    case "function":
      if (["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(expr.name)) return true;
      return expr.args.some(hasAggregateFunction);
    case "binary":
      return hasAggregateFunction(expr.left) || hasAggregateFunction(expr.right);
    case "unary":
      return hasAggregateFunction(expr.operand);
    case "case":
      return expr.whens.some(w => hasAggregateFunction(w.condition) || hasAggregateFunction(w.result)) ||
        (expr.elseExpr ? hasAggregateFunction(expr.elseExpr) : false);
    case "coalesce":
      return expr.args.some(hasAggregateFunction);
    default:
      return false;
  }
}

// ---- Main Executor ----

export interface SQLResult {
  columns: string[];
  rows: (string | number | null)[][];
  rowCount: number;
  executionTimeMs: number;
}

export function executeSQL(data: RawDataRow[], sql: string): SQLResult {
  const startTime = performance.now();

  try {
    // Tokenize
    const tokens = tokenize(sql.trim());

    // Parse
    const parser = new Parser(tokens);
    const query = parser.parseSelect();

    // Step 1: Filter with WHERE
    let filtered = data;
    if (query.where) {
      filtered = data.filter(row => {
        const result = evaluateExpr(query.where!, { row });
        return Boolean(result);
      });
    }

    // Step 2: GROUP BY or not
    const isGrouped = query.groupBy && query.groupBy.length > 0;
    const hasAggregates = query.columns.some(c => hasAggregateFunction(c.expr));

    let resultRows: { row: RawDataRow; groupRows?: RawDataRow[]; rowIndex?: number }[];

    if (isGrouped || hasAggregates) {
      // Group the data
      const groups = new Map<string, RawDataRow[]>();
      const groupKeys = query.groupBy || [];

      if (groupKeys.length > 0) {
        filtered.forEach(row => {
          const key = groupKeys.map(k => String(row[k] ?? "NULL")).join("|||");
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(row);
        });
      } else {
        // No GROUP BY but has aggregates - treat all rows as one group
        groups.set("__all__", filtered);
      }

      resultRows = Array.from(groups.entries()).map(([key, groupRows]) => {
        // Create a representative row with group key columns
        const representativeRow: RawDataRow = {};
        if (groupKeys.length > 0) {
          const keyParts = key.split("|||");
          groupKeys.forEach((k, i) => {
            representativeRow[k] = keyParts[i] === "NULL" ? null : keyParts[i];
          });
        }
        return { row: representativeRow, groupRows };
      });
    } else {
      // No grouping, no aggregates - just map each row
      resultRows = filtered.map((row, idx) => ({ row, rowIndex: idx }));
    }

    // Step 3: Evaluate SELECT columns for each result row
    const columnNames: string[] = [];
    const needsAllColumns = query.columns.some(c => c.expr.type === "star");

    if (needsAllColumns && data.length > 0) {
      // Expand * to all columns
      const allCols = Object.keys(data[0]);
      query.columns = allCols.map(c => ({
        expr: { type: "column" as const, name: c },
        alias: c,
      }));
    }

    // Build column names (check for duplicates)
    const colNameCounts = new Map<string, number>();
    const finalColumns: { expr: ExprNode; alias: string }[] = [];
    for (const col of query.columns) {
      const name = exprToColumnName(col.expr, col.alias);
      const count = colNameCounts.get(name) ?? 0;
      colNameCounts.set(name, count + 1);
      const finalName = count > 0 ? `${name}_${count + 1}` : name;
      finalColumns.push({ expr: col.expr, alias: finalName });
      columnNames.push(finalName);
    }

    // Evaluate each row
    const evaluatedRows: (string | number | null)[][] = [];

    for (const item of resultRows) {
      const rowValues: (string | number | null)[] = [];
      const ctx: RowContext = {
        row: item.row,
        groupRows: item.groupRows,
        rowIndex: item.rowIndex,
      };

      for (const col of finalColumns) {
        const val = evaluateExpr(col.expr, ctx);
        if (val === null || val === undefined) {
          rowValues.push(null);
        } else if (typeof val === "number") {
          rowValues.push(Math.round(val * 100) / 100);
        } else if (typeof val === "boolean") {
          rowValues.push(val ? 1 : 0);
        } else {
          rowValues.push(String(val));
        }
      }

      evaluatedRows.push(rowValues);
    }

    // Step 4: DISTINCT
    if (query.distinct) {
      const seen = new Set<string>();
      const unique: (string | number | null)[][] = [];
      for (const row of evaluatedRows) {
        const key = JSON.stringify(row);
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(row);
        }
      }
      evaluatedRows.length = 0;
      evaluatedRows.push(...unique);
    }

    // Step 5: HAVING
    let finalRows = evaluatedRows;
    if (query.having && isGrouped) {
      // Re-filter with having (re-evaluate against the grouped data)
      const groups = new Map<string, RawDataRow[]>();
      const groupKeys = query.groupBy || [];

      filtered.forEach(row => {
        const key = groupKeys.map(k => String(row[k] ?? "NULL")).join("|||");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      });

      finalRows = [];
      const groupEntries = Array.from(groups.entries());
      for (let i = 0; i < evaluatedRows.length; i++) {
        if (i < groupEntries.length) {
          const representativeRow: RawDataRow = {};
          if (groupKeys.length > 0) {
            const keyParts = groupEntries[i][0].split("|||");
            groupKeys.forEach((k, j) => {
              representativeRow[k] = keyParts[j] === "NULL" ? null : keyParts[j];
            });
          }
          const ctx: RowContext = {
            row: representativeRow,
            groupRows: groupEntries[i][1],
          };
          if (Boolean(evaluateExpr(query.having, ctx))) {
            finalRows.push(evaluatedRows[i]);
          }
        }
      }
    }

    // Step 6: ORDER BY
    if (query.orderBy && query.orderBy.length > 0) {
      // We need to create a lookup from column alias to index
      const colIndexMap = new Map<string, number>();
      columnNames.forEach((name, idx) => colIndexMap.set(name.toLowerCase(), idx));

      finalRows.sort((a, b) => {
        for (const orderItem of query.orderBy!) {
          let valA: ExprVal;
          let valB: ExprVal;

          // Try to resolve the ORDER BY expression to a column index
          const colName = exprToColumnName(orderItem.expr).toLowerCase();
          const idx = colIndexMap.get(colName);

          if (idx !== undefined) {
            valA = a[idx];
            valB = b[idx];
          } else {
            // Fallback: try numeric interpretation
            valA = a[0];
            valB = b[0];
          }

          const cmp = compare(valA as ExprVal, valB as ExprVal);
          if (cmp !== 0) {
            return orderItem.dir === "DESC" ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    // Step 7: LIMIT + OFFSET
    let limitedRows = finalRows;
    const offset = query.offset || 0;
    if (offset > 0) {
      limitedRows = limitedRows.slice(offset);
    }
    if (query.limit !== undefined) {
      limitedRows = limitedRows.slice(0, query.limit);
    }

    const executionTime = performance.now() - startTime;

    return {
      columns: columnNames,
      rows: limitedRows,
      rowCount: limitedRows.length,
      executionTimeMs: Math.round(executionTime),
    };
  } catch (error) {
    const executionTime = performance.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);

    return {
      columns: ["Error"],
      rows: [[message]],
      rowCount: 1,
      executionTimeMs: Math.round(executionTime),
    };
  }
}
