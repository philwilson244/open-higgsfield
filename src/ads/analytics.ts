import { z } from "zod";

const platformSchema = z.enum(["meta", "youtube", "tiktok", "other"]);

export type MetricImportRow = {
  creativeId: string;
  platform: z.infer<typeof platformSchema>;
  metricDate: string;
  spendCents: number;
  impressions: number;
  threeSecondViews: number;
  completions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  score: number;
  raw: Record<string, string>;
};

export function creativeScore(values: {
  spendCents: number;
  impressions: number;
  threeSecondViews: number;
  completions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
}): number {
  const ratio = (value: number, total: number) => (total > 0 ? value / total : 0);
  const cap = (value: number, target: number) => Math.min(1, value / target);
  const roas = values.spendCents > 0 ? values.revenueCents / values.spendCents : 0;
  const weighted =
    0.2 * cap(ratio(values.threeSecondViews, values.impressions), 0.3) +
    0.2 * cap(ratio(values.completions, values.impressions), 0.15) +
    0.25 * cap(ratio(values.clicks, values.impressions), 0.02) +
    0.2 * cap(ratio(values.conversions, values.clicks), 0.05) +
    0.15 * cap(roas, 3);
  return Math.round(weighted * 10_000) / 100;
}

export function parseMetricsCsv(csv: string): MetricImportRow[] {
  const rows = parseCsv(csv.trim());
  if (rows.length < 2) throw new Error("The analytics CSV has no data rows");
  const headers = rows[0]!.map((header) => header.trim().toLowerCase());
  const required = [
    "creative_id",
    "platform",
    "date",
    "spend",
    "impressions",
    "three_second_views",
    "completions",
    "clicks",
    "conversions",
    "revenue",
  ];
  for (const field of required)
    if (!headers.includes(field)) throw new Error(`Missing CSV column: ${field}`);
  if (rows.length > 1001) throw new Error("Import at most 1,000 analytics rows at a time");

  return rows.slice(1).filter((row) => row.some(Boolean)).map((row, index) => {
    const raw = Object.fromEntries(headers.map((header, i) => [header, row[i]?.trim() ?? ""]));
    const count = (field: string) => {
      const value = Number(raw[field]);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Row ${index + 2}: invalid ${field}`);
      return value;
    };
    const values = {
      spendCents: Math.round(count("spend") * 100),
      impressions: Math.round(count("impressions")),
      threeSecondViews: Math.round(count("three_second_views")),
      completions: Math.round(count("completions")),
      clicks: Math.round(count("clicks")),
      conversions: count("conversions"),
      revenueCents: Math.round(count("revenue") * 100),
    };
    const metricDate = z.iso.date().parse(raw.date);
    return {
      creativeId: z.string().trim().min(1).max(200).parse(raw.creative_id),
      platform: platformSchema.parse(raw.platform.toLowerCase()),
      metricDate,
      ...values,
      score: creativeScore(values),
      raw,
    };
  });
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i]!;
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("The analytics CSV contains an unclosed quote");
  row.push(field);
  rows.push(row);
  return rows;
}
