
const fs = require('fs');
try {
  const content = fs.readFileSync('lint.json', 'utf8'); // Try utf8 first, if it fails because of BOM/encoding we might need to handle it. 
  // PowerShell > redirection often creates UTF-16LE. Node's fs.readFileSync might need 'utf16le' if that's the case.
  let json;
  try {
      json = JSON.parse(content);
  } catch (e) {
      // Try utf-16le 
      const content16 = fs.readFileSync('lint.json', 'utf16le');
      json = JSON.parse(content16);
  }

  const errors = json.filter(result => result.errorCount > 0 || result.warningCount > 0);
  
  errors.forEach(f => {
    console.log(`File: ${f.filePath}`);
    f.messages.forEach(m => {
      console.log(`  [${m.severity === 2 ? 'ERROR' : 'WARN'}] Line ${m.line}: ${m.message} (${m.ruleId})`);
    });
  });

  if (errors.length === 0) {
      console.log("No errors found.");
  }

} catch (err) {
  console.error("Error reading/parsing file:", err);
}
