import { getString } from "../utils/locale";

/** Keep the Markdown spelling of keys, including escaped pipes. */
export function tableCells(line: string): string[] {
  const cells = [""];
  const text = line.trim().replace(/^\|/, "");
  for (const token of text.match(/\\.|[^\\|]+|./g) || []) {
    if (token === "|") cells.push("");
    else cells[cells.length - 1] += token;
  }
  if (cells[cells.length - 1] === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

export function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function readTable(markdown: string) {
  const lines = markdown.split("\n");
  const separatorIndex = lines.findIndex(
    (line, i) =>
      i > 0 && lines[i - 1].includes("|") && isTableSeparator(tableCells(line)),
  );
  if (separatorIndex < 1) return undefined;
  const header = lines[separatorIndex - 1].trim();
  const columns = tableCells(header);
  const separator = lines[separatorIndex].trim();
  if (columns.length !== tableCells(separator).length) return undefined;
  let end = separatorIndex + 1;
  while (
    end < lines.length &&
    (header.startsWith("|")
      ? lines[end].trimStart().startsWith("|")
      : lines[end].includes("|"))
  )
    end++;
  const rows = lines.slice(separatorIndex + 1, end);
  return { header, columns, separator, rows, end };
}

export type LiteratureTable = NonNullable<ReturnType<typeof readTable>>;

export function templateForEntries(
  table: LiteratureTable,
  entries: string[],
): string {
  const tail = " |".repeat(table.columns.length - 1);
  return [
    table.header,
    table.separator,
    ...entries.map((entry) => `| ${entry} |${tail}`),
  ].join("\n");
}

export class TableSchemaError extends Error {
  constructor(message = getString("literature-review-table-schema-mismatch")) {
    super(message);
  }
}

/** A full fill must have the template header. Append prompts also allow bare data rows. */
export function checkedTableRows(
  template: LiteratureTable,
  response: string,
  appendKeys?: string[],
): string[] {
  const table = readTable(response);
  if (
    table &&
    (table.columns.length !== template.columns.length ||
      table.columns.some((column, i) => column !== template.columns[i]))
  )
    throw new TableSchemaError();
  if (!table && !appendKeys) throw new TableSchemaError();

  const rows =
    table?.rows ??
    response.split("\n").filter((line) => line.trim().startsWith("|"));
  const keys = appendKeys ?? template.rows.map((row) => tableCells(row)[0]);
  const expected = new Set(keys.filter(Boolean));
  const byKey = new Map<string, string>();
  for (const row of rows) {
    const cells = tableCells(row);
    const key = cells[0];
    // Append has always ignored unsolicited rows and kept the first answer per key.
    if (appendKeys && (!expected.has(key) || byKey.has(key))) continue;
    if (cells.length !== template.columns.length) throw new TableSchemaError();
    byKey.set(key, row);
  }
  const missing = [...expected].filter((key) => !byKey.has(key));
  if (missing.length)
    throw new TableSchemaError(
      getString("literature-review-table-missing-entries", {
        args: { entries: missing.join(", ") },
      }),
    );
  if (
    !appendKeys &&
    keys.length &&
    keys.every(Boolean) &&
    (rows.length !== keys.length ||
      rows.some((row, i) => tableCells(row)[0] !== keys[i]))
  )
    throw new TableSchemaError();
  return appendKeys ? [...expected].map((key) => byKey.get(key)!) : rows;
}
