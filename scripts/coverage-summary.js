const fs = require('node:fs');

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
