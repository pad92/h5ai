const fs = require('node:fs');

// Combined line coverage below this percentage fails the job. COVERAGE_MIN
// overrides it, for instance to check a branch against a different floor.
const DEFAULT_MINIMUM = 90;
const minimum = Number(process.env.COVERAGE_MIN || DEFAULT_MINIMUM);
if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
    throw new Error(`Invalid COVERAGE_MIN: ${process.env.COVERAGE_MIN}`);
}

const js = JSON.parse(fs.readFileSync('coverage/js/coverage-summary.json', 'utf8')).total.lines;
const xml = fs.readFileSync('coverage/php/cobertura.xml', 'utf8');
const root = xml.match(/<coverage\s[^>]*>/)?.[0];
const count = name => {
    const value = root?.match(new RegExp(`${name}="(\\d+)"`))?.[1];
    if (value === undefined) {
        throw new Error(`Missing PHP coverage attribute: ${name}`);
    }
    return Number(value);
};
const php = {total: count('lines-valid'), covered: count('lines-covered')};
for (const [language, lines] of Object.entries({JavaScript: js, PHP: php})) {
    if (!Number.isSafeInteger(lines.total) || !Number.isSafeInteger(lines.covered) ||
        lines.total <= 0 || lines.covered < 0 || lines.covered > lines.total) {
        throw new Error(`Invalid ${language} line coverage counts`);
    }
    console.log(`${language}: ${lines.covered}/${lines.total} lines`);
}
const percent = 100 * (js.covered + php.covered) / (js.total + php.total);
console.log(`Total line coverage: ${percent.toFixed(2)}%`);
if (percent < minimum) {
    console.error(`Line coverage is below the ${minimum}% minimum`);
    process.exitCode = 1;
}
