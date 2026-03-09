import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { createReadStream } from "node:fs";
import { chromium, Browser, Page } from "playwright";

interface ReferralStatus {
  url: string;
  status: "active" | "redeemed" | "unknown";
  lastChecked: string;
}

const REFERRAL_REGEX = /https?:\/\/cursor\.com\/referral\?code=([A-Z0-9]+)/i;
const DELAY_MS = parseInt(process.env.CHECK_DELAY_MS ?? "500", 10);

async function readReferralLinks(path: string): Promise<string[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const urls: string[] = [];
  for await (const line of rl) {
    const match = line.match(REFERRAL_REGEX);
    if (match) {
      urls.push(match[0]);
    }
  }

  return urls;
}

async function checkReferralInBrowser(
  page: Page,
  url: string
): Promise<"active" | "redeemed" | "unknown"> {
  return new Promise<"active" | "redeemed" | "unknown">((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve("unknown");
      }
    }, 15000); // 15 second timeout per check

    // Set up response listener
    const responseHandler = async (response: any) => {
      if (response.url().includes("/api/dashboard/check-referral-code") && !resolved) {
        resolved = true;
        clearTimeout(timeout);

        try {
          const statusCode = response.status();

          if (statusCode === 200) {
            const json = await response.json();

            // Active link returns: { isValid: true, userIsEligible: true, metadata: {...} }
            if (json && typeof json === "object" && "isValid" in json) {
              const { isValid, userIsEligible } = json;
              if (isValid && userIsEligible) {
                resolve("active");
                return;
              }
              resolve("redeemed");
              return;
            }

            // Empty object {} means already redeemed
            if (json && typeof json === "object" && Object.keys(json).length === 0) {
              resolve("redeemed");
              return;
            }

            // metadata.title "already been used" or "expired" = redeemed (Cursor frontend logic)
            const meta = json?.metadata;
            const title = meta?.title?.toLowerCase() ?? "";
            if (title.includes("already been used") || title.includes("expired")) {
              resolve("redeemed");
              return;
            }
          }

          resolve("unknown");
        } catch (error) {
          resolve("unknown");
        } finally {
          page.off("response", responseHandler);
        }
      }
    };

    page.on("response", responseHandler);

    // Navigate to the referral page
    page.goto(url, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve("unknown");
      }
    });
  });
}

function extractCode(url: string): string | null {
  const match = url.match(REFERRAL_REGEX);
  return match?.[1] ?? null;
}

function buildTable(statuses: ReferralStatus[]): string {
  const lines = ["| URL | Status | Last Checked |", "| --- | --- | --- |"];
  for (const item of statuses) {
    lines.push(`| ${item.url} | ${item.status} | ${item.lastChecked} |`);
  }
  return lines.join("\n");
}

function buildActiveLinksMarkdown(
  activeLinks: ReferralStatus[],
  redeemedCount: number,
  totalCount: number
): string {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const totalValue = activeLinks.length * 20;
  const successRate = Math.round((activeLinks.length / totalCount) * 100);

  const lines = [
    "# Active Cursor Referral Links",
    "",
    `**Last Checked:** ${dateStr}`,
    `**Total Active:** ${activeLinks.length} of ${totalCount} checked`,
    `**Total Credits Available:** $${totalValue.toFixed(2)}`,
    `**Success Rate:** ${successRate}%`,
    "",
    "---",
    "",
    "## Available Links",
    "",
  ];

  activeLinks.forEach((link) => {
    lines.push(link.url);
  });

  lines.push("");

  return lines.join("\n");
}

function summarize(statuses: ReferralStatus[]): string {
  const redeemed = statuses.filter((s) => s.status === "redeemed").length;
  const active = statuses.filter((s) => s.status === "active");
  const unknown = statuses.filter((s) => s.status === "unknown").length;

  const summaryLines = [
    "",
    "=".repeat(60),
    "SUMMARY",
    "=".repeat(60),
    `Checked ${statuses.length} referral links.`,
    `${active.length} active | ${redeemed} redeemed | ${unknown} unknown`,
    "",
  ];

  if (active.length > 0) {
    summaryLines.push("Active links saved to active-links-{date}.md");
    summaryLines.push("");
  } else {
    summaryLines.push("No active links found - all have been redeemed.");
    summaryLines.push("");
  }

  return summaryLines.join("\n");
}

async function main() {
  const path = process.argv[2];

  if (!path) {
    console.error("Error: Please provide a markdown file with referral links\n");
    console.error("Usage:");
    console.error("  npm run check-browser links.md\n");
    console.error("To get started:");
    console.error("  1. Copy links-template.md to links.md");
    console.error("  2. Add your referral URLs");
    console.error("  3. Run: npm run check-browser links.md");
    process.exit(1);
  }

  const backupPath = `${path}.bak`;

  console.log("Cursor Referral Link Checker");
  console.log("============================\n");

  let original: string;
  try {
    original = await readFile(path, "utf8");
  } catch (error) {
    console.error(`Error: Could not read file '${path}'`);
    console.error("Make sure the file exists and contains referral URLs");
    process.exit(1);
  }

  await writeFile(backupPath, original, "utf8");
  console.log(`Backup created: ${backupPath}\n`);

  const urls = await readReferralLinks(path);
  console.log(`Found ${urls.length} referral links\n`);

  if (urls.length === 0) {
    console.error("Error: No referral links found in file");
    console.error("Add Cursor referral URLs in this format:");
    console.error("  https://cursor.com/referral?code=YOUR_CODE");
    process.exit(1);
  }

  console.log("Launching browser...");
  console.log("A browser window will open. Make sure you're logged into Cursor.\n");

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: false,
      channel: "chrome",
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("Checking links...\n");

    const statuses: ReferralStatus[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const code = extractCode(url);
      const timestamp = new Date().toISOString();

      if (!code) {
        console.warn(`Could not extract code from ${url}`);
        statuses.push({ url, status: "unknown", lastChecked: timestamp });
        continue;
      }

      process.stdout.write(`[${i + 1}/${urls.length}] ${code}... `);
      const status = await checkReferralInBrowser(page, url);

      console.log(status);

      statuses.push({ url, status, lastChecked: timestamp });

      if (i < urls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    await browser.close();

    console.log("\nSaving results...");

    const table = buildTable(statuses);
    await writeFile(path, `${table}\n`, "utf8");
    console.log(`All results saved to: ${path}`);

    const activeLinks = statuses.filter((s) => s.status === "active");
    const redeemedCount = statuses.filter((s) => s.status === "redeemed").length;
    
    if (activeLinks.length > 0) {
      const dateStr = new Date().toISOString().split("T")[0];
      const activeFilename = `active-links-${dateStr}.md`;
      const activeMd = buildActiveLinksMarkdown(activeLinks, redeemedCount, statuses.length);
      await writeFile(activeFilename, activeMd, "utf8");
      console.log(`Active links saved to: ${activeFilename}`);
    }

    const summary = summarize(statuses);
    console.log(summary);

  } catch (error) {
    console.error("Error:", error);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    throw error;
  }
}

main().catch((error) => {
  console.error("Failed to process referral codes:", error);
  process.exitCode = 1;
});

