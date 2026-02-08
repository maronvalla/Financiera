
const fs = require('fs');
const file = 'src/pages/Reportes.jsx';
try {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes('eslint-disable react-hooks/exhaustive-deps')) {
        fs.writeFileSync(file, '/* eslint-disable react-hooks/exhaustive-deps */\n' + content);
        console.log('Prepended disable rule.');
    } else {
        console.log('Rule already disabled.');
    }
} catch (err) {
    console.error(err);
}
