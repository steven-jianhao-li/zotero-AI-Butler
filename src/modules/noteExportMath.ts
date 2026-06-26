import {
  Math as DocxMath,
  MathFraction,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
  type MathComponent,
} from "docx";

export type MathTextPart = string | DocxMath;

const INLINE_MATH_PATTERN =
  /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g;

export function splitTextWithMath(text: string): MathTextPart[] {
  const parts: MathTextPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_MATH_PATTERN)) {
    const index = match.index || 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    const token = match[0];
    parts.push(latexToDocxMath(token) || token);
    lastIndex = index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function latexToDocxMath(rawLatex: string): DocxMath | null {
  const latex = normalizeLatex(rawLatex);
  if (!latex) return null;
  try {
    return new DocxMath({ children: new LatexMathParser(latex).parse() });
  } catch {
    return null;
  }
}

export function normalizeLatex(rawLatex: string): string {
  let latex = rawLatex.trim();
  latex = latex.replace(/^\$\$([\s\S]*)\$\$$/, "$1");
  latex = latex.replace(/^\$([\s\S]*)\$$/, "$1");
  latex = latex.replace(/^\\\(([\s\S]*)\\\)$/, "$1");
  latex = latex.replace(/^\\\[([\s\S]*)\\\]$/, "$1");
  latex = latex.replace(/^\\displaystyle\s*/, "");
  return latex.trim();
}

class LatexMathParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(stop = ""): MathComponent[] {
    const components: MathComponent[] = [];
    let buffer = "";
    while (this.index < this.input.length) {
      const char = this.input[this.index];
      if (stop && char === stop) {
        this.index += 1;
        break;
      }
      if (char === "}") break;
      if (char === "\\") {
        this.flushBuffer(buffer, components);
        buffer = "";
        components.push(...this.parseCommand());
        continue;
      }
      if (char === "{") {
        this.index += 1;
        this.flushBuffer(buffer, components);
        buffer = "";
        components.push(...this.parse("}"));
        continue;
      }
      if ((char === "_" || char === "^") && (buffer || components.length)) {
        this.flushBuffer(buffer, components);
        buffer = "";
        this.applyScript(components, char);
        continue;
      }
      buffer += mapPlainChar(char);
      this.index += 1;
    }
    this.flushBuffer(buffer, components);
    return components.length ? components : [new MathRun(this.input)];
  }

  private parseCommand(): MathComponent[] {
    this.index += 1;
    const name = this.readCommandName();
    if (name === "frac") {
      return [
        new MathFraction({
          numerator: this.readGroup(),
          denominator: this.readGroup(),
        }),
      ];
    }
    if (["text", "mathrm", "operatorname"].includes(name)) {
      return [new MathRun(this.readRawGroupText())];
    }
    if (name === "tag") {
      return [new MathRun(`(${this.readRawGroupText()})`)];
    }
    return [new MathRun(LATEX_SYMBOLS[name] || name)];
  }

  private applyScript(components: MathComponent[], marker: string): void {
    this.index += 1;
    const base = components.pop();
    if (!base) return;
    const firstScript = this.readScript();
    const next = this.input[this.index];
    if (next && next !== marker && ["_", "^"].includes(next)) {
      this.index += 1;
      const secondScript = this.readScript();
      components.push(
        new MathSubSuperScript({
          children: [base],
          subScript: marker === "_" ? firstScript : secondScript,
          superScript: marker === "^" ? firstScript : secondScript,
        }),
      );
      return;
    }
    components.push(
      marker === "_"
        ? new MathSubScript({ children: [base], subScript: firstScript })
        : new MathSuperScript({ children: [base], superScript: firstScript }),
    );
  }

  private readCommandName(): string {
    let name = "";
    while (/[A-Za-z]/.test(this.input[this.index] || "")) {
      name += this.input[this.index];
      this.index += 1;
    }
    if (!name && this.input[this.index]) {
      name = this.input[this.index];
      this.index += 1;
    }
    return name;
  }

  private readGroup(): MathComponent[] {
    this.skipWhitespace();
    if (this.input[this.index] !== "{") return this.readScript();
    this.index += 1;
    return this.parse("}");
  }

  private readRawGroupText(): string {
    this.skipWhitespace();
    if (this.input[this.index] !== "{") return this.input[this.index++] || "";
    this.index += 1;
    const start = this.index;
    let depth = 1;
    while (this.index < this.input.length && depth > 0) {
      const char = this.input[this.index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      this.index += 1;
    }
    return this.input.slice(start, this.index - 1);
  }

  private readScript(): MathComponent[] {
    this.skipWhitespace();
    if (this.input[this.index] === "{") {
      this.index += 1;
      return this.parse("}");
    }
    if (this.input[this.index] === "\\") return this.parseCommand();
    return [new MathRun(this.input[this.index++] || "")];
  }

  private flushBuffer(buffer: string, components: MathComponent[]): void {
    if (buffer) components.push(new MathRun(buffer));
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.index] || "")) this.index += 1;
  }
}

function mapPlainChar(char: string): string {
  if (char === "~") return " ";
  return char;
}

const LATEX_SYMBOLS: Record<string, string> = {
  cdot: "\u00B7",
  times: "\u00D7",
  leq: "\u2264",
  geq: "\u2265",
  neq: "\u2260",
  approx: "\u2248",
  infty: "\u221E",
  alpha: "\u03B1",
  beta: "\u03B2",
  gamma: "\u03B3",
  delta: "\u03B4",
  lambda: "\u03BB",
  mu: "\u03BC",
  sigma: "\u03C3",
};
