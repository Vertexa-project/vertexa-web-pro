// PreToolUse hook: bloqueia edição de arquivos sensíveis e uso de service_role.
const fs = require('fs');
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const evt = JSON.parse(input);
    const path = (evt.tool_input && (evt.tool_input.file_path || evt.tool_input.path)) || '';
    const content = JSON.stringify(evt.tool_input || {});
    const blockedPaths = ['.env', '.env.local', 'package-lock.json', 'bun.lockb'];
    if (blockedPaths.some(p => path.endsWith(p))) {
      console.error(`BLOQUEADO: ${path} é sensível. Peça confirmação ao usuário.`);
      process.exit(2);
    }
    if (/service_role/i.test(content)) {
      console.error('BLOQUEADO: service_role nunca deve ir para o client. Use anon key.');
      process.exit(2);
    }
    process.exit(0);
  } catch (e) { process.exit(0); }
});
