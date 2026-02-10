#!/usr/bin/env bun
/**
 * Screenshot Testing Framework for Pioneer Browser
 * Captures screenshots and uses Gemini AI to analyze them for UI issues.
 *
 * Usage: bun run scripts/screenshot-test.ts
 *
 * Requires GEMINI_API_KEY in .env.local
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// Load env
const envPath = join(import.meta.dir, "..", ".env.local");
let GEMINI_API_KEY = "";
if (existsSync(envPath)) {
	const envContent = readFileSync(envPath, "utf-8");
	const match = envContent.match(/GEMINI_API_KEY=(.+)/);
	if (match) GEMINI_API_KEY = match[1].trim();
}

if (!GEMINI_API_KEY) {
	console.error("Error: GEMINI_API_KEY not found in .env.local");
	process.exit(1);
}

const RESULTS_DIR = join(import.meta.dir, "..", "test-results");
const SCREENSHOTS_DIR = join(RESULTS_DIR, "screenshots");

// Ensure directories exist
[RESULTS_DIR, SCREENSHOTS_DIR].forEach((dir) => {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

interface ScreenshotTest {
	name: string;
	description: string;
	instructions: string;
}

const tests: ScreenshotTest[] = [
	{
		name: "new-tab-page",
		description: "New tab / welcome screen",
		instructions: "Launch the app and take a screenshot of the initial welcome screen",
	},
	{
		name: "browsing-page",
		description: "Active browsing with a loaded page",
		instructions: "Navigate to electrobun.dev and take a screenshot after page loads",
	},
	{
		name: "multiple-tabs",
		description: "Multiple tabs open",
		instructions: "Open 3+ tabs and take a screenshot showing the tab bar",
	},
	{
		name: "url-bar-focused",
		description: "URL bar in focused state",
		instructions: "Click the URL bar so it's focused and take a screenshot",
	},
	{
		name: "bookmarks-open",
		description: "Bookmarks dropdown visible",
		instructions: "Open the bookmarks dropdown and take a screenshot",
	},
	{
		name: "loading-state",
		description: "Page loading state with progress bar",
		instructions: "Navigate to a page and capture the loading state",
	},
];

interface GeminiAnalysis {
	severity: "critical" | "major" | "minor" | "info";
	category: string;
	description: string;
	suggestion: string;
}

interface TestResult {
	test: ScreenshotTest;
	screenshotPath: string;
	timestamp: number;
	analyses: GeminiAnalysis[];
}

async function captureScreenshot(name: string): Promise<string> {
	const path = join(SCREENSHOTS_DIR, `${name}-${Date.now()}.png`);
	try {
		execSync(`/usr/sbin/screencapture -x "${path}"`, { timeout: 10000 });
		console.log(`  Captured: ${path}`);
		return path;
	} catch (error) {
		console.error(`  Failed to capture screenshot: ${error}`);
		return "";
	}
}

async function analyzeWithGemini(screenshotPath: string, testDescription: string): Promise<GeminiAnalysis[]> {
	if (!existsSync(screenshotPath)) return [];

	const imageData = readFileSync(screenshotPath);
	const base64Image = imageData.toString("base64");

	const prompt = `You are a senior UI/UX engineer reviewing a screenshot of a web browser application called "Pioneer" built with Electrobun.

This screenshot shows: ${testDescription}

Analyze this screenshot for:
1. Layout issues (overlapping elements, misalignment, broken layouts)
2. Visual consistency (inconsistent colors, fonts, spacing)
3. Accessibility problems (contrast issues, small text, missing labels)
4. Broken or missing UI elements
5. UX problems (confusing layout, poor information hierarchy)
6. Polish issues (rough edges, missing icons, visual artifacts)

For each issue found, provide a JSON array of objects with:
- "severity": "critical" | "major" | "minor" | "info"
- "category": one of ["layout", "visual", "accessibility", "broken", "ux", "polish"]
- "description": clear description of the issue
- "suggestion": how to fix it

If the screenshot looks good, return an empty array.
Respond ONLY with a valid JSON array, no other text.`;

	try {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [
						{
							parts: [
								{ text: prompt },
								{
									inline_data: {
										mime_type: "image/png",
										data: base64Image,
									},
								},
							],
						},
					],
					generationConfig: {
						temperature: 0.1,
						maxOutputTokens: 4096,
					},
				}),
			},
		);

		if (!response.ok) {
			console.error(`  Gemini API error: ${response.status} ${response.statusText}`);
			return [];
		}

		const data = await response.json();
		const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

		// Extract JSON from response (handle markdown code blocks)
		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			return JSON.parse(jsonMatch[0]);
		}
		return [];
	} catch (error) {
		console.error(`  Gemini analysis failed: ${error}`);
		return [];
	}
}

function generateReport(results: TestResult[]): string {
	const timestamp = new Date().toISOString();
	let criticalCount = 0;
	let majorCount = 0;
	let minorCount = 0;
	let infoCount = 0;

	results.forEach((r) =>
		r.analyses.forEach((a) => {
			if (a.severity === "critical") criticalCount++;
			else if (a.severity === "major") majorCount++;
			else if (a.severity === "minor") minorCount++;
			else infoCount++;
		}),
	);

	const totalIssues = criticalCount + majorCount + minorCount + infoCount;

	let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Pioneer Screenshot Test Report - ${timestamp}</title>
<style>
body { font-family: -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
h1 { color: #333; }
.summary { display: flex; gap: 16px; margin: 20px 0; }
.summary-card { padding: 16px 24px; border-radius: 8px; color: white; font-weight: 600; }
.summary-card.critical { background: #e74c3c; }
.summary-card.major { background: #e67e22; }
.summary-card.minor { background: #f1c40f; color: #333; }
.summary-card.info { background: #3498db; }
.test-result { background: white; border-radius: 8px; padding: 20px; margin: 16px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.test-result h2 { color: #333; margin-bottom: 8px; }
.test-result .description { color: #666; margin-bottom: 16px; }
.issue { padding: 12px; border-left: 4px solid #ddd; margin: 8px 0; border-radius: 0 4px 4px 0; background: #fafafa; }
.issue.critical { border-left-color: #e74c3c; }
.issue.major { border-left-color: #e67e22; }
.issue.minor { border-left-color: #f1c40f; }
.issue.info { border-left-color: #3498db; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; color: white; margin-right: 8px; }
.badge.critical { background: #e74c3c; }
.badge.major { background: #e67e22; }
.badge.minor { background: #f1c40f; color: #333; }
.badge.info { background: #3498db; }
.screenshot { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin: 12px 0; }
.no-issues { color: #27ae60; font-weight: 500; }
</style>
</head>
<body>
<h1>Pioneer Screenshot Test Report</h1>
<p>Generated: ${timestamp}</p>
<div class="summary">
<div class="summary-card critical">Critical: ${criticalCount}</div>
<div class="summary-card major">Major: ${majorCount}</div>
<div class="summary-card minor">Minor: ${minorCount}</div>
<div class="summary-card info">Info: ${infoCount}</div>
</div>
<p>Total issues found: ${totalIssues} across ${results.length} test(s)</p>
`;

	for (const result of results) {
		html += `<div class="test-result">
<h2>${result.test.name}</h2>
<p class="description">${result.test.description}</p>`;

		if (result.screenshotPath) {
			const filename = result.screenshotPath.split("/").pop();
			html += `<img class="screenshot" src="screenshots/${filename}" alt="${result.test.name}" />`;
		}

		if (result.analyses.length === 0) {
			html += `<p class="no-issues">No issues found</p>`;
		} else {
			for (const analysis of result.analyses) {
				html += `<div class="issue ${analysis.severity}">
<span class="badge ${analysis.severity}">${analysis.severity.toUpperCase()}</span>
<span class="badge" style="background:#6c757d">${analysis.category}</span>
<strong>${analysis.description}</strong>
<p style="margin-top:8px;color:#555">${analysis.suggestion}</p>
</div>`;
			}
		}
		html += `</div>`;
	}

	html += `</body></html>`;
	return html;
}

async function createGitHubIssues(results: TestResult[]): Promise<void> {
	const criticalAndMajor: { test: string; analysis: GeminiAnalysis }[] = [];

	for (const result of results) {
		for (const analysis of result.analyses) {
			if (analysis.severity === "critical" || analysis.severity === "major") {
				criticalAndMajor.push({ test: result.test.name, analysis });
			}
		}
	}

	if (criticalAndMajor.length === 0) {
		console.log("No critical/major issues to create GitHub issues for.");
		return;
	}

	console.log(`Creating ${criticalAndMajor.length} GitHub issue(s) for critical/major findings...`);

	for (const { test, analysis } of criticalAndMajor) {
		const title = `[Screenshot Test] ${analysis.severity.toUpperCase()}: ${analysis.description.slice(0, 80)}`;
		const body = `## Screenshot Test Finding

**Test:** ${test}
**Severity:** ${analysis.severity}
**Category:** ${analysis.category}

### Issue
${analysis.description}

### Suggested Fix
${analysis.suggestion}

---
*Automatically generated by Pioneer screenshot testing framework*`;

		try {
			execSync(
				`gh issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --label "screenshot-test,${analysis.severity}"`,
				{ timeout: 30000, cwd: join(import.meta.dir, "..") },
			);
			console.log(`  Created issue: ${title}`);
		} catch (error) {
			console.error(`  Failed to create issue: ${error}`);
		}
	}
}

async function main() {
	console.log("Pioneer Screenshot Testing Framework");
	console.log("=====================================\n");

	const results: TestResult[] = [];

	for (const test of tests) {
		console.log(`\nTest: ${test.name}`);
		console.log(`  Description: ${test.description}`);
		console.log(`  Instructions: ${test.instructions}`);

		// Capture screenshot
		const screenshotPath = await captureScreenshot(test.name);

		if (!screenshotPath) {
			console.log("  Skipped (no screenshot captured)");
			continue;
		}

		// Analyze with Gemini
		console.log("  Analyzing with Gemini...");
		const analyses = await analyzeWithGemini(screenshotPath, test.description);
		console.log(`  Found ${analyses.length} issue(s)`);

		results.push({
			test,
			screenshotPath,
			timestamp: Date.now(),
			analyses,
		});
	}

	// Generate HTML report
	const report = generateReport(results);
	const reportPath = join(RESULTS_DIR, `report-${Date.now()}.html`);
	writeFileSync(reportPath, report);
	console.log(`\nReport saved: ${reportPath}`);

	// Create GitHub issues for critical/major findings
	await createGitHubIssues(results);

	console.log("\nDone!");
}

main().catch(console.error);
