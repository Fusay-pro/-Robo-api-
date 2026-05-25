const fs = require('fs');
const f = 'supabase_clean_schema.sql';
const t = fs.readFileSync(f, 'utf8')
  .split('\n')
  .filter(l => !/^\\restrict\b/.test(l) && !/^\\unrestrict\b/.test(l) && !/^SET row_security/.test(l))
  .join('\n');
fs.writeFileSync(f, t);
console.log('Lines:', t.split('\n').length);
