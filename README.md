# Cursor Referral Link Checker

Internal tool to batch-verify Cursor referral link status and calculate total available credits.

## Setup Your Links

1. Copy `links-template.md` to `links.md`
2. Add your referral URLs (one per line or in table format)
3. Run the checker

## Quick Start

```bash
npm install
npm run check-browser links.md
```

A browser window will open and automatically verify all links.

## Output Files

- `active-links-YYYY-MM-DD.md` - List of active links with total credits available
- `links.md` - Updated with current status for each link
- `links.md.bak` - Backup of your original file

## Usage

Check your links file:
```bash
npm run check-browser links.md
```

Check a different file:
```bash
npm run check-browser my-referrals.md
```

Adjust speed if rate limited:
```bash
# Windows
$env:CHECK_DELAY_MS="2000"
npm run check-browser

# Mac/Linux
CHECK_DELAY_MS=2000 npm run check-browser
```

## How It Works

1. Launches Chrome/Chromium browser with Playwright
2. Navigates to each referral link
3. Intercepts API calls to determine status
4. Generates organized output files

**Active link:** API returns `{ isValid: true, userIsEligible: true, ... }`  
**Redeemed link:** API returns `{}`

## Project Structure

```
credit-checker/
├── links-template.md             # Template for your links
├── links.md                      # Your referral links (create from template)
├── active-links-YYYY-MM-DD.md    # Generated: active links with credits
├── README.md
├── package.json
├── tsconfig.json
└── scripts/
    └── checkWithBrowser.ts       # Main checker script
```

## Adding Your Links

The tool accepts any markdown file with Cursor referral URLs, regardless of markdown formatting.
