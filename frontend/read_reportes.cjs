
const fs = require('fs');
try {
    const content = fs.readFileSync('src/pages/Reportes.jsx', 'utf8');
    console.log(content);
} catch (err) {
    console.error(err);
}
