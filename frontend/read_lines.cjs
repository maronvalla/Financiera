
const fs = require('fs');
const args = process.argv.slice(2);
const file = args[0];
const start = parseInt(args[1]);
const end = parseInt(args[2]);

try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const slice = lines.slice(start - 1, end);
    slice.forEach((line, i) => {
        console.log(`${start + i}: ${line}`);
    });
} catch (err) {
    console.error(err);
}
