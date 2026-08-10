import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [julyPath, augustPath, outputDir] = process.argv.slice(2);

if (!julyPath || !augustPath || !outputDir) {
  throw new Error("Usage: node build_orphan_filtered.mjs <july.xlsx> <august.xlsx> <output-dir>");
}

await fs.mkdir(outputDir, { recursive: true });

async function loadWorkbook(filePath) {
  return SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
}

const julyWorkbook = await loadWorkbook(julyPath);
const augustWorkbook = await loadWorkbook(augustPath);

const julySheet = julyWorkbook.worksheets.getItem("Sheet");
const augustSheet = augustWorkbook.worksheets.getItem("Sheet");
const julyUsedRange = julySheet.getUsedRange(true);
const augustUsedRange = augustSheet.getUsedRange(true);
const julyRows = julyUsedRange.values;
const augustRows = augustUsedRange.values;

if (process.env.ANALYZE_HEADERS === "1") {
  const headers = augustRows[0].map((value, index) => ({
    index,
    column: columnName(index + 1),
    header: String(value ?? "").replaceAll("\n", " ").trim(),
  }));
  const candidateHeaders = headers.filter(({ header }) =>
    /판매|매출|사입|매입|입고|출고|수량|누적|최근|일자|일시/.test(header),
  );
  const samples = candidateHeaders.map(({ index, column, header }) => ({
    index,
    column,
    header,
    july: julyRows.slice(1, 8).map((row) => row[index]),
    august: augustRows.slice(1, 8).map((row) => row[index]),
  }));
  console.log(JSON.stringify({ headers, candidateHeaders, samples }, null, 2));
  process.exit(0);
}

function columnName(columnCount) {
  let value = columnCount;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function summarize(rows, label) {
  const headers = rows[0].map((value) => String(value ?? "").trim());
  const codeIndex = headers.indexOf("상품코드");
  const nameIndex = headers.indexOf("상품명");
  const stockIndex = headers.indexOf("현재고");
  const recentPurchaseIndex = headers.indexOf("최근매입일");
  const recentSaleIndex = headers.indexOf("최근매출일");
  const codeCounts = new Map();
  const invalidStocks = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const code = String(row[codeIndex] ?? "").trim();
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    const stock = row[stockIndex];
    if (typeof stock !== "number" || !Number.isFinite(stock)) {
      invalidStocks.push({ row: index + 1, code, name: row[nameIndex], stock });
    }
  }
  return {
    label,
    rowCount: rows.length - 1,
    codeIndex,
    nameIndex,
    stockIndex,
    recentPurchaseIndex,
    recentSaleIndex,
    blankCodes: codeCounts.get("") ?? 0,
    duplicateCodes: [...codeCounts.entries()].filter(([, count]) => count > 1),
    invalidStocks: invalidStocks.slice(0, 20),
    invalidStockCount: invalidStocks.length,
  };
}

const julySummary = summarize(julyRows, "july");
const augustSummary = summarize(augustRows, "august");

for (const summary of [julySummary, augustSummary]) {
  if (
    summary.codeIndex < 0 ||
    summary.nameIndex < 0 ||
    summary.stockIndex < 0 ||
    summary.recentPurchaseIndex < 0 ||
    summary.recentSaleIndex < 0
  ) {
    throw new Error(`${summary.label}: 필수 헤더를 찾을 수 없습니다.`);
  }
  if (summary.blankCodes > 0 || summary.duplicateCodes.length > 0) {
    throw new Error(`${summary.label}: 상품코드가 비어 있거나 중복되었습니다.`);
  }
  if (summary.invalidStockCount > 0) {
    throw new Error(`${summary.label}: 현재고가 숫자가 아닌 행이 있습니다.`);
  }
}

if (JSON.stringify(julyRows[0]) !== JSON.stringify(augustRows[0])) {
  throw new Error("두 파일의 헤더 구조가 다릅니다.");
}

const sourceFormulaInspection = await augustWorkbook.inspect({
  kind: "formula",
  sheetId: "Sheet",
  range: augustUsedRange.address,
  maxChars: 1000,
  options: { maxResults: 1 },
});
const sourceHasFormula = sourceFormulaInspection.ndjson
  .split("\n")
  .filter(Boolean)
  .some((line) => JSON.parse(line).kind === "formula");
if (sourceHasFormula) {
  throw new Error("8월 7일 파일에 수식이 있어 값만 재배치할 수 없습니다.");
}

const julyByCode = new Map(
  julyRows.slice(1).map((row) => [String(row[julySummary.codeIndex] ?? "").trim(), row]),
);
const periodStart = "2026-07-18";
const periodEnd = "2026-08-07";

function cellDateToIso(value, context) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + Math.floor(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const match = String(value).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) {
    throw new Error(`${context}: 날짜 형식을 해석할 수 없습니다: ${String(value)}`);
  }
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function isInPeriod(value, context) {
  const isoDate = cellDateToIso(value, context);
  return isoDate !== null && isoDate >= periodStart && isoDate <= periodEnd;
}

const comparison = {
  unchanged: 0,
  unchangedZeroStock: 0,
  unchangedNonZeroStock: 0,
  unchangedWithPeriodSale: 0,
  unchangedWithPeriodSaleZeroStock: 0,
  unchangedWithPeriodSaleNonZeroStock: 0,
  unchangedWithPeriodSaleAndPurchase: 0,
  unchangedWithPeriodSaleWithoutPeriodPurchase: 0,
  changed: 0,
  stockIncreased: 0,
  stockDecreased: 0,
  newInAugust: 0,
  periodSaleTotal: 0,
  periodSaleOnChanged: 0,
  periodSaleOnNew: 0,
  renamed: 0,
  totalAugust: augustRows.length - 1,
};
const keptRows = [];

for (const augustRow of augustRows.slice(1)) {
  const code = String(augustRow[augustSummary.codeIndex] ?? "").trim();
  const julyRow = julyByCode.get(code);
  const hasPeriodSale = isInPeriod(
    augustRow[augustSummary.recentSaleIndex],
    `${code} 최근매출일`,
  );
  const hasPeriodPurchase = isInPeriod(
    augustRow[augustSummary.recentPurchaseIndex],
    `${code} 최근매입일`,
  );
  comparison.periodSaleTotal += hasPeriodSale ? 1 : 0;
  if (!julyRow) {
    comparison.newInAugust += 1;
    comparison.periodSaleOnNew += hasPeriodSale ? 1 : 0;
    keptRows.push(augustRow);
    continue;
  }
  const julyStock = julyRow[julySummary.stockIndex];
  const augustStock = augustRow[augustSummary.stockIndex];
  if (Object.is(julyStock, augustStock)) {
    comparison.unchanged += 1;
    if (augustStock === 0) {
      comparison.unchangedZeroStock += 1;
    } else {
      comparison.unchangedNonZeroStock += 1;
    }
    if (hasPeriodSale) {
      comparison.unchangedWithPeriodSale += 1;
      comparison.unchangedWithPeriodSaleZeroStock += augustStock === 0 ? 1 : 0;
      comparison.unchangedWithPeriodSaleNonZeroStock += augustStock !== 0 ? 1 : 0;
      comparison.unchangedWithPeriodSaleAndPurchase += hasPeriodPurchase ? 1 : 0;
      comparison.unchangedWithPeriodSaleWithoutPeriodPurchase += hasPeriodPurchase ? 0 : 1;
      keptRows.push(augustRow);
    }
  } else {
    comparison.changed += 1;
    comparison.stockIncreased += augustStock > julyStock ? 1 : 0;
    comparison.stockDecreased += augustStock < julyStock ? 1 : 0;
    comparison.periodSaleOnChanged += hasPeriodSale ? 1 : 0;
    keptRows.push(augustRow);
  }
  if (julyRow[julySummary.nameIndex] !== augustRow[augustSummary.nameIndex]) {
    comparison.renamed += 1;
  }
}

comparison.kept = keptRows.length;
comparison.removedAsDormant = comparison.unchanged - comparison.unchangedWithPeriodSale;
if (comparison.unchanged + comparison.changed + comparison.newInAugust !== comparison.totalAugust) {
  throw new Error("비교 건수 합계가 8월 7일 상품 수와 일치하지 않습니다.");
}
if (comparison.kept + comparison.removedAsDormant !== comparison.totalAugust) {
  throw new Error("유지·제거 건수 합계가 8월 7일 상품 수와 일치하지 않습니다.");
}
if (
  comparison.periodSaleTotal !==
  comparison.unchangedWithPeriodSale + comparison.periodSaleOnChanged + comparison.periodSaleOnNew
) {
  throw new Error("기간 내 최근매출 건수 합계가 일치하지 않습니다.");
}

const originalTables = augustSheet.tables.items;
if (originalTables.length > 1) {
  throw new Error("8월 7일 파일에 네이티브 표가 둘 이상 있습니다.");
}
const originalTable = originalTables[0] ?? null;
const tableMetadata = originalTable
  ? {
      name: originalTable.name,
      style: originalTable.style,
      showTotals: originalTable.showTotals,
      showBandedRows: originalTable.showBandedRows,
      showBandedColumns: originalTable.showBandedColumns,
      highlightFirstColumn: originalTable.highlightFirstColumn,
      highlightLastColumn: originalTable.highlightLastColumn,
      showFilterButton: originalTable.showFilterButton,
    }
  : null;

const outputRows = [augustRows[0], ...keptRows];
const lastColumn = columnName(augustRows[0].length);
const outputLastRow = outputRows.length;
const originalLastRow = augustRows.length;

originalTable?.delete();
augustSheet.getRange(`A1:${lastColumn}${outputLastRow}`).values = outputRows;
if (outputLastRow < originalLastRow) {
  augustSheet
    .getRange(`A${outputLastRow + 1}:${lastColumn}${originalLastRow}`)
    .clear({ applyTo: "all" });
}

if (tableMetadata) {
  const outputTable = augustSheet.tables.add(
    `A1:${lastColumn}${outputLastRow}`,
    true,
    tableMetadata.name,
  );
  outputTable.style = tableMetadata.style;
  outputTable.showTotals = tableMetadata.showTotals;
  outputTable.showBandedRows = tableMetadata.showBandedRows;
  outputTable.showBandedColumns = tableMetadata.showBandedColumns;
  outputTable.highlightFirstColumn = tableMetadata.highlightFirstColumn;
  outputTable.highlightLastColumn = tableMetadata.highlightLastColumn;
  outputTable.showFilterButton = tableMetadata.showFilterButton;
}

const outputPath = path.join(
  outputDir,
  "상품리스트_2026-08-07_재고변화_또는_기간매출있음.xlsx",
);
const outputFile = await SpreadsheetFile.exportXlsx(augustWorkbook);
await outputFile.save(outputPath);

const verifiedWorkbook = await loadWorkbook(outputPath);
const verifiedSheet = verifiedWorkbook.worksheets.getItem("Sheet");
const verifiedRows = verifiedSheet.getUsedRange(true).values;
const verifiedTables = verifiedSheet.tables.items;

if (verifiedRows.length !== outputRows.length) {
  throw new Error(`검증 실패: 결과 행 수 ${verifiedRows.length}, 예상 ${outputRows.length}`);
}
if (verifiedRows[0].length !== augustRows[0].length) {
  throw new Error("검증 실패: 결과 열 수가 8월 7일 파일과 다릅니다.");
}
if (JSON.stringify(verifiedRows) !== JSON.stringify(outputRows)) {
  throw new Error("검증 실패: 결과 값이 필터링한 8월 7일 값과 다릅니다.");
}
if (verifiedTables.length !== originalTables.length) {
  throw new Error("검증 실패: 네이티브 표 개수가 원본과 다릅니다.");
}
if (tableMetadata && verifiedTables[0].address !== `A1:${lastColumn}${outputLastRow}`) {
  throw new Error("검증 실패: 결과 네이티브 표 범위가 예상과 다릅니다.");
}

const keyRange = await verifiedWorkbook.inspect({
  kind: "table",
  sheetId: "Sheet",
  range: `A1:T${Math.min(15, outputLastRow)}`,
  include: "values,formulas",
  maxChars: 6000,
  tableMaxRows: 15,
  tableMaxCols: 20,
});
const formulaErrors = await verifiedWorkbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});

const previewDir = path.join(outputDir, "previews");
await fs.mkdir(previewDir, { recursive: true });
const topPreview = await verifiedWorkbook.render({
  sheetName: "Sheet",
  range: "A1:T30",
  scale: 1,
  format: "png",
});
await fs.writeFile(
  path.join(previewDir, "result_sales_aware_top.png"),
  new Uint8Array(await topPreview.arrayBuffer()),
);
const bottomStart = Math.max(1, outputLastRow - 29);
const bottomPreview = await verifiedWorkbook.render({
  sheetName: "Sheet",
  range: `A${bottomStart}:T${outputLastRow}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(
  path.join(previewDir, "result_sales_aware_bottom.png"),
  new Uint8Array(await bottomPreview.arrayBuffer()),
);

const result = {
  outputPath,
  julyRows: julySummary.rowCount,
  augustRows: augustSummary.rowCount,
  outputRows: outputRows.length - 1,
  removedRows: comparison.removedAsDormant,
  period: { start: periodStart, end: periodEnd, basis: "최근매출일" },
  comparison,
  dataAddress: verifiedSheet.getUsedRange(true).address,
  nativeTableCount: verifiedTables.length,
  sourceFormulaInspection: sourceFormulaInspection.ndjson,
  keyRange: keyRange.ndjson,
  formulaErrors: formulaErrors.ndjson,
};
await fs.writeFile(
  path.join(outputDir, "verification_summary_sales_aware.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(result, null, 2));
