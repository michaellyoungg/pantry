#!/usr/bin/env node
/**
 * Regenerates the `## Index` table in docs/backlog/README.md from each backlog
 * item's frontmatter, so claiming or completing an item is a one-file edit.
 *
 *   node scripts/backlog-index.mjs           # rewrite the table in place
 *   node scripts/backlog-index.mjs --check   # fail if the committed table is stale (CI)
 *
 * Everything above the `## Index` heading is hand-written prose and is left
 * byte-for-byte alone.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BACKLOG_DIR = join(import.meta.dirname, "..", "docs", "backlog");
const README = join(BACKLOG_DIR, "README.md");
const ITEM_FILE = /^(BL-\d{4})-.+\.md$/;
const FIELDS = ["id", "title", "status", "area", "effort"];
const HEADING = "## Index";

/** Pulls the five index fields out of a `---`-delimited YAML frontmatter block. */
function parseFrontmatter(source, file) {
  const lines = source.split("\n");
  if (lines[0] !== "---") throw new Error(`${file}: missing frontmatter`);
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error(`${file}: unterminated frontmatter`);

  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (FIELDS.includes(key)) fields[key] = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
  }

  const missing = FIELDS.filter((field) => !fields[field]);
  if (missing.length > 0) throw new Error(`${file}: frontmatter missing ${missing.join(", ")}`);
  return fields;
}

function readItems() {
  const items = [];
  const seen = new Map();

  for (const file of readdirSync(BACKLOG_DIR).sort()) {
    const match = ITEM_FILE.exec(file);
    if (!match) continue;

    const item = parseFrontmatter(readFileSync(join(BACKLOG_DIR, file), "utf8"), file);
    if (item.id !== match[1]) {
      throw new Error(`${file}: frontmatter id ${item.id} does not match the filename`);
    }
    if (seen.has(item.id)) throw new Error(`${item.id}: duplicated by ${seen.get(item.id)}`);
    seen.set(item.id, file);
    items.push({ ...item, file });
  }

  if (items.length === 0) throw new Error(`no BL-NNNN-*.md items found in ${BACKLOG_DIR}`);
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

/** A literal `|` in a title would otherwise split the markdown cell. */
const cell = (value) => value.replaceAll("|", "\\|");

function renderTable(items) {
  return [
    "| ID | Title | Status | Area | Effort |",
    "|---|---|---|---|---|",
    ...items.map(
      (item) =>
        `| [${item.id}](${item.file}) | ${cell(item.title)} | ${item.status} | ${item.area} | ${item.effort} |`,
    ),
  ];
}

/** Replaces the table under `## Index`, preserving the prose above it and any section below. */
function renderReadme(readme, items) {
  const lines = readme.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error(`${README}: no "${HEADING}" heading to write the table under`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }

  return [...lines.slice(0, start + 1), "", ...renderTable(items), "", ...lines.slice(end)].join(
    "\n",
  );
}

const check = process.argv.includes("--check");
const current = readFileSync(README, "utf8");
const next = renderReadme(current, readItems());

if (current === next) {
  console.log(`docs/backlog/README.md index is up to date`);
} else if (check) {
  console.error(
    "docs/backlog/README.md index is out of date with the item frontmatter.\n" +
      "Run `pnpm backlog:index` and commit the result.",
  );
  process.exit(1);
} else {
  writeFileSync(README, next);
  console.log(`docs/backlog/README.md index regenerated`);
}
