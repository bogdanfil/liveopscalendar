const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/calendar-ui.js':'calendar-ui.js','/styles.css':'styles.css','/config.js':'config.js'};
http.createServer((request,response)=>{
  const file=files[request.url.split('?')[0]];
  if (!file) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  response.setHeader('Cache-Control','no-store');
  response.end(fs.readFileSync(path.join(__dirname,file)));
}).listen(Number(process.argv[2]||4174),'127.0.0.1',()=>console.log('Calendar preview is ready.'));
